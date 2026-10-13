ALTER TABLE sampo_requests DROP CONSTRAINT requests_reason;

ALTER TABLE sampo_requests
  ADD COLUMN cancel_note text,
  ADD CONSTRAINT requests_reason CHECK (
    cancel_reason IS NULL
    OR cancel_reason IN ('withdrawn', 'superseded', 'slot_cancelled', 'partner_cancelled')
  );
