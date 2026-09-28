export type Money = string & { readonly __brand: "Money" };

export type FreshnessStatus = "current" | "delayed" | "unavailable";

export interface CurrentMetrics {
  snapshot_id: number;
  checkpoint_offset: number;
  checkpoint_source_received_at: string | null;
  source_head_offset: number;
  pending_deliveries: number;
  status: FreshnessStatus;
  consumer_paused: boolean;
  conflicts: number;
  metrics: {
    mrr: Money;
    arr: Money;
    active_subscribers: number;
  };
}

export interface MonthMetrics {
  period: string;
  mrr: Money;
  active_subscribers: number;
  computed_at_checkpoint: number | null;
  state: "closed" | "provisional";
  restated: boolean;
}

export interface Restatement {
  id: number;
  metric: "mrr" | "active_subscribers";
  period: string;
  previous_value: Money;
  new_value: Money;
  cause_event_id: string;
  detected_at_checkpoint: number;
  sentence: string;
}

export type DemoAction =
  "pause" | "resume" | "advance-source" | "inject-late-cancellation" | "replay-duplicate";

export interface DemoState {
  head_offset: number;
  consumer_paused: boolean;
}

export function formatMoney(value: Money | string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const cents = (fraction + "00").slice(0, 2);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}.${cents}`;
}
