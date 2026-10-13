CREATE TABLE availability_window_skips (
  window_id uuid NOT NULL REFERENCES availability_windows (id) ON DELETE CASCADE,
  studio_date date NOT NULL,
  PRIMARY KEY (window_id, studio_date)
);
