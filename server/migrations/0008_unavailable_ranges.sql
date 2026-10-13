ALTER TABLE availability_windows
  ADD COLUMN blocked boolean NOT NULL DEFAULT false;

ALTER TABLE availability_windows DROP CONSTRAINT windows_once;

ALTER TABLE availability_windows
  ADD CONSTRAINT windows_once CHECK (
    kind <> 'once' OR (
      starts_at IS NOT NULL AND ends_at IS NOT NULL
      AND ends_at > starts_at
      AND ends_at - starts_at >= interval '30 minutes'
      AND ends_at - starts_at <= interval '15 hours'
    )
  );
