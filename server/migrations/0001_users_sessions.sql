CREATE TABLE users (
  id uuid PRIMARY KEY,
  login text UNIQUE,
  password_hash text,
  vk_user_id bigint UNIQUE,
  display_name text NOT NULL,
  app_role text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_app_role CHECK (app_role IN ('user', 'admin')),
  CONSTRAINT users_login_or_vk CHECK (login IS NOT NULL OR vk_user_id IS NOT NULL),
  CONSTRAINT users_password_with_login CHECK (login IS NULL OR password_hash IS NOT NULL),
  CONSTRAINT users_login_format CHECK (login IS NULL OR login ~ '^[a-z0-9_]{3,32}$'),
  CONSTRAINT users_display_name_len CHECK (char_length(display_name) BETWEEN 1 AND 80)
);

CREATE TABLE refresh_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_sessions_user_id_idx ON refresh_sessions (user_id);
