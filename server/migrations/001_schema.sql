CREATE TABLE plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  cadence text NOT NULL CHECK (cadence IN ('monthly', 'annual')),
  price_cents integer NOT NULL CHECK (price_cents > 0)
);

CREATE TABLE source_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  head_offset bigint NOT NULL DEFAULT 0,
  consumer_paused boolean NOT NULL DEFAULT false
);
INSERT INTO source_state DEFAULT VALUES;

CREATE TABLE source_deliveries (
  source_offset bigint PRIMARY KEY,
  source_received_at timestamptz NOT NULL,
  event_id text NOT NULL,
  payload jsonb NOT NULL,
  result text CHECK (result IN ('applied', 'duplicate', 'conflict')),
  result_detail text,
  processed_at timestamptz
);
CREATE INDEX source_deliveries_event_id ON source_deliveries (event_id);

CREATE TABLE events (
  event_id text PRIMARY KEY,
  subscriber_id text NOT NULL,
  type text NOT NULL CHECK (type IN ('subscription.started', 'subscription.plan_changed', 'subscription.cancelled')),
  plan_id text REFERENCES plans (id),
  effective_at timestamptz NOT NULL,
  first_source_offset bigint NOT NULL REFERENCES source_deliveries (source_offset)
);
CREATE INDEX events_subscriber_timeline ON events (subscriber_id, effective_at, first_source_offset);
CREATE INDEX events_effective_at ON events (effective_at);

CREATE TABLE event_conflicts (
  event_id text PRIMARY KEY REFERENCES events (event_id),
  subscriber_id text NOT NULL,
  detail text NOT NULL
);

CREATE TABLE subscriber_projections (
  subscriber_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('active', 'inactive')),
  plan_id text REFERENCES plans (id),
  current_mrr numeric(18, 6) NOT NULL DEFAULT 0,
  last_effective_at timestamptz,
  last_event_id text REFERENCES events (event_id),
  conflict_count integer NOT NULL DEFAULT 0
);
CREATE INDEX subscriber_projections_status ON subscriber_projections (status);

CREATE TABLE monthly_metrics (
  period text PRIMARY KEY,
  mrr numeric(18, 6) NOT NULL,
  active_subscribers integer NOT NULL,
  computed_at_checkpoint bigint NOT NULL
);

CREATE TABLE restatements (
  id bigserial PRIMARY KEY,
  metric text NOT NULL CHECK (metric IN ('mrr', 'active_subscribers')),
  period text NOT NULL,
  previous_value numeric(18, 6) NOT NULL,
  new_value numeric(18, 6) NOT NULL,
  cause_event_id text NOT NULL REFERENCES events (event_id),
  detected_at_checkpoint bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE metric_snapshots (
  id bigserial PRIMARY KEY,
  checkpoint_offset bigint NOT NULL UNIQUE,
  checkpoint_source_received_at timestamptz,
  current_mrr numeric(18, 6) NOT NULL,
  current_arr numeric(18, 6) NOT NULL,
  active_subscribers integer NOT NULL,
  conflicts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO metric_snapshots (checkpoint_offset, checkpoint_source_received_at, current_mrr, current_arr, active_subscribers)
VALUES (0, NULL, 0, 0, 0);
