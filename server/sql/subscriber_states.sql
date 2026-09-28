WITH subscribers AS (
  SELECT DISTINCT subscriber_id
  FROM events
  WHERE ($1::text[] IS NULL OR subscriber_id = ANY ($1::text[]))
),
last_event AS (
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
  s.subscriber_id,
  CASE WHEN le.type IN ('subscription.started', 'subscription.plan_changed') THEN 'active' ELSE 'inactive' END AS status,
  CASE WHEN le.type IN ('subscription.started', 'subscription.plan_changed') THEN le.plan_id END AS plan_id,
  CASE
    WHEN le.type IS NULL OR le.type = 'subscription.cancelled' THEN 0::numeric(18, 6)
    WHEN p.cadence = 'annual' THEN (p.price_cents::numeric / 100 / 12)::numeric(18, 6)
    ELSE (p.price_cents::numeric / 100)::numeric(18, 6)
  END AS current_mrr,
  le.effective_at AS last_effective_at,
  le.event_id AS last_event_id,
  coalesce(cf.conflict_count, 0) AS conflict_count
FROM subscribers s
LEFT JOIN last_event le ON le.subscriber_id = s.subscriber_id
LEFT JOIN plans p ON p.id = le.plan_id
LEFT JOIN conflicts cf ON cf.subscriber_id = s.subscriber_id
