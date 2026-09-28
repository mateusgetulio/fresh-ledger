import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentMetrics, Money, MonthMetrics, Restatement } from "@fresh-ledger/shared";
import { App } from "./App";

const OFFSETS = {
  initial_head: 3000,
  reserve_end: 3500,
  late_cancellation_offset: 3501,
  duplicate_offset: 3502,
};

interface Source {
  head: number;
  paused: boolean;
  checkpoint: number;
}

function current(source: Source): CurrentMetrics {
  const pending = source.head - source.checkpoint;
  const cancelled = source.checkpoint >= OFFSETS.late_cancellation_offset;
  return {
    snapshot_id: source.checkpoint,
    checkpoint_offset: source.checkpoint,
    checkpoint_source_received_at: "2026-07-05T19:41:22.903Z",
    source_head_offset: source.head,
    pending_deliveries: pending,
    status: pending === 0 ? "current" : "delayed",
    consumer_paused: source.paused,
    conflicts: 0,
    metrics: {
      mrr: (cancelled ? "17934.000000" : "17954.000000") as Money,
      arr: (cancelled ? "215208.000000" : "215448.000000") as Money,
      active_subscribers: cancelled ? 571 : 572,
    },
  };
}

function history(source: Source): MonthMetrics[] {
  const cancelled = source.checkpoint >= OFFSETS.late_cancellation_offset;
  return [
    {
      period: "2026-07",
      mrr: (cancelled ? "17606.000000" : "17626.000000") as Money,
      active_subscribers: cancelled ? 567 : 568,
      computed_at_checkpoint: cancelled ? 3501 : 3500,
      state: "closed",
      restated: cancelled,
    },
    {
      period: "2026-09",
      mrr: "17934.000000" as Money,
      active_subscribers: 571,
      computed_at_checkpoint: null,
      state: "provisional",
      restated: false,
    },
  ];
}

function restatements(source: Source): Restatement[] {
  if (source.checkpoint < OFFSETS.late_cancellation_offset) return [];
  return [
    {
      id: 9,
      metric: "mrr",
      period: "2026-07",
      previous_value: "17626.000000" as Money,
      new_value: "17606.000000" as Money,
      cause_event_id: "evt_03982",
      other_causes: 0,
      detected_at_checkpoint: 3501,
      sentence:
        "July 2026 MRR changed from 17,626.00 to 17,606.00. A cancellation effective Jul 17 arrived at source offset 3,501.",
    },
  ];
}

function stubSource() {
  const source: Source = { head: 3000, paused: false, checkpoint: 3000 };
  const posts: string[] = [];
  const json = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST") {
        posts.push(path);
        const action = path.replace("/api/demo/", "");
        if (action === "reset") {
          Object.assign(source, { head: 3000, paused: false, checkpoint: 3000 });
          return json({
            offsets: OFFSETS,
            state: { head_offset: 3000, consumer_paused: false },
            checkpoint_offset: 3000,
          });
        }
        if (action === "pause") source.paused = true;
        if (action === "resume") source.paused = false;
        if (action === "advance-reserve") source.head = Math.max(source.head, OFFSETS.reserve_end);
        if (action === "inject-late-cancellation")
          source.head = Math.max(source.head, OFFSETS.late_cancellation_offset);
        if (action === "replay-duplicate")
          source.head = Math.max(source.head, OFFSETS.duplicate_offset);
        return json({ head_offset: source.head, consumer_paused: source.paused });
      }
      if (path === "/api/demo")
        return json({
          offsets: OFFSETS,
          state: { head_offset: source.head, consumer_paused: source.paused },
          checkpoint_offset: source.checkpoint,
        });
      if (path === "/api/metrics/current") {
        if (!source.paused && source.checkpoint < source.head)
          source.checkpoint = Math.min(source.checkpoint + 100, source.head);
        return json(current(source));
      }
      if (path === "/api/metrics/history") return json(history(source));
      if (path === "/api/restatements") return json(restatements(source));
      return json({}, 404);
    }),
  );
  return { source, posts };
}

async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function press(name: string | RegExp) {
  await act(async () => {
    screen.getByRole("button", { name }).click();
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.location.hash = "";
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("guided demo", () => {
  it("walks the five steps on the real dashboard, driving the real demo actions, and ends on the summary", async () => {
    const { posts } = stubSource();
    render(<App pollIntervalMs={1000} />);
    await tick();
    expect(screen.queryByText(/Demo 1 of 5/)).toBeNull();

    await press("Start Guided Demo");
    expect(posts).toEqual(["/api/demo/reset"]);
    expect(screen.getByText("Demo 1 of 5")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Current. Processed through offset 3,000");
    expect(screen.getByText(/current through source checkpoint 3,000/)).toBeVisible();
    expect(window.location.hash).toBe("#demo/1");
    expect(screen.queryByRole("heading", { name: "Demo controls" })).toBeNull();

    await press("Simulate source moving ahead");
    expect(posts.slice(1)).toEqual(["/api/demo/pause", "/api/demo/advance-reserve"]);
    expect(screen.getByText("Demo 2 of 5")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Delayed. Processed through 3,000 of 3,500. 500 pending.",
    );
    expect(screen.getByText(/The source is 500 events ahead/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "MRR" }).nextElementSibling).toHaveTextContent(
      "17,954.00",
    );

    await press("Catch up");
    expect(posts.at(-1)).toBe("/api/demo/resume");
    expect(screen.getByText("Demo 3 of 5")).toBeVisible();
    expect(
      screen.getByText(/catching up with the source in batches: 3,100 of 3,500/),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Inject a late cancellation" })).toBeDisabled();
    await tick(4000);
    expect(screen.getByRole("status")).toHaveTextContent("Current. Processed through offset 3,500");
    expect(screen.getByText(/caught up and the dashboard is current again/)).toBeVisible();

    await press("Inject a late cancellation");
    expect(posts.at(-1)).toBe("/api/demo/inject-late-cancellation");
    expect(screen.getByText("Demo 4 of 5")).toBeVisible();
    await tick(1000);
    expect(screen.getByRole("status")).toHaveTextContent("Current. Processed through offset 3,501");
    expect(
      screen.getByText(/arrived now, at source offset 3,501, but it was effective in July/),
    ).toBeVisible();
    expect(screen.getByRole("heading", { name: "MRR" }).nextElementSibling).toHaveTextContent(
      "17,934.00",
    );

    await press("Show history");
    expect(screen.getByText("Arrived now. Happened in July. Recorded in July.")).toBeVisible();
    expect(screen.getByRole("row", { name: /July 2026/ })).toHaveClass("highlight");
    expect(screen.getByRole("row", { name: /July 2026/ })).toHaveTextContent("Closed (restated)");
    expect(
      screen.getByText(/July 2026 MRR changed from 17,626.00 to 17,606.00/).closest("li"),
    ).toHaveClass("highlight");

    await press("Next →");
    expect(screen.getByText("Demo 5 of 5")).toBeVisible();
    await press("Replay duplicate event");
    expect(posts.at(-1)).toBe("/api/demo/replay-duplicate");
    await tick(1000);
    expect(screen.getByRole("status")).toHaveTextContent("Current. Processed through offset 3,502");
    expect(screen.getByText(/delivered again at offset 3,502/)).toBeVisible();
    expect(screen.getByRole("heading", { name: "MRR" }).nextElementSibling).toHaveTextContent(
      "17,934.00",
    );
    expect(
      screen.getAllByRole("listitem").filter((li) => /changed from/.test(li.textContent ?? "")),
    ).toHaveLength(1);

    await press("Finish Demo");
    expect(screen.getByRole("heading", { name: "Fresh Ledger demo complete" })).toBeVisible();
    expect(
      screen.getByText("Late events restate the period where they actually belong."),
    ).toBeVisible();

    await press("Return to Dashboard");
    expect(screen.queryByText(/Demo \d of 5/)).toBeNull();
    expect(screen.getByRole("heading", { name: "Demo controls" })).toBeVisible();
    expect(window.location.hash).toBe("");
  });

  it("restarting resets the source again and returns to step one, and the step survives a reload through the hash", async () => {
    const { source, posts } = stubSource();
    window.location.hash = "#demo/3";
    render(<App pollIntervalMs={1000} />);
    await tick();
    expect(screen.getByText("Demo 3 of 5")).toBeVisible();

    source.head = 3502;
    await press("Restart Demo");
    expect(posts).toEqual(["/api/demo/reset"]);
    expect(screen.getByText("Demo 1 of 5")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Current. Processed through offset 3,000");
  });
});
