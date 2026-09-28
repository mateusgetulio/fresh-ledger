import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { fold, orderByBusinessTime, type LedgerEvent } from "../src/domain/fold.js";

function event(partial: Partial<LedgerEvent> & { type: LedgerEvent["type"] }): LedgerEvent {
  return {
    event_id: partial.event_id ?? `e${Math.random()}`,
    subscriber_id: "s1",
    plan_id: partial.type === "subscription.cancelled" ? null : "basic_monthly",
    effective_at: new Date("2026-01-01T00:00:00Z"),
    first_source_offset: 1,
    ...partial,
  };
}

const at = (iso: string) => new Date(iso);

describe("fold", () => {
  it("folds a valid lifecycle by business time regardless of source order", () => {
    const events = [
      event({
        event_id: "cancel",
        type: "subscription.cancelled",
        effective_at: at("2026-03-01T00:00:00Z"),
        first_source_offset: 9,
      }),
      event({
        event_id: "start",
        type: "subscription.started",
        effective_at: at("2026-01-01T00:00:00Z"),
        first_source_offset: 3,
      }),
      event({
        event_id: "change",
        type: "subscription.plan_changed",
        plan_id: "pro_monthly",
        effective_at: at("2026-02-01T00:00:00Z"),
        first_source_offset: 1,
      }),
    ];
    const { state, conflicts } = fold(events);
    expect(conflicts).toEqual([]);
    expect(state).toEqual({
      status: "inactive",
      plan_id: null,
      last_event_id: "cancel",
      last_effective_at: at("2026-03-01T00:00:00Z"),
    });
  });

  it("INV-12 flags impossible sequences as conflicts and leaves them out of the state", () => {
    const events = [
      event({
        event_id: "change",
        type: "subscription.plan_changed",
        plan_id: "pro_monthly",
        effective_at: at("2025-12-01T00:00:00Z"),
      }),
      event({
        event_id: "start",
        type: "subscription.started",
        effective_at: at("2026-01-01T00:00:00Z"),
      }),
      event({
        event_id: "start2",
        type: "subscription.started",
        plan_id: "pro_annual",
        effective_at: at("2026-02-01T00:00:00Z"),
      }),
    ];
    const { state, conflicts } = fold(events);
    expect(conflicts).toEqual([
      { event_id: "change", detail: "plan changed while inactive" },
      { event_id: "start2", detail: "started while already active" },
    ]);
    expect(state).toEqual({
      status: "active",
      plan_id: "basic_monthly",
      last_event_id: "start",
      last_effective_at: at("2026-01-01T00:00:00Z"),
    });
  });

  it("a cancellation on an inactive subscriber is a recorded no-op, not a conflict", () => {
    const { state, conflicts } = fold([
      event({
        event_id: "c1",
        type: "subscription.cancelled",
        effective_at: at("2026-01-01T00:00:00Z"),
      }),
      event({
        event_id: "c2",
        type: "subscription.cancelled",
        effective_at: at("2026-01-02T00:00:00Z"),
      }),
    ]);
    expect(conflicts).toEqual([]);
    expect(state.status).toBe("inactive");
    expect(state.last_event_id).toBe("c2");
  });

  it("breaks effective_at ties by source offset", () => {
    const same = at("2026-01-01T00:00:00Z");
    const { state } = fold([
      event({
        event_id: "later",
        type: "subscription.plan_changed",
        plan_id: "pro_monthly",
        effective_at: same,
        first_source_offset: 20,
      }),
      event({
        event_id: "first",
        type: "subscription.started",
        effective_at: same,
        first_source_offset: 10,
      }),
    ]);
    expect(state.plan_id).toBe("pro_monthly");
    expect(state.last_event_id).toBe("later");
  });

  it("INV-6 the fold is a pure function of the event set: any input order gives the same result", () => {
    const eventArb = fc.record({
      type: fc.constantFrom(
        "subscription.started",
        "subscription.plan_changed",
        "subscription.cancelled",
      ) as fc.Arbitrary<LedgerEvent["type"]>,
      effective_at: fc.date({
        min: new Date("2025-10-01T00:00:00Z"),
        max: new Date("2026-09-28T00:00:00Z"),
        noInvalidDate: true,
      }),
      first_source_offset: fc.integer({ min: 1, max: 5000 }),
    });
    fc.assert(
      fc.property(
        fc.uniqueArray(eventArb, {
          minLength: 0,
          maxLength: 12,
          selector: (e) => e.first_source_offset,
        }),
        fc.nat(),
        (raw, rotate) => {
          const events: LedgerEvent[] = raw.map((e, i) => ({
            ...e,
            event_id: `e${i}`,
            subscriber_id: "s1",
            plan_id: e.type === "subscription.cancelled" ? null : "basic_monthly",
          }));
          const shifted =
            events.length === 0
              ? events
              : [
                  ...events.slice(rotate % events.length),
                  ...events.slice(0, rotate % events.length),
                ];
          expect(fold(shifted)).toEqual(fold(events));
          expect(
            fold(events).state.status === "active" || fold(events).state.plan_id === null,
          ).toBe(true);
          expect(orderByBusinessTime(shifted).map((e) => e.event_id)).toEqual(
            orderByBusinessTime(events).map((e) => e.event_id),
          );
        },
      ),
    );
  });
});
