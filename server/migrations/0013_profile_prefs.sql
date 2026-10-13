ALTER TABLE users
  ADD COLUMN notify_invites boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_hour_before boolean NOT NULL DEFAULT true,
  ADD COLUMN share_availability boolean NOT NULL DEFAULT false;

CREATE TABLE slot_reminders (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES slots (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, slot_id)
);
