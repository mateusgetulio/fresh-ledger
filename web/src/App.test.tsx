import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentMetrics, Money, MonthMetrics, Restatement } from "@fresh-ledger/shared";
import { App } from "./App";

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
const history: MonthMetrics[] = [
  {
    period: "2026-06",
    mrr: "80000.000000" as Money,
    active_subscribers: 730,
    computed_at_checkpoint: 2900,
    state: "closed",
    restated: true,
  },
  {
    period: "2026-07",
    mrr: "81240.000000" as Money,
    active_subscribers: 742,
    computed_at_checkpoint: null,
    state: "provisional",
    restated: false,
  },
];
const restatements: Restatement[] = [
  {
    id: 1,
    metric: "mrr",
    period: "2026-06",
    previous_value: "80020.000000" as Money,
    new_value: "80000.000000" as Money,
    cause_event_id: "evt_1",
    detected_at_checkpoint: 2900,
    sentence:
      "June 2026 MRR changed from 80,020.00 to 80,000.00. A cancellation effective Jun 17 arrived at source offset 2,850.",
  },
];

type Responder = (path: string) => { status: number; body: unknown };

function stubFetch(respond: Responder) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const path = typeof input === "string" ? input : input.toString();
    const { status, body } = respond(path);
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const healthy: Responder = (path) => {
  if (path === "/api/metrics/current") return { status: 200, body: current };
  if (path === "/api/metrics/history") return { status: 200, body: history };
  if (path === "/api/restatements") return { status: 200, body: restatements };
  return { status: 404, body: {} };
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("App", () => {
  it("moves from loading to ready and renders cards, history and restatements from the API", async () => {
    stubFetch(healthy);
    render(<App pollIntervalMs={1000} />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the latest snapshot.");

    await flush();

    expect(screen.getByRole("status")).toHaveTextContent(
      "Current. Processed through offset 3,000 (Jul 5, 14:02 UTC). 0 pending.",
    );
    expect(screen.getByRole("heading", { name: "MRR" }).nextElementSibling).toHaveTextContent(
      "81,240.00",
    );
    expect(screen.getByRole("heading", { name: "ARR" }).nextElementSibling).toHaveTextContent(
      "974,880.00",
    );
    expect(screen.getByRole("row", { name: /June 2026/ })).toHaveTextContent("Closed (restated)");
    expect(screen.getByRole("row", { name: /July 2026/ })).toHaveTextContent("Provisional");
    expect(screen.getByText(/June 2026 MRR changed from 80,020.00 to 80,000.00/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Pause consumer" })).toBeEnabled();
  });

  it("keeps the last values on screen when a refresh fails, and recovers on the next poll", async () => {
    let failing = false;
    stubFetch((path) => (failing ? { status: 503, body: {} } : healthy(path)));
    render(<App pollIntervalMs={1000} />);
    await flush();
    expect(screen.getByRole("status")).toHaveTextContent("Current.");

    failing = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(
      "Unable to refresh. Last successful snapshot: checkpoint 3,000.",
    );
    expect(banner).toHaveTextContent("Current. Processed through offset 3,000");
    expect(screen.getByRole("heading", { name: "MRR" }).nextElementSibling).toHaveTextContent(
      "81,240.00",
    );

    failing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByRole("status")).not.toHaveTextContent("Unable to refresh");
  });

  it("posts a demo action and refreshes right after it", async () => {
    const fetchMock = stubFetch((path) =>
      path.startsWith("/api/demo/")
        ? { status: 200, body: { head_offset: 3100, consumer_paused: true } }
        : healthy(path),
    );
    render(<App pollIntervalMs={60_000} />);
    await flush();
    const callsBefore = fetchMock.mock.calls.length;

    await act(async () => {
      screen.getByRole("button", { name: "Pause consumer" }).click();
      await vi.advanceTimersByTimeAsync(0);
    });

    const paths = fetchMock.mock.calls.slice(callsBefore).map(([input]) => String(input));
    expect(paths[0]).toBe("/api/demo/pause");
    expect(paths.slice(1)).toEqual([
      "/api/metrics/current",
      "/api/metrics/history",
      "/api/restatements",
    ]);
  });
});
