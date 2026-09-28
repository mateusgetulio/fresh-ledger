import type pg from "pg";
import { createPool } from "../src/db.js";
import { readFixture, loadFixture, resetDatabase } from "../src/fixture/load.js";
import type { Fixture, FixtureDelivery } from "../src/fixture/generate.js";
import { migrate } from "../src/migrate.js";
import { refoldSubscribers } from "../src/projections.js";

export const testPool: pg.Pool = createPool(
  process.env.TEST_DATABASE_URL ?? "postgres://fresh:fresh@localhost:5433/fresh_ledger_test",
);

export async function prepareDatabase(): Promise<void> {
  await migrate(testPool);
  await resetDatabase(testPool);
}

export const fixture: Fixture = readFixture();

export async function loadTestFixture(head?: number): Promise<Fixture> {
  await loadFixture(testPool, fixture, head);
  return fixture;
}

export async function insertEventsDirectly(deliveries: FixtureDelivery[]): Promise<string[]> {
  const subscribers = new Set<string>();
  for (const d of deliveries) {
    await testPool.query(
      `INSERT INTO events (event_id, subscriber_id, type, plan_id, effective_at, first_source_offset)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (event_id) DO NOTHING`,
      [
        d.event_id,
        d.payload.subscriber_id,
        d.payload.type,
        d.payload.plan_id ?? null,
        d.payload.effective_at,
        d.source_offset,
      ],
    );
    subscribers.add(d.payload.subscriber_id);
  }
  const ids = [...subscribers];
  await refoldSubscribers(testPool, ids);
  return ids;
}

type DeliveryOverrides = Omit<Partial<FixtureDelivery>, "payload"> & {
  payload?: Partial<FixtureDelivery["payload"]>;
};

export function delivery(overrides: DeliveryOverrides = {}): FixtureDelivery {
  const type = overrides.payload?.type ?? "subscription.started";
  return {
    source_offset: 1,
    source_received_at: "2026-09-28T14:00:00.000Z",
    event_id: "evt_test",
    ...overrides,
    payload: {
      subscriber_id: "sub_test",
      type,
      ...(type === "subscription.cancelled" ? {} : { plan_id: "basic_monthly" }),
      effective_at: "2026-09-01T00:00:00.000Z",
      ...overrides.payload,
    },
  };
}
