ALTER TABLE availability_windows DROP CONSTRAINT windows_kind;

ALTER TABLE availability_windows
  ADD CONSTRAINT windows_kind CHECK (kind IN ('once', 'weekly', 'daily', 'weekdays', 'weekends', 'interval'));

ALTER TABLE availability_windows
  ADD COLUMN interval_days smallint,
  ADD COLUMN anchor_date date;

ALTER TABLE availability_windows
  ADD CONSTRAINT windows_span CHECK (
    kind NOT IN ('daily', 'weekdays', 'weekends') OR (
      local_start IS NOT NULL AND local_end IS NOT NULL
      AND local_end > local_start
      AND local_end - local_start >= interval '30 minutes'
      AND local_end - local_start <= interval '12 hours'
      AND starts_at IS NULL AND ends_at IS NULL
      AND weekday IS NULL
      AND interval_days IS NULL
      AND anchor_date IS NULL
    )
  );

ALTER TABLE availability_windows
  ADD CONSTRAINT windows_interval CHECK (
    kind <> 'interval' OR (
      interval_days BETWEEN 2 AND 30
      AND anchor_date IS NOT NULL
      AND local_start IS NOT NULL AND local_end IS NOT NULL
      AND local_end > local_start
      AND local_end - local_start >= interval '30 minutes'
      AND local_end - local_start <= interval '12 hours'
      AND starts_at IS NULL AND ends_at IS NULL
      AND weekday IS NULL
    )
  );
