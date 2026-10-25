# Recurring Billing Rules (প্রতি মাসে Discount / Adjustment) — Analysis + Plan

URL: `/invoice?resellerId=17&month=2026-10` — প্রতি মাসে হাতে discount/adjustment না ঢুকিয়ে frontend থেকে rule হিসেবে set করা + bill calculation এ auto-apply।

## 1. বর্তমান অবস্থা (verified)

- Bill engine: `server/controllers/reseller/service.js:19-59,79-517` — recurring charge = `resellers.*_bw * rate_* + real_ip` থেকে code দিয়ে হিসাব। কোনো rule table নাই।
- Discount/adjustment এখন one-off:
  - `billing_logs(log_type='discount')` via `server/controllers/reseller/billing.js:127-142` (`addDiscount` → `addBillingLog`)
  - finalize-time `monthly_bills.adjustment` via `billing.js:192-346`
- Invoice UI `client/src/pages/Invoice.jsx:72-75,127-218,390-401` read-only। Discount entry শুধু `ResellerProfile > DiscountModal.jsx` এ।
- `recurring_discounts / billing_rules / subscription / coupon` table repo তে নাই (grep verified)।
- Formula: `netPayable = prevDue + totalAmount + adj + product_charges - paid - discount` (`Invoice.jsx:401`), `previousDue = priorClosing + extraProduct - extraPayments` (`billing.js:279`)।

## 2. প্রস্তাব: `reseller_billing_rules` (1টা নতুন table)

```sql
-- server/migrations/20261011_reseller_billing_rules.sql
-- NOTE: server/.gitignore *.sql ignore করে, তাই git add -f লাগবে
CREATE TABLE IF NOT EXISTS reseller_billing_rules (
  id BIGSERIAL PRIMARY KEY,
  reseller_id INTEGER NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
  rule_type VARCHAR(40) NOT NULL, -- 'discount_fixed' (flat Tk) | 'bw_billable' (bill only X Mbps of bw_type)
  bw_type VARCHAR(10) NULL, -- bw_billable only: IIG|BDIX|GGC|FNA|CDN|BCDN|NTTN
  effective_month DATE NOT NULL,   -- YYYY-MM-01 (month-truncated)
  end_month DATE NULL,             -- NULL = চলমান
  amount NUMERIC(14,2) NOT NULL DEFAULT 0, -- pct হলে 0-100
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  note TEXT NULL,
  created_by INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_rbr_month_trunc CHECK (effective_month = DATE_TRUNC('month', effective_month)::date),
  CONSTRAINT chk_rbr_end_after_start CHECK (end_month IS NULL OR end_month >= effective_month),
  CONSTRAINT chk_rbr_rule_type CHECK (rule_type IN ('discount_fixed','bw_billable'))

> 2026-10-12 update: `discount_pct`, `recurring_adjustment`, `otc_override`
> retired. Only `discount_fixed` + `bw_billable` remain. `bw_billable` bills
> only `amount` Mbps of `bw_type` (e.g. GGC 400 → billable 50, rest shows as
> a "GGC discount" line: `net = typeTotal × billable/avgBw`). Unique scope is
> `(reseller_id, rule_type, COALESCE(bw_type,''), effective_month)`.
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rbr_active_reseller_type_month
  ON reseller_billing_rules (reseller_id, rule_type, effective_month)
  WHERE deleted_at IS NULL AND is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_rbr_reseller_month ON reseller_billing_rules (reseller_id, effective_month DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rbr_lookup ON reseller_billing_rules (reseller_id, rule_type, is_active) WHERE deleted_at IS NULL;
```

- Soft-delete only (`deleted_at + is_active=FALSE`)। Hard `DELETE` নিষেধ — finalized bill reproducibility ভাঙবে।
- `dbSetup.js:115-176` (`initBillingAutomationSchema`) pattern এ boot-time `CREATE TABLE/INDEX IF NOT EXISTS` mirror লাগবে, কারণ **কোনো migration runner নাই** — `server/migrations/*.sql` manual `psql`, `server/index.js:72-78` boot এ reseller `initialize()` চলে না, শুধু finalize/generate path এ (`resellerController.js:19,71`)। `ops/deploy_all_full.ps1:978-1012` শুধু code + PM2 reload করে, DDL চালায় না।
- Audit: `resellerFinancialAudit.js:57-99` via `logResellerFinancialChange` — `BILLING_RULE_CREATE/UPDATE/DEACTIVATE`, `reference_table='reseller_billing_rules'`।

## 3. Calculation-এ ঢোকানোর নিয়ম

- `calculateMonthlyBillBreakdown(resellerId, ym)` এ rule lookup:
  `WHERE reseller_id=? AND is_active AND deleted_at IS NULL AND effective_month<=ym AND (end_month IS NULL OR end_month>=ym)`।
- Order: `base_total (bw+ip+otc) → percent discount → fixed discount → +/- adjustment → + charge`। প্রতিটা applied rule `items[]` এ আলাদা line।
- **Single source of truth**: rule শুধু breakdown items এ ঢুকবে, `billing_logs` এ auto-row লিখবে না — নইলে double-count (`billing.js:304-317,538-539` vs `invoice.js:77-87`)।
- `getMonthlySummary` (`billing.js:502-565`) ইতিমধ্যে batched (`ANY` queries + `CHUNK=5`, pool max 20 — `db.js:28`)। Rule query per reseller/month করলে N×M ফিরে আসবে। Batch-load একবার: `reseller_id = ANY($1)` → `rulesMap`, তারপর in-memory apply। Predicate sargable রাখতে `(start_month, end_month)` btree।
- Rounding: existing pattern follow — per-segment `round` (`service.js:392,447,481`) + final `round` (`:515`)। Percent আগে, fixed পরে। `SUM(items.total) == bill.amount` invariant check যোগ করা (এখন `utils.js:146-168` এ নাই)।
- Prorate: joining-month + `from_day/to_day` partial view (`service.js:124-132`, `invoice.js:18-19`) এ rule amount ও clip করতে হবে, নইলে 15 তারিখে join করা reseller over-discount পাবে। Non-active reseller past-month logic (`service.js:118-119`) replicate করতে হবে।
- OTC: `service.js:497` + `utils.js:62-78` single-month one-shot। Rule + `otc_charge_applied_month` একই মাসে fire করলে double-OTC — precedence define করা (rule wins), `getOtcAppliedMonthYm` fallback order touch না করা।

## 4. API (4 endpoint, `resellerRoutes.js:35` এর নিচে বসাতে হবে — উপরে বসালে auth miss হবে)

```
GET    /api/resellers/resellers/:id/billing-rules?month=YYYY-MM
POST   /api/resellers/resellers/:id/billing-rules
PATCH  /api/resellers/resellers/:id/billing-rules/:ruleId
DELETE /api/resellers/resellers/:id/billing-rules/:ruleId  (soft)
```

- Permission: rule write → `billing.generate_bill` (+ discount-type এ `billing.discount.add`), read/preview → `requireAnyPermission(['billing.invoice.view','billing.generate_bill'])`। নতুন `billing.rules.manage` বানানো যাবে না যতক্ষণ registry + role grant flow (`MEMORY.md` Add-New-Permission) না হয় — test `server/tests/financial-security.test.cjs:64-77` ভাঙবে।
- Validation (server-side, `billing.js:48` pattern): percent `0 < p <= 100`, amount finite, `effective_month` must be `-01` (400), overlap check txn ভেতরে `SELECT ... FOR UPDATE` reseller row + `23505` → friendly 409।
- Idempotency: كل mutation এ `crypto.randomUUID` key (`useResellerProfile.js:49-50` pattern), deterministic rule-apply (calculate pure রাখা — side-effect লিখলে `getMonthlySummary` N× call এ multiply হবে)।
- SQL: সব `$n` parameterized (`billing.js:61,77,177` precedent), `rule_type` whitelist।

## 5. Frontend (`client/src/pages/Invoice.jsx:627-699` toolbar area)

- নতুন `BillingRulesPanel` — ঐ reseller+month এর active rules list + Add/Edit/Stop (end_month set / deactivate)। `DiscountModal` pattern reuse।
- `end_month` খালি = চলমান। `netPayable` formula (`Invoice.jsx:401`) unchanged, শুধু rule অংশ auto-ঢুকবে + tooltip এ rule name।
- Rule save এর পর `loadInvoice()` + rule list + rate-change logs (`Invoice.jsx:225-229`) invalidate করা — নইলে `[resellerId,month]` trigger (`:220-223`) বদলায় না, stale total থেকে PNG/email snapshot (`:231-252`) ভুল যাবে। Snapshot button refetch চলাকালীন disable।
- Channel partner (`partner_type='channel_partner'`) → panel hide + API 400 (retro pattern `retroactiveCorrection.js:207-211`)। Phase-1 শুধু distribution/mac। `mac_partner` semantics (`useResellerProfile.js:220-228`) আলাদা decide লাগবে।
- Partner portal: `partner/invoiceController.js:61-71` সব amount sum করে, `log_type` filter নাই — office total এর সাথে mismatch হবে। Portal query তে office এর মতো type filter + rule line items payload এ যোগ করা লাগবে।

## 6. Risk register (9টা — guard ছাড়া ship নিষেধ)

| # | Risk | Evidence | Fix |
|---|------|----------|-----|
| 1 | Double-count (breakdown + billing_logs + adjustment) | `billing.js:304-317,510,538`, `invoice.js:79-85` | Rule শুধু breakdown items, auto ledger-row নয় |
| 2 | `previous_due` chain diverge (3 impl অমিল, finalized freeze) | `billing.js:253-300`, `invoice.js:110-151`, `dbSetup.js:340-366` | Unfinalized/future month only; পুরনো মাসে retro cascade path |
| 3 | Finalize race + retro/finalize interleave | `billing.js:195-209`, `retroactiveCorrection.js:513-516`, `Invoice.jsx:320-344` | Unique index apply + `23505→409`, advisory/xact lock |
| 4 | Prorate/joining/partial-window over-charge | `service.js:124-132,391-393,479-482` | Rule amount clip replicate |
| 5 | OTC double-apply | `service.js:497`, `utils.js:62-78` | Precedence (rule wins), fallback untouched |
| 6 | Rounding penny-mismatch | `service.js:392,447,481,515` | Order spec + invariant check |
| 7 | Percent/overlap/date invalid | `DiscountModal.jsx:20-39`, `resellerController.js:22` | Server clamp + CHECK + UNIQUE + 409 |
| 8 | Channel branch silent-no-effect | `Invoice.jsx:139,166,195`, `billing.js:220-242` | Gate panel+API by partner_type |
| 9 | Portal wrong total + stale snapshot | `partner/invoiceController.js:61-71`, `Invoice.jsx:231-252` | Portal filter + rule lines; invalidate on mutate |

## 7. আরও যে analysis বাকি (ship-এর আগে লাগবে)

1. **Existing repeat discount audit** — `billing_logs` এ ≥3 মাস same amount+desc চলছে এমন candidate বের করা (নিচে query), review করে rule-এ convert করা। 2-3 বার coincidentally মিলে গেলে auto-convert নয়।
2. **Permission matrix sign-off** — কোন role (`billing.generate_bill` vs `billing.discount.add` vs viewer) rule CRUD পাবে, seed/migration এ role grant লাগবে কিনা।
3. **Stacking semantics** — একই মাসে 2 rule (pct + fixed) থাকলে order + cap (e.g. discount ≤ base_total) product decision।
4. **Backfill/cutover plan** — prod এ manual `psql` কে চালাবে (owner role, `42501` handling), `git add -f` migration, deploy window (DDL empty table বলে lock-free)।
5. **Test plan** — `server/package.json:16` (`node --test tests/*.test.cjs`): permission gate test, invalid amount/window → no INSERT, finalize exactly-once + re-finalize 409, deactivate → not applied, audit row written। Billing-math unit test এখন নাই — নতুন engine branch এর জন্য যোগ করা।
6. **Rollback drill** — additive-only (no DROP), code revert safe, bad rows `is_active=FALSE`। `DROP TABLE` post-launch নিষেধ।
7. **Portal + channel scope** — portal payload change + channel exclusion QA checklist।

### Candidate-detection query (read-only)

```sql
SELECT reseller_id,
  COALESCE(log_type, CASE WHEN LOWER(COALESCE(change_desc,'')) LIKE 'discount:%' THEN 'discount'
    WHEN COALESCE(transaction_amount,0) > 0 THEN 'payment' ELSE 'adjustment' END) AS ltype,
  transaction_amount,
  TRIM(REGEXP_REPLACE(COALESCE(change_desc,''),'\s+',' ','g')) AS norm_desc,
  COUNT(DISTINCT date_trunc('month', COALESCE(effective_date, created_at))) AS months,
  MIN(COALESCE(effective_date,created_at)), MAX(COALESCE(effective_date,created_at))
FROM billing_logs
WHERE COALESCE(log_type,'') IN ('discount','charge','product','product_charge','adjustment')
GROUP BY 1,2,3,4 HAVING COUNT(DISTINCT date_trunc('month', COALESCE(effective_date,created_at))) >= 3
ORDER BY months DESC;
```

## 8. Implementation order (approve হলে)

1. Migration + boot mirror + audit types
2. Engine (`service.js`) + finalize/invoice read + portal filter
3. API + permission + validation + idempotency
4. UI (`BillingRulesPanel`) + invalidate + channel gating
5. Candidate report → review → seed (manual, audit actor `migration`)
6. Tests (`financial-*` pattern) + `npm test` + staging verify
