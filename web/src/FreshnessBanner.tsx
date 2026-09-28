import { useEffect, useState } from "react";
import type { DashboardState } from "./dashboard";
import { formatCount } from "./format";
import { freshnessSentence } from "./freshness";

export const SLOW_REFRESH_MS = 1500;

function useSlowRefresh(refreshing: boolean, delayMs: number): boolean {
  const [slow, setSlow] = useState(false);
  const [seenRefreshing, setSeenRefreshing] = useState(refreshing);
  if (refreshing !== seenRefreshing) {
    setSeenRefreshing(refreshing);
    if (!refreshing) setSlow(false);
  }
  useEffect(() => {
    if (!refreshing) return;
    const timer = setTimeout(() => setSlow(true), delayMs);
    return () => clearTimeout(timer);
  }, [refreshing, delayMs]);
  return refreshing && slow;
}

export function FreshnessBanner({
  state,
  slowRefreshMs = SLOW_REFRESH_MS,
}: {
  state: DashboardState;
  slowRefreshMs?: number;
}) {
  const slow = useSlowRefresh(state.phase === "refreshing", slowRefreshMs);
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
  if (slow) notes.push("Updating.");
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
