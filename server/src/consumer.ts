import type pg from "pg";
import { loadSql } from "./db.js";
import { refoldSubscribers } from "./projections.js";

const monthlySql = loadSql("monthly_metrics");

export interface BatchResult {
  outcome: "processed" | "paused" | "caught_up";
  checkpoint: number;
  applied: number;
  duplicates: number;
  conflicts: number;
  restatements: number;
}

interface DeliveryRow {
  source_offset: string;
  source_received_at: Date;
  event_id: string;
  payload: { subscriber_id: string; type: string; plan_id?: string; effective_at: string };
}

export async function processBatch(pool: pg.Pool, batchSize = 100): Promise<BatchResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await client.query<{ head_offset: string; consumer_paused: boolean }>(
      "SELECT head_offset, consumer_paused FROM source_state FOR UPDATE",
    );
    const head = Number(state.rows[0]?.head_offset ?? 0);
    const paused = state.rows[0]?.consumer_paused ?? false;
    const checkpoint = await currentCheckpoint(client);
    if (paused)
      return await finish(client, {
        outcome: "paused",
        checkpoint,
        applied: 0,
        duplicates: 0,
        conflicts: 0,
        restatements: 0,
      });
    if (checkpoint >= head)
      return await finish(client, {
        outcome: "caught_up",
        checkpoint,
        applied: 0,
        duplicates: 0,
        conflicts: 0,
        restatements: 0,
      });

    const { rows: deliveries } = await client.query<DeliveryRow>(
      `SELECT source_offset, source_received_at, event_id, payload FROM source_deliveries
       WHERE source_offset > $1 AND source_offset <= LEAST($1 + $2, $3) ORDER BY source_offset`,
      [checkpoint, batchSize, head],
    );
    const last = deliveries.at(-1);
    const expected = Math.min(batchSize, head - checkpoint);
    if (last === undefined || deliveries.length !== expected)
      throw new Error(
        `source has a gap after offset ${checkpoint}: expected ${expected} deliveries, found ${deliveries.length}`,
      );

    const appliedEvents: AppliedEvent[] = [];
    let duplicates = 0;
    for (const d of deliveries) {
      const inserted = await client.query<{ event_id: string }>(
        `INSERT INTO events (event_id, subscriber_id, type, plan_id, effective_at, first_source_offset)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [
          d.event_id,
          d.payload.subscriber_id,
          d.payload.type,
          d.payload.plan_id ?? null,
          d.payload.effective_at,
          d.source_offset,
        ],
      );
      if (inserted.rowCount === 0) {
        duplicates += 1;
        await client.query(
          "UPDATE source_deliveries SET result = 'duplicate', processed_at = now() WHERE source_offset = $1",
          [d.source_offset],
        );
      } else {
        appliedEvents.push({
          event_id: d.event_id,
          subscriber_id: d.payload.subscriber_id,
          type: d.payload.type,
          effective_at: new Date(d.payload.effective_at),
        });
        await client.query(
          "UPDATE source_deliveries SET result = 'applied', processed_at = now() WHERE source_offset = $1",
          [d.source_offset],
        );
      }
    }

    const affected = [...new Set(appliedEvents.map((e) => e.subscriber_id))];
    await refoldSubscribers(client, affected);
    await syncDeliveryResults(client, affected);
    const { rows: outcomes } = await client.query<{ result: string; n: number }>(
      "SELECT result, count(*)::int AS n FROM source_deliveries WHERE source_offset > $1 AND source_offset <= $2 GROUP BY result",
      [checkpoint, last.source_offset],
    );
    const counted = (result: string) => outcomes.find((o) => o.result === result)?.n ?? 0;
    const { rows: conflicted } = await client.query<{ event_id: string }>(
      "SELECT event_id FROM event_conflicts WHERE event_id = ANY ($1::text[])",
      [appliedEvents.map((e) => e.event_id)],
    );
    const conflictedIds = new Set(conflicted.map((c) => c.event_id));

    const newCheckpoint = Number(last.source_offset);
    const restatements = await recomputeClosedMonths(
      client,
      last.source_received_at,
      newCheckpoint,
      appliedEvents.filter((e) => !conflictedIds.has(e.event_id)),
    );

    const { rows: totals } = await client.query<{ mrr: string; active: number; conflicts: number }>(
      `SELECT coalesce(sum(current_mrr), 0)::numeric(18,6)::text AS mrr,
              count(*) FILTER (WHERE status = 'active')::int AS active,
              (SELECT count(*)::int FROM event_conflicts) AS conflicts
       FROM subscriber_projections`,
    );
    const total = totals[0];
    if (total === undefined) throw new Error("metrics query returned nothing");
    await client.query(
      `INSERT INTO metric_snapshots (checkpoint_offset, checkpoint_source_received_at, current_mrr, current_arr, active_subscribers, conflicts)
       VALUES ($1, $2, $3::numeric, ($3::numeric * 12)::numeric(18,6), $4, $5)`,
      [newCheckpoint, last.source_received_at, total.mrr, total.active, total.conflicts],
    );
    return await finish(client, {
      outcome: "processed",
      checkpoint: newCheckpoint,
      applied: counted("applied"),
      duplicates,
      conflicts: counted("conflict"),
      restatements,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function processUntilCaughtUp(pool: pg.Pool, batchSize = 100): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  for (;;) {
    const result = await processBatch(pool, batchSize);
    results.push(result);
    if (result.outcome !== "processed") return results;
  }
}

async function syncDeliveryResults(client: pg.PoolClient, subscriberIds: string[]): Promise<void> {
  if (subscriberIds.length === 0) return;
  await client.query(
    `UPDATE source_deliveries d SET result = 'conflict', result_detail = c.detail
     FROM events e JOIN event_conflicts c ON c.event_id = e.event_id
     WHERE d.source_offset = e.first_source_offset AND e.subscriber_id = ANY ($1::text[])
       AND (d.result <> 'conflict' OR d.result_detail IS DISTINCT FROM c.detail)`,
    [subscriberIds],
  );
  await client.query(
    `UPDATE source_deliveries d SET result = 'applied', result_detail = NULL
     FROM events e LEFT JOIN event_conflicts c ON c.event_id = e.event_id
     WHERE d.source_offset = e.first_source_offset AND e.subscriber_id = ANY ($1::text[])
       AND d.result = 'conflict' AND c.event_id IS NULL`,
    [subscriberIds],
  );
}

async function finish(client: pg.PoolClient, result: BatchResult): Promise<BatchResult> {
  await client.query("COMMIT");
  return result;
}

export async function currentCheckpoint(db: Pick<pg.PoolClient, "query">): Promise<number> {
  const { rows } = await db.query<{ checkpoint: string }>(
    "SELECT max(checkpoint_offset)::text AS checkpoint FROM metric_snapshots",
  );
  return Number(rows[0]?.checkpoint ?? 0);
}

export function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function lastClosedMonth(checkpointReceivedAt: Date): Date {
  const start = monthStart(checkpointReceivedAt);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
}

async function earliestMonthToCompute(
  client: pg.PoolClient,
  applied: { effective_at: Date }[],
): Promise<Date | null> {
  const { rows } = await client.query<{ known: string | null; first: Date | null }>(
    "SELECT (SELECT max(period) FROM monthly_metrics) AS known, (SELECT min(effective_at) FROM events) AS first",
  );
  const bounds = rows[0];
  if (bounds?.first == null) return null;
  const firstUnknown = bounds.known
    ? new Date(Date.UTC(Number(bounds.known.slice(0, 4)), Number(bounds.known.slice(5, 7)), 1))
    : monthStart(bounds.first);
  const touched = applied.map((e) => monthStart(e.effective_at).getTime());
  const earliestTouched = touched.length > 0 ? new Date(Math.min(...touched)) : firstUnknown;
  return earliestTouched < firstUnknown ? earliestTouched : firstUnknown;
}

interface AppliedEvent {
  event_id: string;
  subscriber_id: string;
  type: string;
  effective_at: Date;
}

const MOVES_ACTIVE_COUNT = new Set(["subscription.started", "subscription.cancelled"]);

export function restatementCause(
  applied: AppliedEvent[],
  metric: "mrr" | "active_subscribers",
  period: string,
): { event_id: string; other_causes: number } | null {
  const periodStart = new Date(
    Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1, 1),
  );
  const periodEnd = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 1));
  const able = applied.filter((e) => metric === "mrr" || MOVES_ACTIVE_COUNT.has(e.type));
  const inside = able.filter((e) => e.effective_at >= periodStart && e.effective_at < periodEnd);
  const before = able.filter((e) => e.effective_at < periodEnd);
  const candidates = [...(inside.length > 0 ? inside : before)].sort(
    (a, b) => a.effective_at.getTime() - b.effective_at.getTime(),
  );
  const first = candidates[0];
  if (first === undefined) return null;
  return { event_id: first.event_id, other_causes: candidates.length - 1 };
}

async function recomputeClosedMonths(
  client: pg.PoolClient,
  checkpointReceivedAt: Date,
  checkpoint: number,
  applied: AppliedEvent[],
): Promise<number> {
  const lastClosed = lastClosedMonth(checkpointReceivedAt);
  const earliest = await earliestMonthToCompute(client, applied);
  if (earliest === null || earliest > lastClosed) return 0;

  const { rows: computed } = await client.query<{
    period: string;
    mrr: string;
    active_subscribers: number;
  }>(monthlySql, [earliest.toISOString(), lastClosed.toISOString()]);
  const { rows: existing } = await client.query<{
    period: string;
    mrr: string;
    active_subscribers: number;
  }>("SELECT period, mrr::text AS mrr, active_subscribers FROM monthly_metrics");
  const previous = new Map(existing.map((r) => [r.period, r]));
  let restatements = 0;
  for (const row of computed) {
    const before = previous.get(row.period);
    if (before) {
      const changed: {
        metric: "mrr" | "active_subscribers";
        previous: string | number;
        next: string | number;
      }[] = [];
      if (before.mrr !== row.mrr)
        changed.push({ metric: "mrr", previous: before.mrr, next: row.mrr });
      if (before.active_subscribers !== row.active_subscribers)
        changed.push({
          metric: "active_subscribers",
          previous: before.active_subscribers,
          next: row.active_subscribers,
        });
      for (const change of changed) {
        const cause = restatementCause(applied, change.metric, row.period);
        if (cause === null)
          throw new Error(`${change.metric} for ${row.period} changed without an applied event`);
        await client.query(
          "INSERT INTO restatements (metric, period, previous_value, new_value, cause_event_id, other_causes, detected_at_checkpoint) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [
            change.metric,
            row.period,
            change.previous,
            change.next,
            cause.event_id,
            cause.other_causes,
            checkpoint,
          ],
        );
        restatements += 1;
      }
    }
    await client.query(
      `INSERT INTO monthly_metrics (period, mrr, active_subscribers, computed_at_checkpoint) VALUES ($1, $2, $3, $4)
       ON CONFLICT (period) DO UPDATE SET mrr = EXCLUDED.mrr, active_subscribers = EXCLUDED.active_subscribers, computed_at_checkpoint = EXCLUDED.computed_at_checkpoint`,
      [row.period, row.mrr, row.active_subscribers, checkpoint],
    );
  }
  return restatements;
}
