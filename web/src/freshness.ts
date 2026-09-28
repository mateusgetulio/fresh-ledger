import type { CurrentMetrics } from "@fresh-ledger/shared";
import { formatCount, formatSourceTime } from "./format";

export function freshnessSentence(current: CurrentMetrics): string {
  const checkpoint = formatCount(current.checkpoint_offset);
  if (
    current.status === "unavailable" ||
    current.pending_deliveries === null ||
    current.source_head_offset === null
  ) {
    return `Source unavailable. Values are from checkpoint ${checkpoint}; the source head could not be read.`;
  }
  const pending = formatCount(current.pending_deliveries);
  if (current.status === "current") {
    const at = current.checkpoint_source_received_at
      ? ` (${formatSourceTime(current.checkpoint_source_received_at)})`
      : "";
    return `Current. Processed through offset ${checkpoint}${at}. ${pending} pending.`;
  }
  return `Delayed. Processed through ${checkpoint} of ${formatCount(current.source_head_offset)}. ${pending} pending.`;
}
