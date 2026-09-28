import { describe, expect, it } from "vitest";
import { periodLabel, restatementSentence, type RestatementRow } from "../src/restatements.js";

const row: RestatementRow = {
  id: "1",
  metric: "mrr",
  period: "2026-08",
  previous_value: "70000.000000",
  new_value: "69900.000000",
  cause_event_id: "evt_1",
  other_causes: 0,
  detected_at_checkpoint: "3501",
  cause_type: "subscription.cancelled",
  cause_effective_at: new Date("2026-08-17T09:30:00Z"),
  cause_source_offset: "3217",
};

describe("restatement sentence", () => {
  it("renders the spec example deterministically", () => {
    expect(restatementSentence(row)).toBe(
      "August 2026 MRR changed from 70,000.00 to 69,900.00. A cancellation effective Aug 17 arrived at source offset 3,217.",
    );
  });

  it("renders subscriber counts as integers and names the other causes", () => {
    expect(
      restatementSentence({
        ...row,
        metric: "active_subscribers",
        previous_value: "742.000000",
        new_value: "743.000000",
        cause_type: "subscription.started",
        cause_effective_at: new Date("2026-01-03T00:00:00Z"),
        cause_source_offset: "12",
        period: "2026-01",
      }),
    ).toBe(
      "January 2026 active subscribers changed from 742 to 743. A subscription start effective Jan 3 arrived at source offset 12.",
    );
    expect(
      restatementSentence({ ...row, cause_type: "subscription.plan_changed", period: "2025-12" }),
    ).toContain("December 2025 MRR changed from 70,000.00 to 69,900.00. A plan change effective");
  });

  it("counts the other candidate events in the same batch instead of crediting one event with everything", () => {
    expect(restatementSentence({ ...row, other_causes: 1 })).toBe(
      "August 2026 MRR changed from 70,000.00 to 69,900.00. A cancellation effective Aug 17 arrived at source offset 3,217, with 1 other event in the same batch.",
    );
    expect(restatementSentence({ ...row, other_causes: 3 })).toContain(
      "offset 3,217, with 3 other events in the same batch.",
    );
  });

  it("labels periods by month name and year", () => {
    expect(periodLabel("2025-10")).toBe("October 2025");
  });
});
