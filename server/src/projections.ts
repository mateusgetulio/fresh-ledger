import type pg from "pg";
import { loadSql } from "./db.js";
import { fold, type LedgerEvent } from "./domain/fold.js";

const statesSql = loadSql("subscriber_states");
const upsertSql = loadSql("upsert_projections").replace("__SUBSCRIBER_STATES__", statesSql);

type Queryable = Pick<pg.PoolClient, "query">;

export async function loadEvents(
  db: Queryable,
  subscriberIds: string[],
): Promise<Map<string, LedgerEvent[]>> {
  const { rows } = await db.query<{
    event_id: string;
    subscriber_id: string;
    type: LedgerEvent["type"];
    plan_id: string | null;
    effective_at: Date;
    first_source_offset: string;
  }>(
    "SELECT event_id, subscriber_id, type, plan_id, effective_at, first_source_offset FROM events WHERE subscriber_id = ANY ($1::text[])",
    [subscriberIds],
  );
  const grouped = new Map<string, LedgerEvent[]>();
  for (const row of rows) {
    const list = grouped.get(row.subscriber_id) ?? [];
    list.push({ ...row, first_source_offset: Number(row.first_source_offset) });
    grouped.set(row.subscriber_id, list);
  }
  return grouped;
}

export async function refoldSubscribers(db: Queryable, subscriberIds: string[]): Promise<number> {
  if (subscriberIds.length === 0) return 0;
  const grouped = await loadEvents(db, subscriberIds);
  await db.query("DELETE FROM event_conflicts WHERE subscriber_id = ANY ($1::text[])", [
    subscriberIds,
  ]);
  let conflictTotal = 0;
  for (const subscriberId of subscriberIds) {
    const { conflicts } = fold(grouped.get(subscriberId) ?? []);
    for (const conflict of conflicts) {
      await db.query(
        "INSERT INTO event_conflicts (event_id, subscriber_id, detail) VALUES ($1, $2, $3)",
        [conflict.event_id, subscriberId, conflict.detail],
      );
    }
    conflictTotal += conflicts.length;
  }
  await db.query(upsertSql, [subscriberIds]);
  return conflictTotal;
}

export async function rebuildAllProjections(db: Queryable): Promise<void> {
  const { rows } = await db.query<{ subscriber_id: string }>(
    "SELECT DISTINCT subscriber_id FROM events",
  );
  await db.query("DELETE FROM subscriber_projections");
  await refoldSubscribers(
    db,
    rows.map((r) => r.subscriber_id),
  );
}
