-- Current state per subscriber: the last non-conflict event by business time decides everything.
-- Parameter $1: optional array of subscriber ids (NULL means all).
WITH last_event AS (
  SELECT DISTINCT ON (e.subscriber_id)
    e.subscriber_id,
    e.event_id,
    e.type,
    e.plan_id,
    e.effective_at
  FROM events e
  LEFT JOIN event_conflicts c ON c.event_id = e.event_id
  WHERE c.event_id IS NULL
    AND ($1::text[] IS NULL OR e.subscriber_id = ANY ($1::text[]))
  ORDER BY e.subscriber_id, e.effective_at DESC, e.first_source_offset DESC
),
conflicts AS (
  SELECT subscriber_id, count(*)::int AS conflict_count
  FROM event_conflicts
  WHERE ($1::text[] IS NULL OR subscriber_id = ANY ($1::text[]))
  GROUP BY subscriber_id
)
SELECT
  le.subscriber_id,
  CASE WHEN le.type = 'subscription.cancelled' THEN 'inactive' ELSE 'active' END AS status,
  CASE WHEN le.type = 'subscription.cancelled' THEN NULL ELSE le.plan_id END AS plan_id,
  CASE
    WHEN le.type = 'subscription.cancelled' THEN 0::numeric(18, 6)
    WHEN p.cadence = 'annual' THEN (p.price_cents::numeric / 100 / 12)::numeric(18, 6)
    ELSE (p.price_cents::numeric / 100)::numeric(18, 6)
  END AS current_mrr,
  le.effective_at AS last_effective_at,
  le.event_id AS last_event_id,
  coalesce(cf.conflict_count, 0) AS conflict_count
FROM last_event le
LEFT JOIN plans p ON p.id = le.plan_id
LEFT JOIN conflicts cf ON cf.subscriber_id = le.subscriber_id
