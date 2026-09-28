import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CurrentMetrics, MonthMetrics, Restatement } from "@fresh-ledger/shared";
import { createApp } from "../src/app.js";
import { processBatch, processUntilCaughtUp } from "../src/consumer.js";
import { currentMetrics } from "../src/metrics.js";
import { fixture, loadTestFixture, prepareDatabase, testPool } from "./helpers.js";

beforeAll(prepareDatabase);
beforeEach(() => loadTestFixture());
afterAll(() => testPool.end());

const app = createApp(testPool, { demo: fixture });

async function getJson<T>(path: string): Promise<T> {
  const response = await app.request(path);
  expect(response.status).toBe(200);
  return (await response.json()) as T;
}

async function demo(action: string) {
  const response = await app.request(`/api/demo/${action}`, { method: "POST" });
  expect(response.status).toBe(200);
  return (await response.json()) as { head_offset: number; consumer_paused: boolean };
}

describe("api", () => {
  it("serves the bootstrap snapshot as delayed before the consumer has run", async () => {
    const current = await getJson<CurrentMetrics>("/api/metrics/current");
    expect(current).toEqual({
      snapshot_id: 1,
      checkpoint_offset: 0,
      checkpoint_source_received_at: null,
      source_head_offset: fixture.initial_head,
      pending_deliveries: fixture.initial_head,
      status: "delayed",
      consumer_paused: false,
      conflicts: 0,
      metrics: { mrr: "0.000000", arr: "0.000000", active_subscribers: 0 },
    });
  });

  it("INV-5 values and checkpoint come from one snapshot row even when a newer snapshot lands mid-request, and pending is head minus checkpoint", async () => {
    await processUntilCaughtUp(testPool);
    const { rows: snapshots } = await testPool.query<{
      id: string;
      checkpoint_offset: string;
      current_mrr: string;
      current_arr: string;
      active_subscribers: number;
      conflicts: number;
    }>(
      "SELECT id, checkpoint_offset, current_mrr::text AS current_mrr, current_arr::text AS current_arr, active_subscribers, conflicts FROM metric_snapshots ORDER BY checkpoint_offset DESC LIMIT 1",
    );
    const read = snapshots[0];
    if (read === undefined) throw new Error("no snapshot");
    await testPool.query("UPDATE source_state SET head_offset = $1", [3250]);

    let interceptedOnce = false;
    const racing = {
      query: async (text: string, values?: unknown[]) => {
        const result = await testPool.query(text, values);
        if (!interceptedOnce && text.includes("FROM metric_snapshots")) {
          interceptedOnce = true;
          await testPool.query(
            "INSERT INTO metric_snapshots (checkpoint_offset, checkpoint_source_received_at, current_mrr, current_arr, active_subscribers, conflicts) VALUES (3100, now(), 999, 11988, 999, 9)",
          );
        }
        return result;
      },
    } as Pick<import("pg").PoolClient, "query">;

    const current = await currentMetrics(racing);

    expect(current).toEqual({
      snapshot_id: Number(read.id),
      checkpoint_offset: 3000,
      checkpoint_source_received_at: expect.any(String) as string,
      source_head_offset: 3250,
      pending_deliveries: 250,
      status: "delayed",
      consumer_paused: false,
      conflicts: read.conflicts,
      metrics: {
        mrr: read.current_mrr,
        arr: read.current_arr,
        active_subscribers: read.active_subscribers,
      },
    });
  });

  it("INV-10 paused with the head advanced: never current, values unchanged, pending grows", async () => {
    await processUntilCaughtUp(testPool);
    const before = await getJson<CurrentMetrics>("/api/metrics/current");
    expect(before.status).toBe("current");

    expect(await demo("pause")).toEqual({
      head_offset: fixture.initial_head,
      consumer_paused: true,
    });
    expect(await demo("advance-source")).toEqual({ head_offset: 3100, consumer_paused: true });
    expect(await processBatch(testPool)).toMatchObject({ outcome: "paused", checkpoint: 3000 });
    const paused = await getJson<CurrentMetrics>("/api/metrics/current");
    expect(paused).toEqual({
      ...before,
      source_head_offset: 3100,
      pending_deliveries: 100,
      status: "delayed",
      consumer_paused: true,
    });

    expect(await demo("advance-source")).toEqual({ head_offset: 3200, consumer_paused: true });
    const later = await getJson<CurrentMetrics>("/api/metrics/current");
    expect(later).toEqual({ ...paused, source_head_offset: 3200, pending_deliveries: 200 });

    expect(await demo("resume")).toEqual({ head_offset: 3200, consumer_paused: false });
    await processUntilCaughtUp(testPool);
    const resumed = await getJson<CurrentMetrics>("/api/metrics/current");
    expect(resumed).toMatchObject({
      checkpoint_offset: 3200,
      source_head_offset: 3200,
      pending_deliveries: 0,
      status: "current",
      consumer_paused: false,
    });
  });

  it("advance-source never releases past the reserve, and the late and duplicate controls release exactly their deliveries", async () => {
    for (let i = 0; i < 6; i++) await demo("advance-source");
    expect(await demo("advance-source")).toEqual({
      head_offset: fixture.reserve_end,
      consumer_paused: false,
    });
    expect(await demo("inject-late-cancellation")).toEqual({
      head_offset: fixture.late_cancellation_offset,
      consumer_paused: false,
    });
    expect(await demo("inject-late-cancellation")).toEqual({
      head_offset: fixture.late_cancellation_offset,
      consumer_paused: false,
    });
    expect(await demo("replay-duplicate")).toEqual({
      head_offset: fixture.duplicate_offset,
      consumer_paused: false,
    });
    expect(await demo("advance-source")).toEqual({
      head_offset: fixture.duplicate_offset,
      consumer_paused: false,
    });
    const unknown = await app.request("/api/demo/release-conflict", { method: "POST" });
    expect(unknown.status).toBe(404);
    const withoutDemo = await createApp(testPool).request("/api/demo/pause", { method: "POST" });
    expect(withoutDemo.status).toBe(404);
  });

  it("INV-9 after the late cancellation the API is current, the closed month is marked restated and the provisional month reflects it", async () => {
    await demo("inject-late-cancellation");
    await processUntilCaughtUp(testPool);
    const late = fixture.deliveries[fixture.late_cancellation_offset - 1];

    const current = await getJson<CurrentMetrics>("/api/metrics/current");
    expect(current).toMatchObject({
      checkpoint_offset: fixture.late_cancellation_offset,
      source_head_offset: fixture.late_cancellation_offset,
      pending_deliveries: 0,
      status: "current",
    });

    const history = await getJson<MonthMetrics[]>("/api/metrics/history");
    const periods = history.map((m) => m.period);
    expect(periods).toEqual([...periods].sort());
    expect(history.filter((m) => m.state === "provisional")).toEqual([
      {
        period: late?.source_received_at.slice(0, 7),
        mrr: current.metrics.mrr,
        active_subscribers: current.metrics.active_subscribers,
        computed_at_checkpoint: null,
        state: "provisional",
        restated: false,
      },
    ]);
    const closedPeriods = history.filter((m) => m.state === "closed").map((m) => m.period);
    expect(closedPeriods.at(-1)).toBe("2026-08");
    const { rows: restatedPeriods } = await testPool.query<{ period: string }>(
      "SELECT DISTINCT period FROM restatements ORDER BY period",
    );
    expect(history.filter((m) => m.restated).map((m) => m.period)).toEqual(
      restatedPeriods.map((r) => r.period),
    );
    expect(restatedPeriods.map((r) => r.period)).toContain(fixture.late_cancellation_period);
    const { rows: projection } = await testPool.query<{ status: string }>(
      "SELECT status FROM subscriber_projections WHERE subscriber_id = $1",
      [late?.payload.subscriber_id],
    );
    expect(projection).toEqual([{ status: "inactive" }]);

    const restatements = await getJson<Restatement[]>("/api/restatements");
    const { rows: stored } = await testPool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM restatements",
    );
    expect(restatements.length).toBe(stored[0]?.n);
    expect(restatements.map((r) => r.id)).toEqual(
      [...restatements.map((r) => r.id)].sort((a, b) => b - a),
    );
    const mrr = restatements.find(
      (r) => r.metric === "mrr" && r.detected_at_checkpoint === fixture.late_cancellation_offset,
    );
    expect(mrr).toMatchObject({
      period: fixture.late_cancellation_period,
      cause_event_id: late?.event_id,
      detected_at_checkpoint: fixture.late_cancellation_offset,
    });
    expect(mrr?.sentence).toMatch(
      /^July 2026 MRR changed from [\d,]+\.\d\d to [\d,]+\.\d\d\. A cancellation effective Jul 17 arrived at source offset 3,501\.$/,
    );
  });
});
