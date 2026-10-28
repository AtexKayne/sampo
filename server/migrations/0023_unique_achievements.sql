CREATE UNIQUE INDEX user_achievement_unique_grant
  ON user_achievement_overrides (achievement_id)
  WHERE granted AND achievement_id = 'cunning-carburetor';
