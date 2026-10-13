ALTER TABLE attendances
  ADD COLUMN guests smallint NOT NULL DEFAULT 0;

ALTER TABLE attendances
  ADD CONSTRAINT attendances_guests CHECK (guests IN (0, 1));
