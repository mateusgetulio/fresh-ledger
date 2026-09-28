import { formatMoney, type CurrentMetrics } from "@fresh-ledger/shared";
import { formatCount } from "./format";

export function MetricCards({ current }: { current: CurrentMetrics }) {
  const cards = [
    { label: "MRR", value: formatMoney(current.metrics.mrr) },
    { label: "ARR", value: formatMoney(current.metrics.arr) },
    { label: "Active subscribers", value: formatCount(current.metrics.active_subscribers) },
  ];
  return (
    <section className="cards" aria-label="Current metrics">
      {cards.map((card) => (
        <article className="card" key={card.label}>
          <h2>{card.label}</h2>
          <p className="value">{card.value}</p>
          <p className="meta">Checkpoint {formatCount(current.checkpoint_offset)}</p>
        </article>
      ))}
    </section>
  );
}
