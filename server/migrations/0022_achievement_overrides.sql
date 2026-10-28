CREATE TABLE user_achievement_overrides (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  achievement_id text NOT NULL,
  granted boolean NOT NULL,
  PRIMARY KEY (user_id, achievement_id),
  CONSTRAINT user_achievement_overrides_id CHECK (achievement_id ~ '^[a-z0-9-]{1,40}$')
);
