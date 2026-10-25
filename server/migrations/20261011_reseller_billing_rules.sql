-- server/migrations/20261011_reseller_billing_rules.sql
-- Recurring billing rules per reseller+month.
-- Types: 'discount_fixed' (flat Tk off) | 'bw_billable' (bill only X Mbps of
-- a bandwidth type; the rest shows as a "<TYPE> discount" line item).
-- NOTE: server/.gitignore ignores *.sql, so this file needs `git add -f`.
-- No migration runner exists: apply manually via psql AND rely on the
-- boot-time mirror in server/controllers/reseller/dbSetup.js (initResellerBillingRules).
-- Additive only: no DROP TABLE. Rollback = set is_active = FALSE (never DROP post-launch).

CREATE TABLE IF NOT EXISTS reseller_billing_rules (
  id BIGSERIAL PRIMARY KEY,
  reseller_id INTEGER NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
  rule_type VARCHAR(40) NOT NULL, -- 'discount_fixed' | 'bw_billable'
  bw_type VARCHAR(10) NULL, -- required for bw_billable (IIG|BDIX|GGC|FNA|CDN|BCDN|NTTN), NULL otherwise
  effective_month DATE NOT NULL,   -- YYYY-MM-01 (month-truncated)
  end_month DATE NULL,             -- NULL = ongoing
  amount NUMERIC(14,2) NOT NULL DEFAULT 0, -- discount_fixed: Tk | bw_billable: billable Mbps
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT NULL,
  idempotency_key VARCHAR(128) NULL,
  created_by INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_rbr_month_trunc CHECK (effective_month = DATE_TRUNC('month', effective_month)::date),
  CONSTRAINT chk_rbr_end_after_start CHECK (end_month IS NULL OR end_month >= effective_month),
  CONSTRAINT chk_rbr_rule_type CHECK (rule_type IN ('discount_fixed','bw_billable'))
);

-- One live rule per (reseller, type, bw, start-month). COALESCE lets
-- discount_fixed (bw_type NULL) keep single-per-month semantics while
-- bw_billable allows one row per bandwidth type.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rbr_active_reseller_type_month
  ON reseller_billing_rules (reseller_id, rule_type, COALESCE(bw_type, ''), effective_month)
  WHERE deleted_at IS NULL AND is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_rbr_reseller_month ON reseller_billing_rules (reseller_id, effective_month DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rbr_lookup ON reseller_billing_rules (reseller_id, rule_type, is_active) WHERE deleted_at IS NULL;

-- Idempotency dedupe scope: one client key per reseller (same pattern as billing_logs).
CREATE UNIQUE INDEX IF NOT EXISTS uq_rbr_idempotency_reseller
  ON reseller_billing_rules (reseller_id, idempotency_key)
  WHERE deleted_at IS NULL AND idempotency_key IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Upgrade path for deployments created 2026-10-11 with the retired 4-type
-- set (discount_pct, recurring_adjustment, otc_override). Idempotent.
-- ---------------------------------------------------------------------------
ALTER TABLE reseller_billing_rules ADD COLUMN IF NOT EXISTS bw_type VARCHAR(10);

-- Retire legacy-type rows (soft-deactivate, keeps audit trail; finalized
-- bills already froze their snapshots so nothing historical changes).
UPDATE reseller_billing_rules
  SET is_active = FALSE, deleted_at = COALESCE(deleted_at, NOW()), updated_at = NOW()
  WHERE deleted_at IS NULL AND rule_type NOT IN ('discount_fixed', 'bw_billable');

ALTER TABLE reseller_billing_rules DROP CONSTRAINT IF EXISTS chk_rbr_rule_type;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_rbr_rule_type'
  ) THEN
    ALTER TABLE reseller_billing_rules ADD CONSTRAINT chk_rbr_rule_type
      CHECK (rule_type IN ('discount_fixed','bw_billable'));
  END IF;
END $$;

DROP INDEX IF EXISTS uq_rbr_active_reseller_type_month;
CREATE UNIQUE INDEX IF NOT EXISTS uq_rbr_active_reseller_type_month
  ON reseller_billing_rules (reseller_id, rule_type, COALESCE(bw_type, ''), effective_month)
  WHERE deleted_at IS NULL AND is_active = TRUE;
