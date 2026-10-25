-- Required before enabling the pending/approved/rejected reconciliation workflow.
-- Add supported states while preserving every legacy record and completed status.
-- Run with a migration account and ON_ERROR_STOP; the transaction is all-or-nothing.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
LOCK TABLE public.billing_reconciliation_logs IN ACCESS EXCLUSIVE MODE;

ALTER TABLE public.billing_reconciliation_logs
    DROP CONSTRAINT IF EXISTS billing_reconciliation_logs_reconciliation_status_check;
ALTER TABLE public.billing_reconciliation_logs
    ADD CONSTRAINT billing_reconciliation_logs_reconciliation_status_check
    CHECK (reconciliation_status IN ('draft', 'pending', 'approved', 'rejected', 'reconciled', 'finalized')) NOT VALID;
ALTER TABLE public.billing_reconciliation_logs
    VALIDATE CONSTRAINT billing_reconciliation_logs_reconciliation_status_check;

COMMIT;
