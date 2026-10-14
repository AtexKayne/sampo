ALTER TABLE refresh_sessions
  ADD COLUMN login_user_id uuid REFERENCES users (id) ON DELETE CASCADE;

UPDATE refresh_sessions SET login_user_id = user_id;

ALTER TABLE refresh_sessions
  ALTER COLUMN login_user_id SET NOT NULL;
