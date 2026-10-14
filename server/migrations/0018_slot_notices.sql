ALTER TABLE users
  ALTER COLUMN notify_invites SET DEFAULT false,
  ALTER COLUMN notify_hour_before SET DEFAULT false;

ALTER TABLE users
  ADD COLUMN notify_new_slots boolean NOT NULL DEFAULT false,
  ADD COLUMN notify_new_slots_scope text NOT NULL DEFAULT 'free';

ALTER TABLE users
  ADD CONSTRAINT users_notify_new_slots_scope_check
  CHECK (notify_new_slots_scope IN ('free', 'all'));
