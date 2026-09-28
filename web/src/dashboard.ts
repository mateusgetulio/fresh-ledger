import type { DashboardData } from "./api";

export type DashboardState =
  | { phase: "loading"; data: null; message: null }
  | { phase: "ready"; data: DashboardData; message: null }
  | { phase: "refreshing"; data: DashboardData; message: null }
  | { phase: "error"; data: DashboardData | null; message: string };

export type DashboardEvent =
  | { type: "refresh_started" }
  | { type: "refresh_succeeded"; data: DashboardData }
  | { type: "refresh_failed"; message: string };

export const initialState: DashboardState = { phase: "loading", data: null, message: null };

export function reduce(state: DashboardState, event: DashboardEvent): DashboardState {
  switch (event.type) {
    case "refresh_started":
      return state.data === null
        ? { phase: "loading", data: null, message: null }
        : { phase: "refreshing", data: state.data, message: null };
    case "refresh_succeeded":
      return { phase: "ready", data: event.data, message: null };
    case "refresh_failed":
      return { phase: "error", data: state.data, message: event.message };
  }
}
