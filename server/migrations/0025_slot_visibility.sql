ALTER TABLE slots ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'open';
ALTER TABLE slots ADD COLUMN IF NOT EXISTS audience_list_id uuid;

DO $$
BEGIN
  ALTER TABLE slots ADD CONSTRAINT slots_visibility CHECK (visibility IN ('open', 'closed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS audience_lists (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_lists_name_len CHECK (char_length(name) BETWEEN 1 AND 80)
);

CREATE UNIQUE INDEX IF NOT EXISTS audience_lists_name_idx ON audience_lists (lower(name));

DO $$
BEGIN
  ALTER TABLE slots
    ADD CONSTRAINT slots_audience_list_fk
    FOREIGN KEY (audience_list_id) REFERENCES audience_lists (id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS audience_list_members (
  list_id uuid NOT NULL REFERENCES audience_lists (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (list_id, user_id)
);

CREATE TABLE IF NOT EXISTS slot_audience (
  slot_id uuid NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (slot_id, user_id)
);

CREATE INDEX IF NOT EXISTS slot_audience_user_idx ON slot_audience (user_id);
