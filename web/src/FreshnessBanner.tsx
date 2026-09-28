import type { DashboardState } from "./dashboard";
import { formatCount } from "./format";
import { freshnessSentence } from "./freshness";

export function FreshnessBanner({ state }: { state: DashboardState }) {
  if (state.data === null) {
    return (
      <p className="banner" role="status">
        {state.phase === "error"
          ? `Unable to load. ${state.message}`
          : "Loading the latest snapshot."}
      </p>
    );
  }
  const current = state.data.current;
  const notes: string[] = [freshnessSentence(current)];
  if (current.consumer_paused) notes.push("Consumer paused.");
  if (current.conflicts > 0)
    notes.push(
      `${formatCount(current.conflicts)} semantic conflict${current.conflicts === 1 ? "" : "s"} excluded.`,
    );
  if (state.phase === "refreshing") notes.push("Updating.");
  if (state.phase === "error")
    notes.push(
      `Unable to refresh. Last successful snapshot: checkpoint ${formatCount(current.checkpoint_offset)}.`,
    );
  return (
    <p className={`banner banner-${current.status}`} role="status" data-status={current.status}>
      {notes.join(" ")}
    </p>
  );
}
