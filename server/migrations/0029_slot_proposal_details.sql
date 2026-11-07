UPDATE slot_proposals SET place = 'Зал 1' WHERE place IS NULL OR btrim(place) = '';

ALTER TABLE slot_proposals ALTER COLUMN place SET NOT NULL;

DO $$
BEGIN
  ALTER TABLE slot_proposals RENAME COLUMN comment TO description;
EXCEPTION
  WHEN undefined_column THEN NULL;
END $$;

ALTER TABLE slot_proposals DROP CONSTRAINT IF EXISTS slot_proposals_comment_len;
ALTER TABLE slot_proposals DROP CONSTRAINT IF EXISTS slot_proposals_description_len;
ALTER TABLE slot_proposals ADD CONSTRAINT slot_proposals_description_len CHECK (description IS NULL OR char_length(description) <= 1000);

ALTER TABLE slot_proposals ADD COLUMN IF NOT EXISTS responsible_user_id uuid REFERENCES users (id) ON DELETE SET NULL;
UPDATE slot_proposals SET responsible_user_id = user_id WHERE responsible_user_id IS NULL;
