ALTER TABLE slot_proposals DROP CONSTRAINT IF EXISTS slot_proposals_status;
ALTER TABLE slot_proposals ADD CONSTRAINT slot_proposals_status
  CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn'));
