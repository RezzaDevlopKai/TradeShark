-- Withdrawal settlement invariants
-- A withdrawal may only become confirmed when an external settlement reference
-- has been recorded. This keeps the database as the final guardrail even if an
-- application path bypasses the lifecycle service.

ALTER TABLE withdrawals
  ADD CONSTRAINT withdrawals_confirmed_requires_external_reference
  CHECK (status <> 'confirmed' OR external_reference IS NOT NULL);

ALTER TABLE withdrawals
  ADD CONSTRAINT withdrawals_confirmed_requires_confirmed_at
  CHECK (status <> 'confirmed' OR confirmed_at IS NOT NULL);

ALTER TABLE withdrawals
  ADD CONSTRAINT withdrawals_submitted_requires_submitted_at
  CHECK (status <> 'submitted' OR submitted_at IS NOT NULL);
