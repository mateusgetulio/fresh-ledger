import { formatMoney } from "@fresh-ledger/shared";

export interface RestatementRow {
  id: string;
  metric: "mrr" | "active_subscribers";
  period: string;
  previous_value: string;
  new_value: string;
  cause_event_id: string;
  detected_at_checkpoint: string;
  cause_type: "subscription.started" | "subscription.plan_changed" | "subscription.cancelled";
  cause_effective_at: Date;
  cause_source_offset: string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const CAUSES = {
  "subscription.started": "A subscription start",
  "subscription.plan_changed": "A plan change",
  "subscription.cancelled": "A cancellation",
};

export function periodLabel(period: string): string {
  const month = MONTHS[Number(period.slice(5, 7)) - 1] ?? period;
  return `${month} ${period.slice(0, 4)}`;
}

export function restatementSentence(row: RestatementRow): string {
  const metric = row.metric === "mrr" ? "MRR" : "active subscribers";
  const value = (v: string) =>
    row.metric === "mrr" ? formatMoney(v) : String(Math.trunc(Number(v)));
  const effective = row.cause_effective_at;
  const day = `${(MONTHS[effective.getUTCMonth()] ?? "").slice(0, 3)} ${effective.getUTCDate()}`;
  const offset = Number(row.cause_source_offset).toLocaleString("en-US");
  return `${periodLabel(row.period)} ${metric} changed from ${value(row.previous_value)} to ${value(row.new_value)}. ${CAUSES[row.cause_type]} effective ${day} arrived at source offset ${offset}.`;
}
