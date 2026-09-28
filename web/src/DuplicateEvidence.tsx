import { formatMoney, type DeliveryRecord } from "@fresh-ledger/shared";
import { formatCount } from "./format";
import type { MetricsSnapshot } from "./snapshot";

export function DuplicateEvidence({
  before,
  after,
  delivery,
}: {
  before: MetricsSnapshot | null;
  after: MetricsSnapshot;
  delivery: DeliveryRecord | null;
}) {
  const rows: { label: string; from: string; to: string }[] = before
    ? [
        {
          label: "Checkpoint",
          from: formatCount(before.checkpoint),
          to: formatCount(after.checkpoint),
        },
        { label: "MRR", from: formatMoney(before.mrr), to: formatMoney(after.mrr) },
        { label: "ARR", from: formatMoney(before.arr), to: formatMoney(after.arr) },
        {
          label: "Active subscribers",
          from: formatCount(before.active_subscribers),
          to: formatCount(after.active_subscribers),
        },
        {
          label: "Restatements",
          from: formatCount(before.restatements),
          to: formatCount(after.restatements),
        },
      ]
    : [];
  return (
    <div className="evidence">
      {delivery ? (
        <p className="guided-line">
          Delivery {formatCount(delivery.source_offset)} carried event {delivery.event_id}
          {delivery.first_source_offset !== null &&
          delivery.first_source_offset !== delivery.source_offset
            ? `, already applied at offset ${formatCount(delivery.first_source_offset)}`
            : ""}
          . Result: {delivery.result}.
        </p>
      ) : null}
      {rows.length > 0 ? (
        <table className="evidence-table">
          <thead>
            <tr>
              <th scope="col">Value</th>
              <th scope="col">Before</th>
              <th scope="col">After</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} data-changed={row.from !== row.to}>
                <th scope="row">{row.label}</th>
                <td className="num">{row.from}</td>
                <td className="num">
                  {row.to}
                  {row.from === row.to ? <span className="meta"> unchanged</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
