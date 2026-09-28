import { useCallback, useEffect, useReducer, useRef } from "react";
import type { DemoAction } from "@fresh-ledger/shared";
import { fetchDashboard, postDemoAction } from "./api";
import { initialState, reduce, type DashboardState } from "./dashboard";

export const POLL_INTERVAL_MS = 1000;

export interface Dashboard {
  state: DashboardState;
  runDemoAction: (action: DemoAction) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useDashboard(intervalMs: number = POLL_INTERVAL_MS): Dashboard {
  const [state, dispatch] = useReducer(reduce, initialState);
  const inFlight = useRef<Promise<void> | null>(null);
  const followUp = useRef<Promise<void> | null>(null);

  const refreshOnce = useCallback(async () => {
    dispatch({ type: "refresh_started" });
    try {
      dispatch({ type: "refresh_succeeded", data: await fetchDashboard() });
    } catch (error) {
      dispatch({
        type: "refresh_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, []);

  const refresh = useCallback((): Promise<void> => {
    const running = inFlight.current;
    if (running === null) {
      const started = refreshOnce().finally(() => {
        if (inFlight.current === started) inFlight.current = null;
      });
      inFlight.current = started;
      return started;
    }
    if (followUp.current === null) {
      followUp.current = running.then(() => {
        followUp.current = null;
        const next = refreshOnce().finally(() => {
          if (inFlight.current === next) inFlight.current = null;
        });
        inFlight.current = next;
        return next;
      });
    }
    return followUp.current;
  }, [refreshOnce]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);

  const runDemoAction = useCallback(
    async (action: DemoAction) => {
      await postDemoAction(action);
      await refresh();
    },
    [refresh],
  );

  return { state, runDemoAction, refresh };
}
