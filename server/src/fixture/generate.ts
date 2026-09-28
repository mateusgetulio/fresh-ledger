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
  duplicate_offset: number;
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
        received: at + Math.floor(random() * 2 * DAY),
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

  const candidates = [...lastEventBySubscriber.values()].filter(
    (d) =>
      d.type !== "subscription.cancelled" &&
      d.effective < Date.UTC(2026, 7, 1) &&
      trimmed.includes(d),
  );
  const lateTarget = pick(
    random,
    candidates.sort((a, b) => a.subscriber_id.localeCompare(b.subscriber_id)),
  );
  const late: Draft = {
    event_id: id(),
    subscriber_id: lateTarget.subscriber_id,
    type: "subscription.cancelled",
    effective: Date.UTC(2026, 7, 17, 9, 30),
    received: Math.max(lastReceived, Date.UTC(2026, 8, 28, 14, 5)),
  };
  const duplicateOf = trimmed[41];
  if (duplicateOf === undefined) throw new Error("fixture too small for the duplicate");

  const deliveries: FixtureDelivery[] = [...trimmed, late, duplicateOf].map((draft, index) => ({
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
    duplicate_offset: INITIAL + RESERVE + 2,
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
