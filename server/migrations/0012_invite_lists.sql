ALTER TABLE users
  ADD COLUMN invite_list text NOT NULL DEFAULT 'black',
  ADD CONSTRAINT users_invite_list CHECK (invite_list IN ('black', 'white'));

CREATE TABLE dancer_whitelist (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  allowed_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, allowed_user_id),
  CONSTRAINT dancer_whitelist_distinct CHECK (user_id <> allowed_user_id)
);

CREATE INDEX dancer_whitelist_allowed_idx ON dancer_whitelist (allowed_user_id);
