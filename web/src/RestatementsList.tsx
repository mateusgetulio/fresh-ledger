import type { Restatement } from "@fresh-ledger/shared";
import { formatCount } from "./format";

export function RestatementsList({
  restatements,
  highlightCheckpoint = null,
}: {
  restatements: Restatement[];
  highlightCheckpoint?: number | null;
}) {
  return (
    <section aria-labelledby="restatements-heading">
      <h2 id="restatements-heading">Restatements</h2>
      {restatements.length === 0 ? (
        <p className="meta">No closed month has changed since it was first computed.</p>
      ) : (
        <ol className="restatements">
          {restatements.map((r) => (
            <li
              key={r.id}
              className={r.detected_at_checkpoint === highlightCheckpoint ? "highlight" : undefined}
            >
              {r.sentence}{" "}
              <span className="meta">
                Detected at checkpoint {formatCount(r.detected_at_checkpoint)}.
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
