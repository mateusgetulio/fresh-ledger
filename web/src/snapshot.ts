import type { DashboardData } from "./api";

export interface MetricsSnapshot {
  checkpoint: number;
  mrr: string;
  arr: string;
  active_subscribers: number;
  restatements: number;
}

export function snapshotOf(data: DashboardData): MetricsSnapshot {
  return {
    checkpoint: data.current.checkpoint_offset,
    mrr: data.current.metrics.mrr,
    arr: data.current.metrics.arr,
    active_subscribers: data.current.metrics.active_subscribers,
    restatements: data.restatements.length,
  };
}
