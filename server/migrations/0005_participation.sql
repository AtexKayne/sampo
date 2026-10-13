CREATE TABLE attendances (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot_id)
);

CREATE TABLE availabilities (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot_id)
);

CREATE TABLE availability_windows (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  weekday smallint,
  local_start time,
  local_end time,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT windows_kind CHECK (kind IN ('once', 'weekly')),
  CONSTRAINT windows_once CHECK (
    kind <> 'once' OR (
      starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND ends_at > starts_at
      AND ends_at - starts_at >= interval '30 minutes'
      AND ends_at - starts_at <= interval '6 hours'
    )
  ),
  CONSTRAINT windows_weekly CHECK (
    kind <> 'weekly' OR (
      weekday BETWEEN 1 AND 7
      AND local_start IS NOT NULL AND local_end IS NOT NULL
      AND local_end > local_start
      AND local_end - local_start >= interval '30 minutes'
      AND local_end - local_start <= interval '12 hours'
      AND starts_at IS NULL AND ends_at IS NULL
    )
  )
);

CREATE TABLE availability_exceptions (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, slot_id)
);

CREATE TABLE sampo_requests (
  id uuid PRIMARY KEY,
  slot_id uuid NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  CONSTRAINT requests_status CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  CONSTRAINT requests_reason CHECK (cancel_reason IS NULL OR cancel_reason IN ('withdrawn', 'superseded', 'slot_cancelled')),
  CONSTRAINT requests_distinct CHECK (from_user_id <> to_user_id)
);

CREATE UNIQUE INDEX sampo_requests_pending_idx
  ON sampo_requests (slot_id, from_user_id, to_user_id)
  WHERE status = 'pending';

CREATE TABLE pairs (
  id uuid PRIMARY KEY,
  slot_id uuid NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  user_low_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_high_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE REFERENCES sampo_requests (id),
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CONSTRAINT pairs_status CHECK (status IN ('confirmed', 'cancelled')),
  CONSTRAINT pairs_order CHECK (user_low_id < user_high_id)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications (id) ON DELETE CASCADE,
  channel text NOT NULL,
  status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deliveries_channel CHECK (channel IN ('push', 'vk')),
  CONSTRAINT deliveries_status CHECK (status IN ('pending', 'sent', 'failed', 'skipped'))
);
