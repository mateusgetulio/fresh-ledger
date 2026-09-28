import { useCallback, useEffect, useReducer, useState } from "react";
import type { DemoOffsets } from "@fresh-ledger/shared";
import { fetchDemoInfo, resetDemo } from "./api";
import { DemoPanel } from "./DemoPanel";
import { FreshnessBanner } from "./FreshnessBanner";
import { GuidedDemo } from "./GuidedDemo";
import { guidedHash, guidedView, readGuidedHash, reduceGuided } from "./guided";
import { HistoryTable } from "./HistoryTable";
import { MetricCards } from "./MetricCards";
import { RestatementsList } from "./RestatementsList";
import { useDashboard } from "./useDashboard";

export function App({ pollIntervalMs }: { pollIntervalMs?: number } = {}) {
  const { state, runDemoAction, refresh } = useDashboard(pollIntervalMs);
  const [guided, dispatch] = useReducer(reduceGuided, window.location.hash, readGuidedHash);
  const [offsets, setOffsets] = useState<DemoOffsets | null>(null);
  const [starting, setStarting] = useState(false);
  const data = state.data;

  useEffect(() => {
    const hash = guidedHash(guided);
    if (window.location.hash !== hash)
      window.history.replaceState(null, "", hash || window.location.pathname);
  }, [guided]);

  const [offsetsAttempt, setOffsetsAttempt] = useState(0);
  useEffect(() => {
    if (!guided || offsets !== null) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    fetchDemoInfo()
      .then((info) => {
        if (!cancelled) setOffsets(info.offsets);
      })
      .catch(() => {
        retry = setTimeout(() => {
          if (!cancelled) setOffsetsAttempt((n) => n + 1);
        }, 1000);
      });
    return () => {
      cancelled = true;
      if (retry !== null) clearTimeout(retry);
    };
  }, [guided, offsets, offsetsAttempt]);

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const info = await resetDemo();
      setOffsets(info.offsets);
      await refresh();
      dispatch({ type: "started" });
    } finally {
      setStarting(false);
    }
  }, [refresh]);

  const view = guided && offsets ? guidedView(guided, data, offsets) : null;
  const inGuided = view !== null;

  return (
    <main className={inGuided ? "page in-guided" : "page"}>
      <header>
        <div>
          <h1>Fresh Ledger</h1>
          <p className="meta">
            Every number carries the source checkpoint it was computed at. Processed through refers
            to source time, never to business completeness.
          </p>
        </div>
        {inGuided ? (
          <button type="button" className="quiet" onClick={() => dispatch({ type: "left" })}>
            Exit demo
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={starting}
            onClick={() => void start()}
          >
            {starting ? "Preparing the demo" : "Start Guided Demo"}
          </button>
        )}
      </header>
      <FreshnessBanner state={state} />
      {data ? (
        <>
          <MetricCards current={data.current} />
          <div className="columns">
            <HistoryTable history={data.history} highlightPeriod={view?.highlightPeriod ?? null} />
            <RestatementsList
              restatements={data.restatements}
              highlightCheckpoint={view?.highlightCheckpoint ?? null}
            />
          </div>
        </>
      ) : null}
      {guided && offsets ? (
        <GuidedDemo
          state={guided}
          data={data}
          offsets={offsets}
          dispatch={dispatch}
          run={runDemoAction}
          restart={start}
        />
      ) : (
        <DemoPanel current={data?.current ?? null} run={runDemoAction} />
      )}
    </main>
  );
}
