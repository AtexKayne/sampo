CREATE TABLE slots (
  id uuid PRIMARY KEY,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  place text NOT NULL,
  capacity integer NOT NULL,
  status text NOT NULL DEFAULT 'open',
  series_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slots_status CHECK (status IN ('open', 'cancelled')),
  CONSTRAINT slots_place_len CHECK (char_length(place) BETWEEN 1 AND 80),
  CONSTRAINT slots_capacity CHECK (capacity BETWEEN 1 AND 200),
  CONSTRAINT slots_order CHECK (ends_at > starts_at),
  CONSTRAINT slots_duration CHECK (
    ends_at - starts_at >= interval '30 minutes'
    AND ends_at - starts_at <= interval '6 hours'
  ),
  CONSTRAINT slots_same_moscow_day CHECK (
    ((starts_at AT TIME ZONE 'Europe/Moscow')::date)
    = ((ends_at AT TIME ZONE 'Europe/Moscow')::date)
  )
);

CREATE INDEX slots_starts_at_idx ON slots (starts_at);
