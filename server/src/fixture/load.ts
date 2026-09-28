import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import type { Fixture } from "./generate.js";

const defaultPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "deliveries.json",
);

export function readFixture(path: string = defaultPath): Fixture {
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

export async function resetDatabase(pool: pg.Pool): Promise<void> {
  await pool.query(
    "TRUNCATE restatements, monthly_metrics, subscriber_projections, event_conflicts, events, source_deliveries, plans RESTART IDENTITY CASCADE",
  );
  await pool.query("DELETE FROM metric_snapshots");
  await pool.query(
    "INSERT INTO metric_snapshots (checkpoint_offset, checkpoint_source_received_at, current_mrr, current_arr, active_subscribers) VALUES (0, NULL, 0, 0, 0)",
  );
  await pool.query("UPDATE source_state SET head_offset = 0, consumer_paused = false");
}

export async function loadFixture(
  pool: pg.Pool,
  fixture: Fixture,
  head: number = fixture.initial_head,
): Promise<void> {
  await resetDatabase(pool);
  for (const plan of fixture.plans) {
    await pool.query("INSERT INTO plans (id, name, cadence, price_cents) VALUES ($1, $2, $3, $4)", [
      plan.id,
      plan.name,
      plan.cadence,
      plan.price_cents,
    ]);
  }
  const chunk = 500;
  for (let i = 0; i < fixture.deliveries.length; i += chunk) {
    const slice = fixture.deliveries.slice(i, i + chunk);
    const values = slice
      .map((_, n) => `($${n * 4 + 1}, $${n * 4 + 2}, $${n * 4 + 3}, $${n * 4 + 4})`)
      .join(", ");
    const params = slice.flatMap((d) => [
      d.source_offset,
      d.source_received_at,
      d.event_id,
      JSON.stringify(d.payload),
    ]);
    await pool.query(
      `INSERT INTO source_deliveries (source_offset, source_received_at, event_id, payload) VALUES ${values}`,
      params,
    );
  }
  await pool.query("UPDATE source_state SET head_offset = $1", [head]);
}
