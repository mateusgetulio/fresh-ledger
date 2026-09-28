import type {
  CurrentMetrics,
  DemoAction,
  DemoState,
  MonthMetrics,
  Restatement,
} from "@fresh-ledger/shared";

export interface DashboardData {
  current: CurrentMetrics;
  history: MonthMetrics[];
  restatements: Restatement[];
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

export async function fetchDashboard(): Promise<DashboardData> {
  const [current, history, restatements] = await Promise.all([
    getJson<CurrentMetrics>("/api/metrics/current"),
    getJson<MonthMetrics[]>("/api/metrics/history"),
    getJson<Restatement[]>("/api/restatements"),
  ]);
  return { current, history, restatements };
}

export async function postDemoAction(action: DemoAction): Promise<DemoState> {
  const response = await fetch(`/api/demo/${action}`, { method: "POST" });
  if (!response.ok) throw new Error(`demo action ${action} answered ${response.status}`);
  return (await response.json()) as DemoState;
}
