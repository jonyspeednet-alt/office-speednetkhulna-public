const pool = require("./db");

let tablesInitialized = false;
let initInProgress = false;
let lastInitFailedAt = 0;
const INIT_COOLDOWN_MS = 60_000;

const initPartnerOnboardingTables = async () => {
  if (tablesInitialized) return;
  if (initInProgress) return;
  if (Date.now() - lastInitFailedAt < INIT_COOLDOWN_MS) return;
  initInProgress = true;
  try {
    const runQuery = async (sql, params = []) => {
      try {
        await pool.query(sql, params);
      } catch (error) {
        if (
          error?.code === "42501" ||
          String(error?.message || "").toLowerCase().includes("must be owner")
        ) {
          console.warn(`[PartnerOnboarding] DDL skipped (insufficient privilege): ${sql.substring(0, 60)}...`);
          return;
        }
        console.error(`[PartnerOnboarding] DDL error: ${error.message}`);
        console.error(`[PartnerOnboarding] Failed SQL: ${sql.substring(0, 120)}...`);
        throw error;
      }
    };

    // Main onboarding forms table — additive only, never touches resellers
    await runQuery(`
      CREATE TABLE IF NOT EXISTS partner_onboardings (
        id BIGSERIAL PRIMARY KEY,
        ref_number VARCHAR(60) NOT NULL UNIQUE,
        status VARCHAR(30) NOT NULL DEFAULT 'draft',
        reseller_id INT NULL REFERENCES resellers(id) ON DELETE SET NULL,
        reseller_code VARCHAR(100),
        partner_name TEXT NOT NULL,
        partner_type VARCHAR(30) NOT NULL DEFAULT 'mac',
        contact_number VARCHAR(50),
        address TEXT,
        onboarding_date DATE,
        latitude NUMERIC(10,7),
        longitude NUMERIC(10,7),
        photo_path TEXT,
        revenue_sharing VARCHAR(20),
        agent_commission NUMERIC(5,2),
        dist_total_capacity NUMERIC,
        dist_req_rate NUMERIC,
        pop_declared BOOLEAN,
        pop_address TEXT,
        pop_type VARCHAR(30),
        agreement_duration TEXT,
        agreement_start_date DATE,
        agreement_expiry_date DATE,
        current_customers INT,
        previous_isp TEXT,
        has_due BOOLEAN,
        due_amount NUMERIC(12,2),
        form_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        submitted_by INT REFERENCES users(id) ON DELETE SET NULL,
        verified_by INT REFERENCES users(id) ON DELETE SET NULL,
        approved_by INT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await runQuery(`CREATE INDEX IF NOT EXISTS idx_po_status ON partner_onboardings(status)`);
    await runQuery(`CREATE INDEX IF NOT EXISTS idx_po_reseller ON partner_onboardings(reseller_id)`);
    await runQuery(`CREATE INDEX IF NOT EXISTS idx_po_type ON partner_onboardings(partner_type)`);
    await runQuery(`CREATE INDEX IF NOT EXISTS idx_po_created_at ON partner_onboardings(created_at DESC)`);
    await runQuery(`CREATE INDEX IF NOT EXISTS idx_po_ref ON partner_onboardings(ref_number)`);

    // Ensure updated_at auto-touch (if column missing, add)
    await runQuery(`ALTER TABLE partner_onboardings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await runQuery(`ALTER TABLE partner_onboardings ADD COLUMN IF NOT EXISTS photo_path TEXT`);
    await runQuery(`ALTER TABLE partner_onboardings ADD COLUMN IF NOT EXISTS reseller_code VARCHAR(100)`);
    await runQuery(`ALTER TABLE partner_onboardings ADD COLUMN IF NOT EXISTS agent_commission NUMERIC(5,2)`);
    // Backfill rows saved before the column existed (best-effort, idempotent, never aborts init)
    await runQuery(`UPDATE partner_onboardings SET agent_commission = CASE WHEN btrim(regexp_replace(COALESCE(form_data->>'agentCommissionPct', form_data->>'agent_commission'),'%','','g')) ~ '^[0-9]+(\\.[0-9]+)?$' THEN btrim(regexp_replace(COALESCE(form_data->>'agentCommissionPct', form_data->>'agent_commission'),'%','','g'))::numeric ELSE NULL END WHERE agent_commission IS NULL AND COALESCE(form_data->>'agentCommissionPct', form_data->>'agent_commission') IS NOT NULL`);

    // Approvals child table
    await runQuery(`
      CREATE TABLE IF NOT EXISTS partner_onboarding_approvals (
        id BIGSERIAL PRIMARY KEY,
        onboarding_id BIGINT NOT NULL REFERENCES partner_onboardings(id) ON DELETE CASCADE,
        stage VARCHAR(80) NOT NULL,
        approver_name TEXT,
        approver_id INT REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        sign_date DATE,
        comment TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(onboarding_id, stage)
      )
    `);
    await runQuery(`CREATE INDEX IF NOT EXISTS idx_poa_onboarding ON partner_onboarding_approvals(onboarding_id)`);

    // Uploads dir for onboarding photos (best-effort, no DB)
    try {
      const path = require('path');
      const fs = require('fs');
      const dir = path.resolve(__dirname, '../../uploads/partner_onboarding');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const keep = path.join(dir, '.gitkeep');
      if (!fs.existsSync(keep)) fs.writeFileSync(keep, '');
    } catch (e) {
      console.warn('[PartnerOnboarding] uploads dir ensure warning:', e.message);
    }

    // Align old resellers: backfill onboarding rows for existing resellers (idempotent, once)
    try {
      const cntRes = await pool.query("SELECT count(*)::int as c FROM partner_onboardings");
      if (cntRes.rows[0].c === 0) {
        const resellers = await pool.query("SELECT id, user_id, reseller_name, company_name, pop_location, contact_no, partner_type, joining_date, created_at, latitude, longitude, iig_bw, bdix_bw, ggc_bw, fna_bw, cdn_bw, bcdn_bw, nttn_capacity FROM resellers ORDER BY id");
        if (resellers.rows.length > 0) {
          console.log(`[PartnerOnboarding] Aligning: backfilling ${resellers.rows.length} existing resellers into onboarding ...`);
          for (const r of resellers.rows) {
            const exists = await pool.query("SELECT 1 FROM partner_onboardings WHERE reseller_id=$1 LIMIT 1", [r.id]);
            if (exists.rows.length) continue;
            const raw = String(r.partner_type || 'distribution_partner').toLowerCase();
            let pt = 'distribution';
            if (raw.includes('mac')) pt = 'mac';
            else if (raw.includes('channel') || raw.includes('chanel')) pt = 'channel';
            const ref = `SN-PO-MIG-${String(r.id).padStart(4,'0')}-${Math.floor(100+Math.random()*900)}`;
            const partnerName = r.reseller_name || r.company_name || `Partner ${r.id}`;
            const od = r.joining_date ? new Date(r.joining_date).toISOString().slice(0,10) : (r.created_at ? new Date(r.created_at).toISOString().slice(0,10) : new Date().toISOString().slice(0,10));
            const formData = {
              partnerName: partnerName,
              partnerUserId: r.user_id || String(r.id),
              partnerType: pt,
              contactNumber: r.contact_no || '',
              address: r.pop_location || '',
              onboardingDate: od.split('-').reverse().join('/'),
              latitude: r.latitude || '',
              longitude: r.longitude || '',
              distIig: String(r.iig_bw || ''),
              distBdix: String(r.bdix_bw || ''),
              distGgc: String(r.ggc_bw || ''),
              distFna: String(r.fna_bw || ''),
              distCdn: String(r.cdn_bw || ''),
              distNttn: String(r.nttn_capacity || ''),
              migrated: true,
              migrated_from_reseller_id: r.id
            };
            await pool.query(
              `INSERT INTO partner_onboardings (ref_number, status, reseller_id, reseller_code, partner_name, partner_type, contact_number, address, onboarding_date, latitude, longitude, form_data, submitted_by, created_at, updated_at)
               VALUES ($1,'converted',$2,$3,$4,$5,$6,$7,$8::date,$9,$10,$11::jsonb,1,NOW(),NOW())
               ON CONFLICT (ref_number) DO NOTHING`,
              [ref, r.id, r.user_id, partnerName, pt, r.contact_no, r.pop_location, od, r.latitude || null, r.longitude || null, JSON.stringify(formData)]
            );
            const inserted = await pool.query("SELECT id FROM partner_onboardings WHERE reseller_id=$1 ORDER BY id DESC LIMIT 1", [r.id]);
            if (inserted.rows.length) {
              const oid = inserted.rows[0].id;
              const stages = ['Verified By / Onboarding Officer','Finance Verification','Technical / NOC Verification','Management Approval'];
              for (const st of stages) {
                await pool.query(
                  `INSERT INTO partner_onboarding_approvals (onboarding_id, stage, approver_name, status, sign_date)
                   VALUES ($1,$2,'Migrated','approved', CURRENT_DATE)
                   ON CONFLICT (onboarding_id, stage) DO NOTHING`,
                  [oid, st]
                );
              }
            }
          }
          console.log("[PartnerOnboarding] Align backfill done");
        }
      }
    } catch (e) {
      console.warn("[PartnerOnboarding] backfill warning:", e.message);
    }

    tablesInitialized = true;
    console.log("[PartnerOnboarding] tables ready");
  } catch (error) {
    console.error("[PartnerOnboarding] init failed:", error.message);
    console.error("[PartnerOnboarding] stack:", error.stack);
    lastInitFailedAt = Date.now();
  } finally {
    initInProgress = false;
  }
};

module.exports = { initPartnerOnboardingTables };
