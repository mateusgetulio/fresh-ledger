import type pg from "pg";
import type {
  CurrentMetrics,
  DeliveryRecord,
  MonthMetrics,
  Money,
  Restatement,
} from "@fresh-ledger/shared";
import { monthStart } from "./consumer.js";
import { restatementSentence, type RestatementRow } from "./restatements.js";

type Queryable = Pick<pg.PoolClient, "query">;

interface SnapshotRow {
  id: string;
  checkpoint_offset: string;
  checkpoint_source_received_at: Date | null;
  current_mrr: string;
  current_arr: string;
  active_subscribers: number;
  conflicts: number;
}

export async function currentMetrics(db: Queryable): Promise<CurrentMetrics> {
  const { rows } = await db.query<SnapshotRow>(
    "SELECT id, checkpoint_offset, checkpoint_source_received_at, current_mrr, current_arr, active_subscribers, conflicts FROM metric_snapshots ORDER BY checkpoint_offset DESC LIMIT 1",
  );
  const snapshot = rows[0];
  if (snapshot === undefined) throw new Error("no snapshot, the bootstrap row is missing");
  const checkpoint = Number(snapshot.checkpoint_offset);
  const base = {
    snapshot_id: Number(snapshot.id),
    checkpoint_offset: checkpoint,
    checkpoint_source_received_at: snapshot.checkpoint_source_received_at?.toISOString() ?? null,
    conflicts: snapshot.conflicts,
    metrics: {
      mrr: snapshot.current_mrr as Money,
      arr: snapshot.current_arr as Money,
      active_subscribers: snapshot.active_subscribers,
    },
  };
  let source: { head_offset: string; consumer_paused: boolean } | undefined;
  try {
    source = (
      await db.query<{ head_offset: string; consumer_paused: boolean }>(
        "SELECT head_offset, consumer_paused FROM source_state",
      )
    ).rows[0];
  } catch {
    source = undefined;
  }
  if (source === undefined) {
    return {
      ...base,
      source_head_offset: null,
      pending_deliveries: null,
      status: "unavailable",
      consumer_paused: false,
    };
  }
  const head = Number(source.head_offset);
  const pending = head - checkpoint;
  return {
    ...base,
    source_head_offset: head,
    pending_deliveries: pending,
    status: pending === 0 ? "current" : "delayed",
    consumer_paused: source.consumer_paused,
  };
}

export async function metricsHistory(pool: pg.Pool): Promise<MonthMetrics[]> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const history = await readHistory(client);
    await client.query("COMMIT");
    return history;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function readHistory(db: Queryable): Promise<MonthMetrics[]> {
  const { rows: closed } = await db.query<{
    period: string;
    mrr: string;
    active_subscribers: number;
    computed_at_checkpoint: string;
    restated: boolean;
  }>(
    `SELECT m.period, m.mrr::text AS mrr, m.active_subscribers, m.computed_at_checkpoint,
            EXISTS (SELECT 1 FROM restatements r WHERE r.period = m.period) AS restated
     FROM monthly_metrics m ORDER BY m.period`,
  );
  const history: MonthMetrics[] = closed.map((row) => ({
    period: row.period,
    mrr: row.mrr as Money,
    active_subscribers: row.active_subscribers,
    computed_at_checkpoint: Number(row.computed_at_checkpoint),
    state: "closed",
    restated: row.restated,
  }));
  const { rows: latest } = await db.query<{
    checkpoint_source_received_at: Date | null;
    current_mrr: string;
    active_subscribers: number;
  }>(
    "SELECT checkpoint_source_received_at, current_mrr::text AS current_mrr, active_subscribers FROM metric_snapshots ORDER BY checkpoint_offset DESC LIMIT 1",
  );
  const snapshot = latest[0];
  if (snapshot?.checkpoint_source_received_at) {
    history.push({
      period: monthStart(snapshot.checkpoint_source_received_at).toISOString().slice(0, 7),
      mrr: snapshot.current_mrr as Money,
      active_subscribers: snapshot.active_subscribers,
      computed_at_checkpoint: null,
      state: "provisional",
      restated: false,
    });
  }
  return history;
}

export async function deliveryAt(db: Queryable, offset: number): Promise<DeliveryRecord | null> {
  const { rows } = await db.query<{
    source_offset: string;
    source_received_at: Date;
    event_id: string;
    result: DeliveryRecord["result"];
    result_detail: string | null;
    first_source_offset: string | null;
  }>(
    `SELECT d.source_offset, d.source_received_at, d.event_id, d.result, d.result_detail, e.first_source_offset
     FROM source_deliveries d LEFT JOIN events e ON e.event_id = d.event_id
     WHERE d.source_offset = $1`,
    [offset],
  );
  const row = rows[0];
  if (row === undefined) return null;
  return {
    source_offset: Number(row.source_offset),
    source_received_at: row.source_received_at.toISOString(),
    event_id: row.event_id,
    result: row.result,
    result_detail: row.result_detail,
    first_source_offset: row.first_source_offset === null ? null : Number(row.first_source_offset),
  };
}

export async function restatements(db: Queryable): Promise<Restatement[]> {
  const { rows } = await db.query<RestatementRow>(
    `SELECT r.id, r.metric, r.period, r.previous_value::text AS previous_value, r.new_value::text AS new_value,
            r.cause_event_id, r.other_causes, r.detected_at_checkpoint, e.type AS cause_type, e.effective_at AS cause_effective_at,
            e.first_source_offset AS cause_source_offset
     FROM restatements r JOIN events e ON e.event_id = r.cause_event_id
     ORDER BY r.id DESC`,
  );
  return rows.map((row) => ({
    id: Number(row.id),
    metric: row.metric,
    period: row.period,
    previous_value: row.previous_value as Money,
    new_value: row.new_value as Money,
    cause_event_id: row.cause_event_id,
    other_causes: row.other_causes,
    detected_at_checkpoint: Number(row.detected_at_checkpoint),
    sentence: restatementSentence(row),
  }));
}
