import { DemoPanel } from "./DemoPanel";
import { FreshnessBanner } from "./FreshnessBanner";
import { HistoryTable } from "./HistoryTable";
import { MetricCards } from "./MetricCards";
import { RestatementsList } from "./RestatementsList";
import { useDashboard } from "./useDashboard";

export function App({ pollIntervalMs }: { pollIntervalMs?: number } = {}) {
  const { state, runDemoAction } = useDashboard(pollIntervalMs);
  const data = state.data;
  return (
    <main className="page">
      <header>
        <h1>Fresh Ledger</h1>
        <p className="meta">
          Every number carries the source checkpoint it was computed at. Processed through refers to
          source time, never to business completeness.
        </p>
      </header>
      <FreshnessBanner state={state} />
      {data ? (
        <>
          <MetricCards current={data.current} />
          <div className="columns">
            <HistoryTable history={data.history} />
            <RestatementsList restatements={data.restatements} />
          </div>
        </>
      ) : null}
      <DemoPanel current={data?.current ?? null} run={runDemoAction} />
    </main>
  );
}
