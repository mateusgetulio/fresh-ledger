import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mulberry32, pick } from "./random.js";

export interface FixtureDelivery {
  source_offset: number;
  source_received_at: string;
  event_id: string;
  payload: {
    subscriber_id: string;
    type: "subscription.started" | "subscription.plan_changed" | "subscription.cancelled";
    plan_id?: string;
    effective_at: string;
  };
}

export interface Fixture {
  seed: number;
  plans: { id: string; name: string; cadence: "monthly" | "annual"; price_cents: number }[];
  initial_head: number;
  reserve_end: number;
  late_cancellation_offset: number;
  late_cancellation_period: string;
  duplicate_offset: number;
  conflict_offset: number;
  deliveries: FixtureDelivery[];
}

export const PLANS: Fixture["plans"] = [
  { id: "basic_monthly", name: "Basic monthly", cadence: "monthly", price_cents: 2000 },
  { id: "pro_monthly", name: "Pro monthly", cadence: "monthly", price_cents: 5000 },
  { id: "basic_annual", name: "Basic annual", cadence: "annual", price_cents: 19200 },
  { id: "pro_annual", name: "Pro annual", cadence: "annual", price_cents: 48000 },
];

const BUSINESS_START = Date.UTC(2025, 9, 1);
const BUSINESS_END = Date.UTC(2026, 8, 27);
const DAY = 86_400_000;
const MAX_RECEIPT_DELAY = 2 * DAY;
const SUBSCRIBERS = 800;
const INITIAL = 3000;
const RESERVE = 500;

interface Draft {
  event_id: string;
  subscriber_id: string;
  type: FixtureDelivery["payload"]["type"];
  plan_id?: string;
  effective: number;
  received: number;
}

export function generateFixture(seed: number): Fixture {
  const random = mulberry32(seed);
  const drafts: Draft[] = [];
  const lastEventBySubscriber = new Map<string, Draft>();
  let counter = 0;
  const id = () => `evt_${String(++counter).padStart(5, "0")}`;

  for (let i = 1; i <= SUBSCRIBERS; i++) {
    const subscriber = `sub_${String(i).padStart(4, "0")}`;
    let at = BUSINESS_START + Math.floor(random() * (BUSINESS_END - BUSINESS_START) * 0.85);
    let active = false;
    let plan = pick(random, PLANS).id;
    const changes = 2 + Math.floor(random() * 8);
    for (let n = 0; n < changes && at < BUSINESS_END; n++) {
      let type: Draft["type"];
      if (!active) type = "subscription.started";
      else type = random() < 0.35 ? "subscription.cancelled" : "subscription.plan_changed";
      if (type === "subscription.plan_changed")
        plan = pick(
          random,
          PLANS.filter((p) => p.id !== plan),
        ).id;
      const draft: Draft = {
        event_id: id(),
        subscriber_id: subscriber,
        type,
        ...(type === "subscription.cancelled" ? {} : { plan_id: plan }),
        effective: at,
        received: at + Math.floor(random() * MAX_RECEIPT_DELAY),
      };
      drafts.push(draft);
      lastEventBySubscriber.set(subscriber, draft);
      active = type !== "subscription.cancelled";
      at += DAY * (3 + Math.floor(random() * 40));
    }
  }

  drafts.sort((a, b) => a.received - b.received || a.event_id.localeCompare(b.event_id));
  if (drafts.length < INITIAL + RESERVE)
    throw new Error(`fixture generated ${drafts.length} events, need ${INITIAL + RESERVE}`);
  const trimmed = drafts.slice(0, INITIAL + RESERVE);
  const lastReceived = trimmed.at(-1)?.received ?? BUSINESS_END;

  const receiptOfLast = new Date(lastReceived);
  const lateMonth = Date.UTC(receiptOfLast.getUTCFullYear(), receiptOfLast.getUTCMonth() - 1, 1);
  const lateEffective = lateMonth + 16 * DAY + 9.5 * 3_600_000;
  const trimmedIds = new Set(trimmed.map((d) => d.event_id));
  const candidates = [...lastEventBySubscriber.values()]
    .filter(
      (d) =>
        d.type !== "subscription.cancelled" &&
        d.effective < lateMonth &&
        trimmedIds.has(d.event_id),
    )
    .sort((a, b) => a.subscriber_id.localeCompare(b.subscriber_id));
  const lateTarget = pick(random, candidates);
  const late: Draft = {
    event_id: id(),
    subscriber_id: lateTarget.subscriber_id,
    type: "subscription.cancelled",
    effective: lateEffective,
    received: Math.max(lastReceived + 1000, Date.UTC(2026, 8, 28, 14, 5)),
  };
  const firstStarts = new Map<string, Draft>();
  for (const d of trimmed) {
    if (d.type !== "subscription.started" || d.subscriber_id === late.subscriber_id) continue;
    const known = firstStarts.get(d.subscriber_id);
    if (known === undefined || d.effective < known.effective) firstStarts.set(d.subscriber_id, d);
  }
  const conflictTarget = pick(
    random,
    [...firstStarts.values()].sort((a, b) => a.subscriber_id.localeCompare(b.subscriber_id)),
  );
  const conflict: Draft = {
    event_id: id(),
    subscriber_id: conflictTarget.subscriber_id,
    type: "subscription.plan_changed",
    plan_id: pick(
      random,
      PLANS.filter((p) => p.id !== conflictTarget.plan_id),
    ).id,
    effective: conflictTarget.effective - DAY,
    received: late.received + 2000,
  };

  const deliveries: FixtureDelivery[] = [...trimmed, late, late, conflict].map((draft, index) => ({
    source_offset: index + 1,
    source_received_at: new Date(
      index >= trimmed.length ? late.received + (index - trimmed.length) * 1000 : draft.received,
    ).toISOString(),
    event_id: draft.event_id,
    payload: {
      subscriber_id: draft.subscriber_id,
      type: draft.type,
      ...(draft.plan_id ? { plan_id: draft.plan_id } : {}),
      effective_at: new Date(draft.effective).toISOString(),
    },
  }));

  return {
    seed,
    plans: PLANS,
    initial_head: INITIAL,
    reserve_end: INITIAL + RESERVE,
    late_cancellation_offset: INITIAL + RESERVE + 1,
    late_cancellation_period: new Date(lateMonth).toISOString().slice(0, 7),
    duplicate_offset: INITIAL + RESERVE + 2,
    conflict_offset: INITIAL + RESERVE + 3,
    deliveries,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const seed = Number(process.env.SEED ?? 20260928);
  const fixture = generateFixture(seed);
  const target = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "fixtures",
    "deliveries.json",
  );
  writeFileSync(target, JSON.stringify(fixture, null, 1) + "\n");
  console.log(`wrote ${fixture.deliveries.length} deliveries for seed ${seed} to ${target}`);
}
