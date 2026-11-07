CREATE TABLE IF NOT EXISTS admin_setting_users (
  kind text NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  PRIMARY KEY (kind, user_id),
  CONSTRAINT admin_setting_users_kind CHECK (kind IN ('linked', 'slot_request'))
);

CREATE INDEX IF NOT EXISTS admin_setting_users_user_idx ON admin_setting_users (user_id);

INSERT INTO admin_setting_users (kind, user_id)
SELECT 'linked', id
FROM users
WHERE id = '3c390d87-222d-457b-b2db-49d76053c09e'
ON CONFLICT DO NOTHING;
