-- Rebuild the projection rows for the given subscribers (NULL means all) from the events ledger.
WITH states AS (
  __SUBSCRIBER_STATES__
)
INSERT INTO subscriber_projections (subscriber_id, status, plan_id, current_mrr, last_effective_at, last_event_id, conflict_count)
SELECT subscriber_id, status, plan_id, current_mrr, last_effective_at, last_event_id, conflict_count FROM states
ON CONFLICT (subscriber_id) DO UPDATE SET
  status = EXCLUDED.status,
  plan_id = EXCLUDED.plan_id,
  current_mrr = EXCLUDED.current_mrr,
  last_effective_at = EXCLUDED.last_effective_at,
  last_event_id = EXCLUDED.last_event_id,
  conflict_count = EXCLUDED.conflict_count
