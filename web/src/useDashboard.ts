import { useCallback, useEffect, useReducer, useRef } from "react";
import type { DemoAction } from "@fresh-ledger/shared";
import { fetchDashboard, postDemoAction } from "./api";
import { initialState, reduce, type DashboardState } from "./dashboard";

export const POLL_INTERVAL_MS = 1000;

export interface Dashboard {
  state: DashboardState;
  runDemoAction: (action: DemoAction) => Promise<void>;
}

export function useDashboard(intervalMs: number = POLL_INTERVAL_MS): Dashboard {
  const [state, dispatch] = useReducer(reduce, initialState);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    dispatch({ type: "refresh_started" });
    try {
      dispatch({ type: "refresh_succeeded", data: await fetchDashboard() });
    } catch (error) {
      dispatch({
        type: "refresh_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlight.current = false;
    }
  }, []);

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

  return { state, runDemoAction };
}
