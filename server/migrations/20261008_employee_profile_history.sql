-- Employee profile change history (2026-10-08)
-- Additive only: safe to run on production. Gives every profile edit
-- an old->new diff so "ke bodlalo?" never needs backup forensics again.

ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_by INTEGER NULL;

CREATE TABLE IF NOT EXISTS employee_profile_history (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL,
  changed_by INTEGER NULL,
  changed_by_name TEXT NULL,
  change_source TEXT NOT NULL DEFAULT 'profile_update',
  changes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_history_employee
  ON employee_profile_history (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_history_changed_by
  ON employee_profile_history (changed_by);
