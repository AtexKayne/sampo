ALTER TABLE availability_windows DROP CONSTRAINT windows_weekly;
ALTER TABLE availability_windows ADD CONSTRAINT windows_weekly CHECK (
  kind <> 'weekly' OR (
    weekday BETWEEN 1 AND 7
    AND local_start IS NOT NULL AND local_end IS NOT NULL
    AND local_end > local_start
    AND local_end - local_start >= interval '30 minutes'
    AND starts_at IS NULL AND ends_at IS NULL
  )
);

ALTER TABLE availability_windows DROP CONSTRAINT windows_span;
ALTER TABLE availability_windows ADD CONSTRAINT windows_span CHECK (
  kind NOT IN ('daily', 'weekdays', 'weekends') OR (
    local_start IS NOT NULL AND local_end IS NOT NULL
    AND local_end > local_start
    AND local_end - local_start >= interval '30 minutes'
    AND starts_at IS NULL AND ends_at IS NULL
    AND weekday IS NULL
    AND interval_days IS NULL
    AND anchor_date IS NULL
  )
);

ALTER TABLE availability_windows DROP CONSTRAINT windows_interval;
ALTER TABLE availability_windows ADD CONSTRAINT windows_interval CHECK (
  kind <> 'interval' OR (
    interval_days BETWEEN 2 AND 30
    AND anchor_date IS NOT NULL
    AND local_start IS NOT NULL AND local_end IS NOT NULL
    AND local_end > local_start
    AND local_end - local_start >= interval '30 minutes'
    AND starts_at IS NULL AND ends_at IS NULL
    AND weekday IS NULL
  )
);
