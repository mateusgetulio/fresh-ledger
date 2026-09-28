import type pg from "pg";
import type { CurrentMetrics, MonthMetrics, Money, Restatement } from "@fresh-ledger/shared";
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
      source_head_offset: checkpoint,
      pending_deliveries: 0,
      status: "unavailable",
      consumer_paused: false,
    };
  }
  const head = Number(source.head_offset);
  const pending = Math.max(0, head - checkpoint);
  return {
    ...base,
    source_head_offset: head,
    pending_deliveries: pending,
    status: pending === 0 ? "current" : "delayed",
    consumer_paused: source.consumer_paused,
  };
}

export async function metricsHistory(db: Queryable): Promise<MonthMetrics[]> {
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

export async function restatements(db: Queryable): Promise<Restatement[]> {
  const { rows } = await db.query<RestatementRow>(
    `SELECT r.id, r.metric, r.period, r.previous_value::text AS previous_value, r.new_value::text AS new_value,
            r.cause_event_id, r.detected_at_checkpoint, e.type AS cause_type, e.effective_at AS cause_effective_at,
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
    detected_at_checkpoint: Number(row.detected_at_checkpoint),
    sentence: restatementSentence(row),
  }));
}
