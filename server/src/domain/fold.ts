export type EventType =
  "subscription.started" | "subscription.plan_changed" | "subscription.cancelled";

export interface LedgerEvent {
  event_id: string;
  subscriber_id: string;
  type: EventType;
  plan_id: string | null;
  effective_at: Date;
  first_source_offset: number;
}

export interface FoldedState {
  status: "active" | "inactive";
  plan_id: string | null;
  last_event_id: string | null;
  last_effective_at: Date | null;
}

export interface Conflict {
  event_id: string;
  detail: string;
}

export interface FoldResult {
  state: FoldedState;
  conflicts: Conflict[];
}

export function orderByBusinessTime(events: LedgerEvent[]): LedgerEvent[] {
  return [...events].sort((a, b) => {
    const byTime = a.effective_at.getTime() - b.effective_at.getTime();
    return byTime !== 0 ? byTime : a.first_source_offset - b.first_source_offset;
  });
}

export function fold(events: LedgerEvent[]): FoldResult {
  let state: FoldedState = {
    status: "inactive",
    plan_id: null,
    last_event_id: null,
    last_effective_at: null,
  };
  const conflicts: Conflict[] = [];
  for (const event of orderByBusinessTime(events)) {
    const next = step(state, event);
    if (typeof next === "string") {
      conflicts.push({ event_id: event.event_id, detail: next });
      continue;
    }
    state = next;
  }
  return { state, conflicts };
}

function step(state: FoldedState, event: LedgerEvent): FoldedState | string {
  const applied = (status: FoldedState["status"], plan_id: string | null): FoldedState => ({
    status,
    plan_id,
    last_event_id: event.event_id,
    last_effective_at: event.effective_at,
  });
  switch (event.type) {
    case "subscription.started":
      if (state.status === "active") return "started while already active";
      if (event.plan_id === null) return "started without a plan";
      return applied("active", event.plan_id);
    case "subscription.plan_changed":
      if (state.status === "inactive") return "plan changed while inactive";
      if (event.plan_id === null) return "plan changed without a plan";
      return applied("active", event.plan_id);
    case "subscription.cancelled":
      return applied("inactive", null);
  }
}
