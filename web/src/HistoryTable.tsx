import { formatMoney, type MonthMetrics } from "@fresh-ledger/shared";
import { formatCount, formatPeriod } from "./format";

export function HistoryTable({
  history,
  highlightPeriod = null,
}: {
  history: MonthMetrics[];
  highlightPeriod?: string | null;
}) {
  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading">Monthly history</h2>
      <table className="history">
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">MRR</th>
            <th scope="col">Active subscribers</th>
            <th scope="col">State</th>
            <th scope="col">Computed at checkpoint</th>
          </tr>
        </thead>
        <tbody>
          {[...history].reverse().map((month) => (
            <tr
              key={month.period}
              data-state={month.state}
              className={month.period === highlightPeriod ? "highlight" : undefined}
            >
              <th scope="row">{formatPeriod(month.period)}</th>
              <td className="num">{formatMoney(month.mrr)}</td>
              <td className="num">{formatCount(month.active_subscribers)}</td>
              <td>
                {month.state === "closed" ? "Closed" : "Provisional"}
                {month.restated ? " (restated)" : ""}
              </td>
              <td className="num">
                {month.computed_at_checkpoint === null
                  ? "live"
                  : formatCount(month.computed_at_checkpoint)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
