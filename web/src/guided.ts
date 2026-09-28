import type { DemoAction, DemoOffsets } from "@fresh-ledger/shared";
import type { DashboardData } from "./api";
import { formatCount, formatPeriod } from "./format";

export const STEP_COUNT = 5;
export const FINISH = STEP_COUNT + 1;

export interface GuidedState {
  step: number;
  highlight: boolean;
}

export type GuidedEvent =
  | { type: "started" }
  | { type: "go_to"; step: number }
  | { type: "highlighted" }
  | { type: "left" };

export function reduceGuided(state: GuidedState | null, event: GuidedEvent): GuidedState | null {
  switch (event.type) {
    case "started":
      return { step: 1, highlight: false };
    case "go_to":
      return { step: Math.min(Math.max(event.step, 1), FINISH), highlight: false };
    case "highlighted":
      return state ? { ...state, highlight: true } : state;
    case "left":
      return null;
  }
}

const HASH_PREFIX = "#demo/";

export function readGuidedHash(hash: string): GuidedState | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const step = Number(hash.slice(HASH_PREFIX.length));
  return Number.isInteger(step) && step >= 1 && step <= FINISH ? { step, highlight: false } : null;
}

export function guidedHash(state: GuidedState | null): string {
  return state ? `${HASH_PREFIX}${state.step}` : "";
}

export interface PrimaryAction {
  label: string;
  actions: DemoAction[];
  next: number | null;
  enabled: boolean;
}

export interface GuidedView {
  step: number;
  title: string;
  what: string[];
  why: string[];
  line: string | null;
  primary: PrimaryAction | null;
  highlightPeriod: string | null;
  highlightCheckpoint: number | null;
}

function lateMonth(data: DashboardData | null, offsets: DemoOffsets): string | null {
  const late = data?.restatements.find(
    (r) => r.detected_at_checkpoint === offsets.late_cancellation_offset,
  );
  return late ? (formatPeriod(late.period).split(" ")[0] ?? null) : null;
}

export function guidedView(
  state: GuidedState,
  data: DashboardData | null,
  offsets: DemoOffsets,
): GuidedView {
  const current = data?.current ?? null;
  const checkpoint = current?.checkpoint_offset ?? 0;
  const head = current?.source_head_offset ?? checkpoint;
  const isCurrent = current?.status === "current";
  const month = lateMonth(data, offsets) ?? "the month it belongs to";
  const base = { highlightPeriod: null, highlightCheckpoint: null };
  switch (state.step) {
    case 1:
      return {
        ...base,
        step: 1,
        title: "Every number tells you how fresh it is",
        what: [
          `These metrics are current through source checkpoint ${formatCount(checkpoint)}.`,
          "Fresh Ledger never shows a number without also showing how far the underlying event stream has been processed.",
        ],
        why: ["A dashboard number is incomplete if you cannot tell how fresh it is."],
        line: null,
        primary: {
          label: "Simulate source moving ahead",
          actions: ["pause", "advance-reserve"],
          next: 2,
          enabled: isCurrent,
        },
      };
    case 2:
      return {
        ...base,
        step: 2,
        title: "The source moves, but the dashboard does not pretend",
        what: [
          `The source is ${formatCount(Math.max(head - checkpoint, 0))} events ahead, but Fresh Ledger has not processed them yet.`,
          "The metrics stay at their last trustworthy values and the dashboard clearly says they are delayed.",
        ],
        why: [
          'The system distinguishes "this is the latest value I computed" from "this is fully current". That is the main Fresh Ledger idea.',
        ],
        line: null,
        primary: { label: "Catch up", actions: ["resume"], next: 3, enabled: true },
      };
    case 3:
      return {
        ...base,
        step: 3,
        title: "Watch the checkpoint catch up",
        what: isCurrent
          ? ["The consumer has caught up and the dashboard is current again."]
          : [
              `Fresh Ledger is catching up with the source in batches: ${formatCount(checkpoint)} of ${formatCount(head)}.`,
              "The metric values always correspond to the checkpoint currently shown.",
            ],
        why: ["Freshness is explicit rather than implied."],
        line: null,
        primary: {
          label: "Inject a late cancellation",
          actions: ["inject-late-cancellation"],
          next: 4,
          enabled: isCurrent,
        },
      };
    case 4: {
      const arrived = isCurrent && checkpoint >= offsets.late_cancellation_offset;
      return {
        step: 4,
        title: "A late event changes the month where it actually happened",
        what: arrived
          ? [
              `This cancellation arrived now, at source offset ${formatCount(offsets.late_cancellation_offset)}, but it was effective in ${month}.`,
              `Fresh Ledger updates ${month} instead of pretending the change belongs to the current month. The restatement records the old value, the new value, the event that caused the change and the checkpoint where it was detected.`,
            ]
          : [
              `The late cancellation is being processed. The checkpoint will read ${formatCount(offsets.late_cancellation_offset)} and the dashboard stays current.`,
            ],
        why: [
          "Fresh Ledger separates when an event arrived from when the business event actually happened. Late data changes the period it belongs to.",
        ],
        line: state.highlight ? `Arrived now. Happened in ${month}. Recorded in ${month}.` : null,
        primary: state.highlight
          ? null
          : { label: "Show history", actions: [], next: null, enabled: arrived },
        highlightPeriod: state.highlight ? (lateRestatedPeriod(data, offsets) ?? null) : null,
        highlightCheckpoint: state.highlight ? offsets.late_cancellation_offset : null,
      };
    }
    case 5: {
      const replayed = isCurrent && checkpoint >= offsets.duplicate_offset;
      return {
        ...base,
        step: 5,
        title: "Deliver the same event twice",
        what: replayed
          ? [
              `The same logical event was delivered again at offset ${formatCount(offsets.duplicate_offset)}. The source moved forward, but MRR, ARR, active subscribers and the restatements did not change.`,
            ]
          : [
              "The same logical event will be delivered again under a new source offset. Watch the checkpoint move by one while every value stays where it is.",
            ],
        why: [
          "One logical event can be delivered more than once without changing the metrics twice.",
        ],
        line: null,
        primary: replayed
          ? null
          : {
              label: "Replay duplicate event",
              actions: ["replay-duplicate"],
              next: null,
              enabled: isCurrent,
            },
      };
    }
    default:
      return {
        ...base,
        step: FINISH,
        title: "Fresh Ledger demo complete",
        what: [],
        why: [],
        line: null,
        primary: null,
      };
  }
}

function lateRestatedPeriod(data: DashboardData | null, offsets: DemoOffsets): string | undefined {
  return data?.restatements.find(
    (r) => r.detected_at_checkpoint === offsets.late_cancellation_offset,
  )?.period;
}

export const SUMMARY = [
  "Every metric shows the checkpoint it was computed from.",
  "The dashboard says when the source is ahead.",
  "Late events restate the period where they actually belong.",
  "Duplicate deliveries do not duplicate the business effect.",
];
