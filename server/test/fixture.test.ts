import { describe, expect, it } from "vitest";
import { generateFixture } from "../src/fixture/generate.js";
import { fixture } from "./helpers.js";

describe("fixture", () => {
  it("regenerates identically from the seed and matches the committed file", () => {
    const regenerated = generateFixture(fixture.seed);
    expect(regenerated).toEqual(fixture);
    expect(generateFixture(fixture.seed)).toEqual(regenerated);
  });

  it("respects the source invariants: contiguous offsets, non-decreasing receipt, no future-dated events", () => {
    fixture.deliveries.forEach((d, i) => {
      expect(d.source_offset).toBe(i + 1);
      expect(d.payload.effective_at <= d.source_received_at).toBe(true);
      const previous = fixture.deliveries[i - 1];
      if (previous) expect(previous.source_received_at <= d.source_received_at).toBe(true);
    });
  });

  it("carries the seeded demo deliveries at known offsets", () => {
    const late = fixture.deliveries[fixture.late_cancellation_offset - 1];
    const duplicate = fixture.deliveries[fixture.duplicate_offset - 1];
    const original = fixture.deliveries.find(
      (d) => d.event_id === duplicate?.event_id && d.source_offset < fixture.duplicate_offset,
    );
    expect(late?.payload.type).toBe("subscription.cancelled");
    expect(
      late?.payload.effective_at.startsWith(`${fixture.late_cancellation_period}-17T09:30`),
    ).toBe(true);
    expect(
      fixture.late_cancellation_period <
        (fixture.deliveries[fixture.reserve_end - 1]?.source_received_at.slice(0, 7) ?? ""),
    ).toBe(true);
    expect(late?.source_received_at.startsWith("2026-09-28")).toBe(true);
    expect(original?.source_offset).toBe(fixture.late_cancellation_offset);
    expect(duplicate?.payload).toEqual(original?.payload);
    const conflict = fixture.deliveries[fixture.conflict_offset - 1];
    const earliestForSubscriber = fixture.deliveries
      .filter(
        (d) =>
          d.source_offset <= fixture.reserve_end &&
          d.payload.subscriber_id === conflict?.payload.subscriber_id,
      )
      .map((d) => d.payload.effective_at)
      .sort()[0];
    expect(conflict?.payload.type).toBe("subscription.plan_changed");
    expect((conflict?.payload.effective_at ?? "") < (earliestForSubscriber ?? "")).toBe(true);
    expect(fixture.conflict_offset).toBe(fixture.deliveries.length);
    const laterForSubscriber = fixture.deliveries.filter(
      (d) =>
        d.source_offset <= fixture.reserve_end &&
        d.payload.subscriber_id === late?.payload.subscriber_id &&
        d.payload.effective_at > (late?.payload.effective_at ?? ""),
    );
    expect(laterForSubscriber).toEqual([]);
  });
});
