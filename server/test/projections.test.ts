import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadSql } from "../src/db.js";
import { fold } from "../src/domain/fold.js";
import { loadEvents, rebuildAllProjections, refoldSubscribers } from "../src/projections.js";
import {
  delivery,
  fixture,
  insertEventsDirectly,
  loadTestFixture,
  prepareDatabase,
  testPool,
} from "./helpers.js";

beforeAll(prepareDatabase);
beforeEach(() => loadTestFixture());
afterAll(() => testPool.end());

async function projections() {
  const { rows } = await testPool.query(
    "SELECT * FROM subscriber_projections ORDER BY subscriber_id",
  );
  return rows;
}

describe("projections", () => {
  it("normalizes MRR in SQL as monthly price or annual price over twelve, with NUMERIC precision", async () => {
    await insertEventsDirectly([
      delivery({
        event_id: "m",
        source_offset: 1,
        payload: { subscriber_id: "s_m", plan_id: "pro_monthly" },
      }),
      delivery({
        event_id: "a",
        source_offset: 2,
        payload: { subscriber_id: "s_a", plan_id: "basic_annual" },
      }),
    ]);
    const rows = await projections();
    expect(rows.map((r) => [r.subscriber_id, r.status, r.plan_id, r.current_mrr])).toEqual([
      ["s_a", "active", "basic_annual", "16.000000"],
      ["s_m", "active", "pro_monthly", "50.000000"],
    ]);
  });

  it("derives state from business time, so a late cancellation wins over a newer-offset plan change", async () => {
    await insertEventsDirectly([
      delivery({
        event_id: "start",
        source_offset: 1,
        payload: { effective_at: "2026-06-01T00:00:00.000Z" },
      }),
      delivery({
        event_id: "change",
        source_offset: 2,
        payload: {
          type: "subscription.plan_changed",
          plan_id: "pro_monthly",
          effective_at: "2026-09-01T00:00:00.000Z",
        },
      }),
      delivery({
        event_id: "late_cancel",
        source_offset: 3,
        payload: { type: "subscription.cancelled", effective_at: "2026-08-17T00:00:00.000Z" },
      }),
    ]);
    const [row] = await projections();
    expect([
      row?.status,
      row?.plan_id,
      row?.current_mrr,
      row?.last_event_id,
      row?.conflict_count,
    ]).toEqual(["inactive", null, "0.000000", "late_cancel", 1]);
    const { rows: conflicts } = await testPool.query(
      "SELECT event_id, detail FROM event_conflicts",
    );
    expect(conflicts).toEqual([{ event_id: "change", detail: "plan changed while inactive" }]);
  });

  it("a subscriber whose only event is a conflict still gets an inactive projection row", async () => {
    await insertEventsDirectly([
      delivery({
        event_id: "orphan_change",
        source_offset: 1,
        payload: {
          type: "subscription.plan_changed",
          plan_id: "pro_monthly",
          effective_at: "2026-06-01T00:00:00.000Z",
        },
      }),
    ]);
    const rows = await projections();
    expect(
      rows.map((r) => [
        r.subscriber_id,
        r.status,
        r.plan_id,
        r.current_mrr,
        r.last_event_id,
        r.conflict_count,
      ]),
    ).toEqual([["sub_test", "inactive", null, "0.000000", null, 1]]);
  });

  it("INV-6 rebuilding every projection from the ledger reproduces the same rows, and SQL agrees with the fold", async () => {
    const subscribers = await insertEventsDirectly(
      fixture.deliveries.slice(0, fixture.initial_head),
    );
    const before = await projections();
    expect(before.length).toBe(subscribers.length);

    await rebuildAllProjections(testPool);
    expect(await projections()).toEqual(before);

    const grouped = await loadEvents(testPool, subscribers);
    for (const row of before) {
      const folded = fold(grouped.get(row.subscriber_id) ?? []);
      expect([row.status, row.plan_id, row.last_event_id, row.conflict_count]).toEqual([
        folded.state.status,
        folded.state.plan_id,
        folded.state.last_event_id,
        folded.conflicts.length,
      ]);
    }
  });

  it("refolding only the named subscribers leaves the others untouched", async () => {
    await insertEventsDirectly(fixture.deliveries.slice(0, 200));
    const before = await projections();
    const first = before[0]?.subscriber_id;
    if (first === undefined) throw new Error("no projections to refold");

    await refoldSubscribers(testPool, [first]);

    expect(await projections()).toEqual(before);
  });

  it("INV-11 an annual price that does not divide evenly still reconciles exactly in SQL", async () => {
    await testPool.query(
      "INSERT INTO plans (id, name, cadence, price_cents) VALUES ('odd_annual', 'Odd annual', 'annual', 10001)",
    );
    const odd = Array.from({ length: 3 }, (_, i) =>
      delivery({
        event_id: `odd_${i}`,
        source_offset: i + 1,
        payload: {
          subscriber_id: `sub_odd_${i}`,
          plan_id: "odd_annual",
          effective_at: "2026-01-01T00:00:00.000Z",
        },
      }),
    );
    await insertEventsDirectly(odd);
    const rows = await projections();
    expect(rows.map((r) => r.current_mrr)).toEqual(["8.334167", "8.334167", "8.334167"]);

    const { rows: sums } = await testPool.query<{ mrr: string; active: number }>(
      "SELECT coalesce(sum(current_mrr), 0)::numeric(18,6)::text AS mrr, count(*) FILTER (WHERE status = 'active')::int AS active FROM subscriber_projections",
    );
    expect(sums[0]?.mrr).toBe("25.002501");
    await testPool.query(
      "INSERT INTO metric_snapshots (checkpoint_offset, checkpoint_source_received_at, current_mrr, current_arr, active_subscribers) VALUES (3, now(), $1, $1::numeric * 12, $2)",
      [sums[0]?.mrr, sums[0]?.active],
    );
    const reconcile = loadSql("reconcile").replace(
      "__SUBSCRIBER_STATES__",
      loadSql("subscriber_states"),
    );
    const { rows: reconciled } = await testPool.query(reconcile, [null]);
    expect(reconciled[0]).toMatchObject({
      reconciled: true,
      snapshot_mrr: "25.002501",
      folded_mrr: "25.002501",
    });
  });

  it("the reconciliation query agrees across snapshot, projections and the ledger fold", async () => {
    await insertEventsDirectly(fixture.deliveries.slice(0, 500));
    const { rows: sums } = await testPool.query<{ mrr: string; active: number }>(
      "SELECT coalesce(sum(current_mrr), 0)::numeric(18,6)::text AS mrr, count(*) FILTER (WHERE status = 'active')::int AS active FROM subscriber_projections",
    );
    await testPool.query(
      "INSERT INTO metric_snapshots (checkpoint_offset, checkpoint_source_received_at, current_mrr, current_arr, active_subscribers) VALUES (500, now(), $1, $1::numeric * 12, $2)",
      [sums[0]?.mrr, sums[0]?.active],
    );
    const reconcile = loadSql("reconcile").replace(
      "__SUBSCRIBER_STATES__",
      loadSql("subscriber_states"),
    );
    const { rows } = await testPool.query(reconcile, [null]);
    expect(rows[0]?.reconciled).toBe(true);
    expect(rows[0]?.snapshot_mrr).toBe(rows[0]?.folded_mrr);
  });
});
