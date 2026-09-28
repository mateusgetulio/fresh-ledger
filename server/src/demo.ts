import type pg from "pg";
import type { DemoAction, DemoState } from "@fresh-ledger/shared";
import type { Fixture } from "./fixture/generate.js";

export type { DemoAction };

export const DEMO_ACTIONS: DemoAction[] = [
  "pause",
  "resume",
  "advance-source",
  "inject-late-cancellation",
  "replay-duplicate",
];

export type DemoOffsets = Pick<
  Fixture,
  "initial_head" | "reserve_end" | "late_cancellation_offset" | "duplicate_offset"
>;

export const ADVANCE_STEP = 100;

export function nextHead(action: DemoAction, head: number, offsets: DemoOffsets): number {
  switch (action) {
    case "advance-source":
      return Math.max(head, Math.min(head + ADVANCE_STEP, offsets.reserve_end));
    case "inject-late-cancellation":
      return Math.max(head, offsets.late_cancellation_offset);
    case "replay-duplicate":
      return Math.max(head, offsets.duplicate_offset);
    case "pause":
    case "resume":
      return head;
  }
}

export async function applyDemoAction(
  pool: pg.Pool,
  action: DemoAction,
  offsets: DemoOffsets,
): Promise<DemoState> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ head_offset: string; consumer_paused: boolean }>(
      "SELECT head_offset, consumer_paused FROM source_state FOR UPDATE",
    );
    const current = rows[0];
    if (current === undefined) throw new Error("source_state row is missing");
    const head = nextHead(action, Number(current.head_offset), offsets);
    const paused =
      action === "pause" ? true : action === "resume" ? false : current.consumer_paused;
    await client.query("UPDATE source_state SET head_offset = $1, consumer_paused = $2", [
      head,
      paused,
    ]);
    await client.query("COMMIT");
    return { head_offset: head, consumer_paused: paused };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
