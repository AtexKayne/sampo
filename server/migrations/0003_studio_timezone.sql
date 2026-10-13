ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_same_moscow_day;
ALTER TABLE slots DROP CONSTRAINT IF EXISTS slots_same_studio_day;

ALTER TABLE slots ADD CONSTRAINT slots_same_studio_day CHECK (
  ((starts_at AT TIME ZONE 'Asia/Yekaterinburg')::date)
  = ((ends_at AT TIME ZONE 'Asia/Yekaterinburg')::date)
);
