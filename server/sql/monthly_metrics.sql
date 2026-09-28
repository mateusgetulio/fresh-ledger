WITH months AS (
  SELECT to_char(m AT TIME ZONE 'UTC', 'YYYY-MM') AS period, (m + interval '1 month') AS period_end
  FROM generate_series($1::timestamptz, $2::timestamptz, interval '1 month') AS m
),
state_at_month_end AS (
  SELECT
    mo.period,
    s.subscriber_id,
    s.type,
    s.plan_id
  FROM months mo
  CROSS JOIN LATERAL (
    SELECT DISTINCT ON (e.subscriber_id) e.subscriber_id, e.type, e.plan_id
    FROM events e
    LEFT JOIN event_conflicts c ON c.event_id = e.event_id
    WHERE c.event_id IS NULL AND e.effective_at < mo.period_end
    ORDER BY e.subscriber_id, e.effective_at DESC, e.first_source_offset DESC
  ) s
)
SELECT
  mo.period,
  coalesce(sum(
    CASE
      WHEN sme.type = 'subscription.cancelled' THEN 0::numeric(18, 6)
      WHEN p.cadence = 'annual' THEN (p.price_cents::numeric / 100 / 12)::numeric(18, 6)
      ELSE (p.price_cents::numeric / 100)::numeric(18, 6)
    END
  ), 0)::numeric(18, 6) AS mrr,
  count(*) FILTER (WHERE sme.type <> 'subscription.cancelled')::int AS active_subscribers
FROM months mo
LEFT JOIN state_at_month_end sme ON sme.period = mo.period
LEFT JOIN plans p ON p.id = sme.plan_id
GROUP BY mo.period
ORDER BY mo.period
