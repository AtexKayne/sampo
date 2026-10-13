ALTER TABLE slots
  ADD COLUMN description text,
  ADD COLUMN responsible_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD CONSTRAINT slots_description_len CHECK (description IS NULL OR char_length(description) BETWEEN 1 AND 1000);
