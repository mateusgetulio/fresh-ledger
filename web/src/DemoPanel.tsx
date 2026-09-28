import { useState } from "react";
import type { CurrentMetrics, DemoAction } from "@fresh-ledger/shared";
import { formatCount } from "./format";

const CONTROLS: { action: DemoAction; label: string; hint: string }[] = [
  {
    action: "pause",
    label: "Pause consumer",
    hint: "The source keeps moving, the checkpoint does not.",
  },
  {
    action: "resume",
    label: "Resume consumer",
    hint: "One batch of 100 per tick until caught up.",
  },
  {
    action: "advance-source",
    label: "Advance source by 100",
    hint: "Releases the next 100 reserve deliveries.",
  },
  {
    action: "inject-late-cancellation",
    label: "Inject late cancellation",
    hint: "Releases the seeded cancellation that belongs to a closed month.",
  },
  {
    action: "replay-duplicate",
    label: "Replay duplicate",
    hint: "Redelivers the late cancellation under a new offset.",
  },
];

export function DemoPanel({
  current,
  run,
}: {
  current: CurrentMetrics | null;
  run: (action: DemoAction) => Promise<void>;
}) {
  const [busy, setBusy] = useState<DemoAction | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const click = async (action: DemoAction) => {
    setBusy(action);
    setFailure(null);
    try {
      await run(action);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="demo" aria-labelledby="demo-heading">
      <h2 id="demo-heading">Demo controls</h2>
      <p className="meta">
        These buttons move a simulated source. They exist only outside production.
        {current
          ? ` Source head ${current.source_head_offset === null ? "unknown" : formatCount(current.source_head_offset)}, consumer ${current.consumer_paused ? "paused" : "running"}.`
          : ""}
      </p>
      <ul className="controls">
        {CONTROLS.map((control) => (
          <li key={control.action}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void click(control.action)}
            >
              {control.label}
            </button>
            <span className="meta">{control.hint}</span>
          </li>
        ))}
      </ul>
      {failure ? (
        <p className="failure" role="alert">
          Demo action failed: {failure}
        </p>
      ) : null}
    </section>
  );
}
