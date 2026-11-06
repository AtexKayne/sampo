ALTER TABLE users
  ADD COLUMN notify_channel text NOT NULL DEFAULT 'push';

ALTER TABLE users
  ADD CONSTRAINT users_notify_channel_check
  CHECK (notify_channel IN ('push', 'vk'));

CREATE INDEX notification_deliveries_vk_idx
  ON notification_deliveries (next_attempt_at)
  WHERE channel = 'vk' AND status = 'pending';
