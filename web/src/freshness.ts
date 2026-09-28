import type { CurrentMetrics } from "@fresh-ledger/shared";
import { formatCount, formatSourceTime } from "./format";

export function freshnessSentence(current: CurrentMetrics): string {
  const checkpoint = formatCount(current.checkpoint_offset);
  const pending = formatCount(current.pending_deliveries);
  switch (current.status) {
    case "current": {
      const at = current.checkpoint_source_received_at
        ? ` (${formatSourceTime(current.checkpoint_source_received_at)})`
        : "";
      return `Current. Processed through offset ${checkpoint}${at}. ${pending} pending.`;
    }
    case "delayed":
      return `Delayed. Processed through ${checkpoint} of ${formatCount(current.source_head_offset)}. ${pending} pending.`;
    case "unavailable":
      return `Source unavailable. Values are from checkpoint ${checkpoint}; the source head could not be read.`;
  }
}
