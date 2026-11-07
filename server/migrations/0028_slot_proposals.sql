CREATE TABLE IF NOT EXISTS slot_proposals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  place text,
  comment text,
  status text NOT NULL DEFAULT 'pending',
  slot_id uuid REFERENCES slots (id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES users (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slot_proposals_status CHECK (status IN ('pending', 'accepted', 'declined', 'expired')),
  CONSTRAINT slot_proposals_place_len CHECK (place IS NULL OR char_length(place) BETWEEN 1 AND 80),
  CONSTRAINT slot_proposals_comment_len CHECK (comment IS NULL OR char_length(comment) <= 500),
  CONSTRAINT slot_proposals_order CHECK (ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS slot_proposals_range_idx ON slot_proposals (starts_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS slot_proposals_user_idx ON slot_proposals (user_id, created_at);
