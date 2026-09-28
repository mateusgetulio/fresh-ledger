import { useEffect, useState } from "react";
import type { DeliveryRecord, DemoAction, DemoOffsets } from "@fresh-ledger/shared";
import { fetchDelivery, type DashboardData } from "./api";
import { DuplicateEvidence } from "./DuplicateEvidence";
import { snapshotOf, type MetricsSnapshot } from "./snapshot";
import {
  FINISH,
  guidedView,
  STEP_COUNT,
  SUMMARY,
  type GuidedEvent,
  type GuidedState,
} from "./guided";

export interface GuidedDemoProps {
  state: GuidedState;
  data: DashboardData | null;
  offsets: DemoOffsets;
  dispatch: (event: GuidedEvent) => void;
  run: (action: DemoAction) => Promise<void>;
  restart: () => Promise<void>;
}

export function GuidedDemo({ state, data, offsets, dispatch, run, restart }: GuidedDemoProps) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [before, setBefore] = useState<MetricsSnapshot | null>(null);
  const [delivery, setDelivery] = useState<DeliveryRecord | null>(null);
  const view = guidedView(state, data, offsets);
  const replayed =
    state.step === 5 &&
    data !== null &&
    data.current.status === "current" &&
    data.current.checkpoint_offset >= offsets.duplicate_offset;

  useEffect(() => {
    if (!replayed || delivery !== null) return;
    let cancelled = false;
    fetchDelivery(offsets.duplicate_offset)
      .then((record) => {
        if (!cancelled) setDelivery(record);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [replayed, delivery, offsets.duplicate_offset]);

  const attempt = async (work: () => Promise<void>) => {
    setBusy(true);
    setFailure(null);
    try {
      await work();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const primary = view.primary;
  const onPrimary = () => {
    if (!primary) return;
    void attempt(async () => {
      if (primary.actions.includes("replay-duplicate") && data) setBefore(snapshotOf(data));
      for (const action of primary.actions) await run(action);
      if (primary.next !== null) dispatch({ type: "go_to", step: primary.next });
      else if (primary.label === "Show history") {
        dispatch({ type: "highlighted" });
        document.getElementById("history-heading")?.scrollIntoView({ behavior: "smooth" });
      }
    });
  };

  if (state.step === FINISH) {
    return (
      <section className="guided guided-finish" aria-labelledby="guided-heading">
        <p className="guided-step">Demo complete</p>
        <h2 id="guided-heading">{view.title}</h2>
        <ul className="guided-summary">
          {SUMMARY.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <nav className="guided-nav" aria-label="Demo navigation">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void attempt(restart)}
          >
            Restart Demo
          </button>
          <button type="button" onClick={() => dispatch({ type: "left" })}>
            Return to Dashboard
          </button>
        </nav>
        {failure ? (
          <p className="failure" role="alert">
            Demo action failed: {failure}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <aside className="guided" aria-labelledby="guided-heading">
      <p className="guided-step">
        Demo {view.step} of {STEP_COUNT}
      </p>
      <h2 id="guided-heading">{view.title}</h2>
      <h3>What you're seeing</h3>
      {view.what.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {view.line ? <p className="guided-line">{view.line}</p> : null}
      {replayed && data ? (
        <DuplicateEvidence before={before} after={snapshotOf(data)} delivery={delivery} />
      ) : null}
      <h3>Why it matters</h3>
      {view.why.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {primary ? (
        <button
          type="button"
          className="primary guided-primary"
          disabled={busy || !primary.enabled}
          onClick={onPrimary}
        >
          {primary.label}
        </button>
      ) : null}
      {primary && !primary.enabled && !busy ? (
        <p className="meta">Waiting for the consumer to catch up.</p>
      ) : null}
      {failure ? (
        <p className="failure" role="alert">
          Demo action failed: {failure}
        </p>
      ) : null}
      <nav className="guided-nav" aria-label="Demo navigation">
        <button
          type="button"
          disabled={busy || view.step === 1}
          onClick={() => dispatch({ type: "go_to", step: view.step - 1 })}
        >
          ← Back
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => dispatch({ type: "go_to", step: view.step + 1 })}
        >
          {view.step === STEP_COUNT ? "Finish Demo" : "Next →"}
        </button>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => void attempt(restart)}
        >
          Restart Demo
        </button>
      </nav>
    </aside>
  );
}
