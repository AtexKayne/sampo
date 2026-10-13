ALTER TABLE users
  ADD COLUMN dance_level text,
  ADD CONSTRAINT users_dance_level CHECK (dance_level IS NULL OR dance_level IN ('BG', 'RS', 'M', 'S', 'CH'));

CREATE TABLE invitation_blocks (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  level text NOT NULL,
  PRIMARY KEY (user_id, level),
  CONSTRAINT invitation_blocks_level CHECK (level IN ('BG', 'RS', 'M', 'S', 'CH'))
);

CREATE TABLE dancer_blacklist (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, blocked_user_id),
  CONSTRAINT dancer_blacklist_distinct CHECK (user_id <> blocked_user_id)
);

CREATE INDEX dancer_blacklist_blocked_idx ON dancer_blacklist (blocked_user_id);
