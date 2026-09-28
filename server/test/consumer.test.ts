import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  currentCheckpoint,
  lastClosedMonth,
  processBatch,
  processUntilCaughtUp,
} from "../src/consumer.js";
import { loadSql } from "../src/db.js";
import { loadFixture } from "../src/fixture/load.js";
import { delivery, fixture, loadTestFixture, prepareDatabase, testPool } from "./helpers.js";

beforeAll(prepareDatabase);
beforeEach(() => loadTestFixture());
afterAll(() => testPool.end());

async function snapshots() {
  const { rows } = await testPool.query(
    "SELECT checkpoint_offset::int AS checkpoint_offset, current_mrr::text AS current_mrr, current_arr::text AS current_arr, active_subscribers, conflicts FROM metric_snapshots ORDER BY checkpoint_offset",
  );
  return rows;
}

async function setHead(head: number) {
  await testPool.query("UPDATE source_state SET head_offset = $1", [head]);
}

describe("consumer", () => {
  it("processes contiguous batches of 100 and stops when caught up, INV-4 checkpoint monotonic and bounded", async () => {
    const results = await processUntilCaughtUp(testPool);

    const processed = results.filter((r) => r.outcome === "processed");
    expect(processed.map((r) => r.checkpoint)).toEqual(
      Array.from({ length: 30 }, (_, i) => (i + 1) * 100),
    );
    expect(results.at(-1)?.outcome).toBe("caught_up");
    const rows = await snapshots();
    expect(rows.map((r) => r.checkpoint_offset)).toEqual([
      0,
      ...processed.map((r) => r.checkpoint),
    ]);
    expect(Math.max(...rows.map((r) => r.checkpoint_offset))).toBeLessThanOrEqual(
      fixture.initial_head,
    );
    expect(await currentCheckpoint(testPool)).toBe(3000);
    const { rows: results_ } = await testPool.query(
      "SELECT result, count(*)::int AS n FROM source_deliveries WHERE source_offset <= 3000 GROUP BY result",
    );
    expect(results_).toEqual([{ result: "applied", n: 3000 }]);
  });

  it("INV-2 and INV-3 every snapshot reconciles to the projections and ARR is twelve times MRR, in SQL", async () => {
    let previousMrr = "0.000000";
    for (let batch = 0; batch < 30; batch++) {
      const result = await processBatch(testPool);
      expect(result.outcome).toBe("processed");
      const { rows } = await testPool.query<{
        snapshot_mrr: string;
        projected_mrr: string;
        arr_ok: boolean;
        active_ok: boolean;
      }>(
        `SELECT s.current_mrr::text AS snapshot_mrr,
                p.mrr::text AS projected_mrr,
                s.current_arr = s.current_mrr * 12 AS arr_ok,
                s.active_subscribers = p.active AS active_ok
         FROM metric_snapshots s,
              (SELECT coalesce(sum(current_mrr), 0)::numeric(18,6) AS mrr, count(*) FILTER (WHERE status = 'active')::int AS active FROM subscriber_projections) p
         WHERE s.checkpoint_offset = $1`,
        [result.checkpoint],
      );
      expect(rows[0]).toEqual({
        snapshot_mrr: rows[0]?.projected_mrr,
        projected_mrr: rows[0]?.projected_mrr,
        arr_ok: true,
        active_ok: true,
      });
      expect(rows[0]?.snapshot_mrr).not.toBe(previousMrr);
      previousMrr = rows[0]?.snapshot_mrr ?? "";
    }
    const reconcile = loadSql("reconcile").replace(
      "__SUBSCRIBER_STATES__",
      loadSql("subscriber_states"),
    );
    const { rows } = await testPool.query(reconcile, [null]);
    expect(rows[0]?.reconciled).toBe(true);
  });

  it("a paused consumer processes nothing and the checkpoint stays put while the head moves", async () => {
    await processUntilCaughtUp(testPool);
    await testPool.query("UPDATE source_state SET consumer_paused = true, head_offset = $1", [
      fixture.reserve_end,
    ]);

    const result = await processBatch(testPool);

    expect(result).toEqual({
      outcome: "paused",
      checkpoint: 3000,
      applied: 0,
      duplicates: 0,
      conflicts: 0,
      restatements: 0,
    });
    expect((await snapshots()).length).toBe(31);
  });

  it("INV-1 and INV-8 a redelivered event advances the checkpoint with no effect, no metric change and no restatement", async () => {
    await setHead(fixture.late_cancellation_offset);
    await processUntilCaughtUp(testPool);
    const before = await snapshots();
    const { rows: restatementsBefore } = await testPool.query(
      "SELECT count(*)::int AS n FROM restatements",
    );

    await setHead(fixture.duplicate_offset);
    const result = await processBatch(testPool);

    expect(result).toMatchObject({
      outcome: "processed",
      checkpoint: fixture.duplicate_offset,
      applied: 0,
      duplicates: 1,
      restatements: 0,
    });
    const after = await snapshots();
    expect(after.at(-1)).toEqual({ ...before.at(-1), checkpoint_offset: fixture.duplicate_offset });
    const duplicate = fixture.deliveries[fixture.duplicate_offset - 1];
    const { rows: deliveries } = await testPool.query(
      "SELECT source_offset::int AS o, result FROM source_deliveries WHERE event_id = $1 ORDER BY source_offset",
      [duplicate?.event_id],
    );
    expect(deliveries).toEqual([
      { o: 42, result: "applied" },
      { o: fixture.duplicate_offset, result: "duplicate" },
    ]);
    const { rows: events } = await testPool.query(
      "SELECT count(*)::int AS n FROM events WHERE event_id = $1",
      [duplicate?.event_id],
    );
    expect(events[0]?.n).toBe(1);
    const { rows: restatementsAfter } = await testPool.query(
      "SELECT count(*)::int AS n FROM restatements",
    );
    expect(restatementsAfter).toEqual(restatementsBefore);
  });

  it("INV-7 and INV-9 the late cancellation restates the closed month it belongs to and leaves the consumer current", async () => {
    await setHead(fixture.reserve_end);
    await processUntilCaughtUp(testPool);
    const period = fixture.late_cancellation_period;
    const { rows: augustBefore } = await testPool.query(
      "SELECT mrr::text AS mrr, active_subscribers FROM monthly_metrics WHERE period = $1",
      [period],
    );
    const { rows: subscriber } = await testPool.query(
      "SELECT current_mrr::text AS mrr FROM subscriber_projections WHERE subscriber_id = $1",
      [fixture.deliveries[fixture.late_cancellation_offset - 1]?.payload.subscriber_id],
    );
    expect(Number(subscriber[0]?.mrr)).toBeGreaterThan(0);

    await setHead(fixture.late_cancellation_offset);
    const result = await processBatch(testPool);

    expect(result).toMatchObject({
      outcome: "processed",
      checkpoint: fixture.late_cancellation_offset,
      applied: 1,
      duplicates: 0,
    });
    expect(result.restatements).toBe(2);
    const { rows: augustAfter } = await testPool.query(
      "SELECT mrr::text AS mrr, active_subscribers FROM monthly_metrics WHERE period = $1",
      [period],
    );
    expect(Number(augustBefore[0]?.mrr) - Number(augustAfter[0]?.mrr)).toBeCloseTo(
      Number(subscriber[0]?.mrr),
      5,
    );
    expect(
      (augustBefore[0]?.active_subscribers ?? 0) - (augustAfter[0]?.active_subscribers ?? 0),
    ).toBe(1);
    const { rows: restatements } = await testPool.query(
      "SELECT metric, period, previous_value::text AS previous_value, new_value::text AS new_value, cause_event_id, detected_at_checkpoint::int AS at FROM restatements WHERE detected_at_checkpoint = $1 ORDER BY id",
      [fixture.late_cancellation_offset],
    );
    expect(restatements).toEqual([
      {
        metric: "mrr",
        period,
        previous_value: augustBefore[0]?.mrr,
        new_value: augustAfter[0]?.mrr,
        cause_event_id: "evt_03982",
        at: fixture.late_cancellation_offset,
      },
      {
        metric: "active_subscribers",
        period,
        previous_value: `${augustBefore[0]?.active_subscribers}.000000`,
        new_value: `${augustAfter[0]?.active_subscribers}.000000`,
        cause_event_id: "evt_03982",
        at: fixture.late_cancellation_offset,
      },
    ]);
    const { rows: earlier } = await testPool.query(
      "SELECT count(*)::int AS n FROM restatements WHERE period < $1",
      [period],
    );
    expect(earlier[0]?.n).toBe(0);
    expect(await currentCheckpoint(testPool)).toBe(fixture.late_cancellation_offset);
  });

  it("months close as the checkpoint moves, and only events effective in a closed month can restate it", async () => {
    await setHead(1000);
    await processUntilCaughtUp(testPool);
    const { rows: early } = await testPool.query(
      "SELECT period FROM monthly_metrics ORDER BY period",
    );
    await setHead(3000);
    await processUntilCaughtUp(testPool);
    const { rows: later } = await testPool.query(
      "SELECT period FROM monthly_metrics ORDER BY period",
    );
    const { rows: restatements } = await testPool.query<{
      period: string;
      effective_month: string;
      received: Date;
      period_end: Date;
    }>(
      `SELECT r.period, to_char(e.effective_at, 'YYYY-MM') AS effective_month, d.source_received_at AS received,
              (to_date(r.period, 'YYYY-MM') + interval '1 month')::timestamptz AS period_end
       FROM restatements r JOIN events e ON e.event_id = r.cause_event_id
       JOIN source_deliveries d ON d.source_offset = e.first_source_offset`,
    );

    const receiptOf3000 = new Date(fixture.deliveries[2999]?.source_received_at ?? "");
    expect(later.length).toBeGreaterThan(early.length);
    expect(later.at(-1)?.period).toBe(lastClosedMonth(receiptOf3000).toISOString().slice(0, 7));
    for (const r of restatements) {
      expect(r.effective_month).toBe(r.period);
      expect(r.received.getTime()).toBeGreaterThanOrEqual(r.period_end.getTime());
    }
  });

  it("INV-12 a semantic conflict is classified, excluded from the fold and does not block the checkpoint", async () => {
    await loadFixture(
      testPool,
      {
        ...fixture,
        initial_head: 3,
        deliveries: [
          delivery({
            source_offset: 1,
            event_id: "c1",
            source_received_at: "2026-09-01T00:00:00.000Z",
            payload: {
              type: "subscription.plan_changed",
              plan_id: "pro_monthly",
              effective_at: "2026-05-01T00:00:00.000Z",
            },
          }),
          delivery({
            source_offset: 2,
            event_id: "c2",
            source_received_at: "2026-09-02T00:00:00.000Z",
            payload: { effective_at: "2026-06-01T00:00:00.000Z" },
          }),
          delivery({
            source_offset: 3,
            event_id: "c3",
            source_received_at: "2026-09-03T00:00:00.000Z",
            payload: { subscriber_id: "sub_other", effective_at: "2026-06-02T00:00:00.000Z" },
          }),
        ],
      },
      3,
    );

    const result = await processBatch(testPool);

    expect(result).toMatchObject({
      outcome: "processed",
      checkpoint: 3,
      applied: 3,
      duplicates: 0,
      conflicts: 1,
    });
    const { rows: deliveries } = await testPool.query(
      "SELECT source_offset::int AS o, result, result_detail FROM source_deliveries ORDER BY source_offset",
    );
    expect(deliveries).toEqual([
      { o: 1, result: "conflict", result_detail: "plan changed while inactive" },
      { o: 2, result: "applied", result_detail: null },
      { o: 3, result: "applied", result_detail: null },
    ]);
    const { rows: projection } = await testPool.query(
      "SELECT status, plan_id, current_mrr::text AS mrr, conflict_count FROM subscriber_projections WHERE subscriber_id = 'sub_test'",
    );
    expect(projection).toEqual([
      { status: "active", plan_id: "basic_monthly", mrr: "20.000000", conflict_count: 1 },
    ]);
    expect((await snapshots()).at(-1)).toMatchObject({
      checkpoint_offset: 3,
      current_mrr: "40.000000",
      active_subscribers: 2,
      conflicts: 1,
    });
  });

  it("a batch that cannot commit leaves no events, no results and no checkpoint change", async () => {
    await testPool.query(
      "INSERT INTO metric_snapshots (checkpoint_offset, checkpoint_source_received_at, current_mrr, current_arr, active_subscribers) VALUES (100, now(), 1, 12, 1)",
    );
    await testPool.query("DELETE FROM metric_snapshots WHERE checkpoint_offset = 100");
    await testPool.query("UPDATE source_state SET head_offset = 100");
    const blocker = await testPool.connect();
    await blocker.query("BEGIN");
    await blocker.query(
      "INSERT INTO metric_snapshots (checkpoint_offset, checkpoint_source_received_at, current_mrr, current_arr, active_subscribers) VALUES (100, now(), 1, 12, 1)",
    );

    const attempt = processBatch(testPool);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await blocker.query("COMMIT");
    blocker.release();
    await expect(attempt).rejects.toThrow(/duplicate key/);

    const { rows: events } = await testPool.query("SELECT count(*)::int AS n FROM events");
    const { rows: processed } = await testPool.query(
      "SELECT count(*)::int AS n FROM source_deliveries WHERE result IS NOT NULL",
    );
    expect(events[0]?.n).toBe(0);
    expect(processed[0]?.n).toBe(0);
    expect((await snapshots()).map((s) => s.checkpoint_offset)).toEqual([0, 100]);
  });

  it("derives the last closed month from the checkpoint delivery's receipt month", () => {
    expect(lastClosedMonth(new Date("2026-09-28T14:05:00Z")).toISOString().slice(0, 10)).toBe(
      "2026-08-01",
    );
    expect(lastClosedMonth(new Date("2026-01-01T00:00:00Z")).toISOString().slice(0, 10)).toBe(
      "2025-12-01",
    );
  });
});
