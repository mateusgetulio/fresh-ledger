import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CurrentMetrics, Money } from "@fresh-ledger/shared";
import { FreshnessBanner } from "./FreshnessBanner";
import type { DashboardState } from "./dashboard";

const current: CurrentMetrics = {
  snapshot_id: 31,
  checkpoint_offset: 3000,
  checkpoint_source_received_at: "2026-07-05T14:02:11.000Z",
  source_head_offset: 3000,
  pending_deliveries: 0,
  status: "current",
  consumer_paused: false,
  conflicts: 0,
  metrics: { mrr: "81240.000000" as Money, arr: "974880.000000" as Money, active_subscribers: 742 },
};

function ready(
  overrides: Partial<CurrentMetrics>,
  phase: "ready" | "refreshing" | "error" = "ready",
) {
  const data = { current: { ...current, ...overrides }, history: [], restatements: [] };
  const state: DashboardState =
    phase === "error"
      ? { phase, data, message: "/api/metrics/current answered 503" }
      : { phase, data, message: null };
  return state;
}

describe("FreshnessBanner", () => {
  it("says Current with the checkpoint, its source time and zero pending", () => {
    render(<FreshnessBanner state={ready({})} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Current. Processed through offset 3,000 (Jul 5, 14:02 UTC). 0 pending.",
    );
  });

  it("INV-10 says Delayed with the pending count when the head is ahead of the checkpoint", () => {
    render(
      <FreshnessBanner
        state={ready({
          status: "delayed",
          source_head_offset: 3420,
          pending_deliveries: 420,
          consumer_paused: true,
        })}
      />,
    );
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Delayed. Processed through 3,000 of 3,420. 420 pending.");
    expect(banner).toHaveTextContent("Consumer paused.");
    expect(banner).not.toHaveTextContent("Current");
    expect(banner).toHaveAttribute("data-status", "delayed");
  });

  it("keeps the last snapshot visible while updating, says Updating only when a refresh is slow, and keeps values after a failed refresh", () => {
    vi.useFakeTimers();
    const { rerender } = render(<FreshnessBanner state={ready({}, "refreshing")} />);
    expect(screen.getByRole("status")).toHaveTextContent("Current. Processed through offset 3,000");
    expect(screen.getByRole("status")).not.toHaveTextContent("Updating.");

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Updating.");

    rerender(<FreshnessBanner state={ready({})} />);
    expect(screen.getByRole("status")).not.toHaveTextContent("Updating.");

    rerender(<FreshnessBanner state={ready({}, "refreshing")} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender(<FreshnessBanner state={ready({})} />);
    expect(screen.getByRole("status")).not.toHaveTextContent("Updating.");
    vi.useRealTimers();

    rerender(<FreshnessBanner state={ready({}, "error")} />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Unable to refresh. Last successful snapshot: checkpoint 3,000.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Current. Processed through offset 3,000");
  });

  it("names an unreadable source instead of claiming freshness", () => {
    render(
      <FreshnessBanner
        state={ready({
          status: "unavailable",
          source_head_offset: null,
          pending_deliveries: null,
          conflicts: 1,
        })}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Source unavailable. Values are from checkpoint 3,000; the source head could not be read. 1 semantic conflict excluded.",
    );
  });
});
