-- Three ways to compute current MRR that must agree:
-- the latest snapshot, the projection table, and a fold straight from the events ledger.
WITH latest AS (
  SELECT current_mrr, active_subscribers FROM metric_snapshots ORDER BY checkpoint_offset DESC LIMIT 1
),
projected AS (
  SELECT coalesce(sum(current_mrr), 0)::numeric(18, 6) AS mrr, count(*) FILTER (WHERE status = 'active')::int AS active
  FROM subscriber_projections
),
folded AS (
  SELECT coalesce(sum(current_mrr), 0)::numeric(18, 6) AS mrr, count(*) FILTER (WHERE status = 'active')::int AS active
  FROM (__SUBSCRIBER_STATES__) states
)
SELECT
  latest.current_mrr AS snapshot_mrr,
  projected.mrr AS projected_mrr,
  folded.mrr AS folded_mrr,
  latest.active_subscribers AS snapshot_active,
  projected.active AS projected_active,
  folded.active AS folded_active,
  latest.current_mrr = projected.mrr AND projected.mrr = folded.mrr
    AND latest.active_subscribers = projected.active AND projected.active = folded.active AS reconciled
FROM latest, projected, folded
