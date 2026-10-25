const pool = require("./db");

let tablesInitialized = false;
let initInProgress = false;
let lastInitFailedAt = 0;
const INIT_COOLDOWN_MS = 60_000; // Don't retry DDL for 60s after a failure

const initChannelPartnerTables = async () => {
  if (tablesInitialized) return;
  if (initInProgress) return; // already running — don't stack
  if (Date.now() - lastInitFailedAt < INIT_COOLDOWN_MS) return; // cooldown
  initInProgress = true;
  try {
    const runQuery = async (sql, params = []) => {
      try {
        await pool.query(sql, params);
      } catch (error) {
        if (
          error?.code === "42501" ||
          String(error?.message || "")
            .toLowerCase()
            .includes("must be owner")
        ) {
          console.warn(
            `[ChannelPartner] DDL skipped (insufficient privilege): ${sql.substring(0, 50)}...`,
          );
          return;
        }
        // Log the error but don't throw for table creation issues
        console.error(`[ChannelPartner] DDL error: ${error.message}`);
        console.error(
          `[ChannelPartner] Failed SQL: ${sql.substring(0, 100)}...`,
        );
        throw error;
      }
    };

    await runQuery(`
      ALTER TABLE resellers
        ADD COLUMN IF NOT EXISTS profit_share_percentage NUMERIC(5,2) DEFAULT 0
    `);

    await runQuery(`
      ALTER TABLE resellers
        ADD COLUMN IF NOT EXISTS channel_user_count INTEGER DEFAULT 0
    `);

    await runQuery(`
      ALTER TABLE resellers
        ADD COLUMN IF NOT EXISTS maxim_suffix VARCHAR(60) DEFAULT ''
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_partner_users (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        user_name VARCHAR(255) NOT NULL,
        user_id_code VARCHAR(100) DEFAULT '',
        phone VARCHAR(30) DEFAULT '',
        package_name VARCHAR(100) DEFAULT '',
        monthly_rate NUMERIC(10,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_cpu_reseller_id ON channel_partner_users (reseller_id)",
    );
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_cpu_status ON channel_partner_users (status)",
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_user_payments (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        user_id INT NOT NULL,
        month VARCHAR(7) NOT NULL,
        amount_due NUMERIC(10,2) DEFAULT 0,
        amount_paid NUMERIC(10,2) DEFAULT 0,
        payment_date DATE,
        payment_status VARCHAR(20) DEFAULT 'unpaid',
        note TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_cup_reseller_month ON channel_user_payments (reseller_id, month)",
    );
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_cup_user_month ON channel_user_payments (user_id, month)",
    );
    await runQuery(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_cup_unique_user_month ON channel_user_payments (user_id, month)",
    );
    await runQuery(
      `ALTER TABLE channel_user_payments ADD COLUMN IF NOT EXISTS service_period DATE`,
    );
    await runQuery(
      `UPDATE channel_user_payments SET service_period = (month || '-01')::date WHERE service_period IS NULL AND month IS NOT NULL`,
    );
    await runQuery(
      `ALTER TABLE channel_user_payments ADD COLUMN IF NOT EXISTS bill_issued_date TIMESTAMP`,
    );
    await runQuery(
      `ALTER TABLE channel_user_payments ADD COLUMN IF NOT EXISTS billing_status VARCHAR(30) DEFAULT 'deferred'`,
    );
    await runQuery(
      `ALTER TABLE channel_user_payments ADD COLUMN IF NOT EXISTS realized_amount NUMERIC(12,2) DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE channel_user_payments ADD COLUMN IF NOT EXISTS deferred_amount NUMERIC(12,2) DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE channel_user_payments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL`,
    );
    await runQuery(
      `CREATE INDEX IF NOT EXISTS idx_cup_service_period ON channel_user_payments (reseller_id, service_period)`,
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_partner_advances (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        user_id INT NULL,
        advance_month DATE NOT NULL,
        advance_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        advance_type VARCHAR(40) NOT NULL DEFAULT 'direct_payment',
        settlement_status VARCHAR(40) NOT NULL DEFAULT 'pending_adjustment',
        notes TEXT NULL,
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        resolved_by INT NULL,
        resolved_at TIMESTAMP NULL
      )
    `);
    await runQuery(
      `CREATE INDEX IF NOT EXISTS idx_cpa_reseller_month ON channel_partner_advances (reseller_id, advance_month)`,
    );
    await runQuery(
      `CREATE INDEX IF NOT EXISTS idx_cpa_status ON channel_partner_advances (settlement_status)`,
    );
    await runQuery(
      `ALTER TABLE channel_partner_advances ADD COLUMN IF NOT EXISTS resolved_by INT NULL`,
    );
    await runQuery(
      `ALTER TABLE channel_partner_advances ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NULL`,
    );
    await runQuery(
      `ALTER TABLE channel_partner_advances ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_adjustment_audit (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        adjustment_month DATE NOT NULL,
        adjustment_type VARCHAR(50) NOT NULL,
        adjustment_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        reason TEXT NULL,
        created_by INT NULL,
        related_user_id INT NULL,
        related_payment_id INT NULL,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await runQuery(
      `CREATE INDEX IF NOT EXISTS idx_channel_adjustment_audit_reseller_month ON channel_adjustment_audit (reseller_id, adjustment_month)`,
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_settlement_state_machine (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        settlement_month DATE NOT NULL,
        current_state VARCHAR(40) NOT NULL DEFAULT 'draft',
        locked_at TIMESTAMP NULL,
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(reseller_id, settlement_month)
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS billing_reconciliation_logs (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        reconciliation_month DATE NOT NULL,
        total_collected NUMERIC(12,2) NOT NULL DEFAULT 0,
        total_realized NUMERIC(12,2) NOT NULL DEFAULT 0,
        total_deferred NUMERIC(12,2) NOT NULL DEFAULT 0,
        gross_commission NUMERIC(12,2) NOT NULL DEFAULT 0,
        partner_advances NUMERIC(12,2) NOT NULL DEFAULT 0,
        net_commission NUMERIC(12,2) NOT NULL DEFAULT 0,
        reconciliation_status VARCHAR(40) NOT NULL DEFAULT 'pending',
        initiated_by INT NULL,
        approved_by INT NULL,
        approved_at TIMESTAMP NULL,
        rejection_reason TEXT NULL,
        snapshot_data JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(reseller_id, reconciliation_month)
      )
    `);
    await runQuery(
      `CREATE INDEX IF NOT EXISTS idx_brl_reseller_month ON billing_reconciliation_logs (reseller_id, reconciliation_month)`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS reconciliation_month DATE`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS total_collected NUMERIC(12,2) NOT NULL DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS total_realized NUMERIC(12,2) NOT NULL DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS total_deferred NUMERIC(12,2) NOT NULL DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS gross_commission NUMERIC(12,2) NOT NULL DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS partner_advances NUMERIC(12,2) NOT NULL DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS net_commission NUMERIC(12,2) NOT NULL DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS initiated_by INT NULL`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS approved_by INT NULL`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP NULL`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL`,
    );
    await runQuery(
      `ALTER TABLE billing_reconciliation_logs ADD COLUMN IF NOT EXISTS snapshot_data JSONB DEFAULT '{}'::jsonb`,
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_commission_logs (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        month VARCHAR(7) NOT NULL,
        total_users INT DEFAULT 0,
        paying_users INT DEFAULT 0,
        total_collection NUMERIC(12,2) DEFAULT 0,
        profit_share_pct NUMERIC(5,2) DEFAULT 0,
        gross_commission NUMERIC(12,2) DEFAULT 0,
        adjustments NUMERIC(12,2) DEFAULT 0,
        adjustment_note TEXT DEFAULT '',
        deductions NUMERIC(12,2) DEFAULT 0,
        deduction_note TEXT DEFAULT '',
        net_commission NUMERIC(12,2) DEFAULT 0,
        previous_balance NUMERIC(12,2) DEFAULT 0,
        total_payable NUMERIC(12,2) DEFAULT 0,
        paid_amount NUMERIC(12,2) DEFAULT 0,
        closing_balance NUMERIC(12,2) DEFAULT 0,
        payment_status VARCHAR(20) DEFAULT 'pending',
        status VARCHAR(20) DEFAULT 'draft',
        finalized_at TIMESTAMP,
        finalized_by INT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(reseller_id, month)
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_ccl_reseller_id ON channel_commission_logs (reseller_id)",
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_commission_payments (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        commission_log_id INT,
        amount NUMERIC(12,2) NOT NULL,
        payment_method VARCHAR(30) DEFAULT 'Cash',
        payment_date DATE NOT NULL,
        reference_no VARCHAR(100) DEFAULT '',
        note TEXT DEFAULT '',
        recorded_by INT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_ccp_reseller_id ON channel_commission_payments (reseller_id)",
    );
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_ccp_log_id ON channel_commission_payments (commission_log_id)",
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_partner_profile_settings (
        reseller_id INT PRIMARY KEY,
        profit_share_percentage NUMERIC(5,2) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_products (
        id SERIAL PRIMARY KEY,
        product_code VARCHAR(100) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(120) DEFAULT '',
        unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
        unit VARCHAR(40) DEFAULT 'pcs',
        sort_order INT DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_channel_products_active ON channel_products (is_active)",
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_user_product_usage (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        user_id INT NOT NULL,
        product_id INT NOT NULL,
        service_month DATE NOT NULL,
        quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
        unit_price_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
        line_total NUMERIC(12,2) NOT NULL DEFAULT 0,
        note TEXT DEFAULT '',
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, product_id, service_month)
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_cupu_reseller_month ON channel_user_product_usage (reseller_id, service_month)",
    );
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_cupu_user_month ON channel_user_product_usage (user_id, service_month)",
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS channel_partner_manual_product_charges (
        id SERIAL PRIMARY KEY,
        reseller_id INT NOT NULL,
        month VARCHAR(7) NOT NULL,
        amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        note TEXT DEFAULT '',
        created_by INT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(reseller_id, month)
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_cpmc_reseller_month ON channel_partner_manual_product_charges (reseller_id, month)",
    );

    // ── Maxim billing snapshots (month-partitioned by snapshot_month) ──
    // resellers.maxim_suffix (e.g. '@speednetmasum') maps a channel partner
    // to Maxim usernames. Negative balance = due (customer owes ISP).
    await runQuery(`
      CREATE TABLE IF NOT EXISTS maxim_customer_snapshots (
        snapshot_month DATE NOT NULL,
        username TEXT NOT NULL,
        cust_id VARCHAR(50) DEFAULT '',
        reseller_suffix VARCHAR(60) DEFAULT '',
        reseller_id INT NULL,
        name TEXT DEFAULT '',
        package_name VARCHAR(120) DEFAULT '',
        balance NUMERIC(12,2) DEFAULT 0,
        exp_date DATE NULL,
        last_logout TIMESTAMP NULL,
        mobile VARCHAR(30) DEFAULT '',
        status VARCHAR(30) DEFAULT '',
        pop_name VARCHAR(120) DEFAULT '',
        bill_cycle VARCHAR(40) DEFAULT '',
        raw JSONB NOT NULL DEFAULT '{}'::jsonb,
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (snapshot_month, username)
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_maxim_cust_month_suffix ON maxim_customer_snapshots (snapshot_month, reseller_suffix)",
    );
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_maxim_cust_reseller ON maxim_customer_snapshots (reseller_id, snapshot_month)",
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS maxim_payment_snapshots (
        id BIGSERIAL PRIMARY KEY,
        snapshot_month DATE NOT NULL,
        username TEXT NOT NULL,
        cust_id VARCHAR(50) DEFAULT '',
        reseller_suffix VARCHAR(60) DEFAULT '',
        reseller_id INT NULL,
        pay_date DATE NOT NULL,
        rcv_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
        total_bill NUMERIC(12,2) NOT NULL DEFAULT 0,
        pay_type VARCHAR(40) DEFAULT '',
        money_receipt VARCHAR(120) DEFAULT '',
        remarks TEXT DEFAULT '',
        received_by VARCHAR(120) DEFAULT '',
        entry_by VARCHAR(120) DEFAULT '',
        pop_name VARCHAR(120) DEFAULT '',
        fetched_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (snapshot_month, username, pay_date, rcv_amount, money_receipt)
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_maxim_pay_month_suffix ON maxim_payment_snapshots (snapshot_month, reseller_suffix)",
    );
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_maxim_pay_user_month ON maxim_payment_snapshots (username, snapshot_month)",
    );

    await runQuery(`
      CREATE TABLE IF NOT EXISTS maxim_sync_logs (
        id BIGSERIAL PRIMARY KEY,
        reseller_id INT NULL,
        reseller_suffix VARCHAR(60) DEFAULT '',
        snapshot_month DATE NOT NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'manual',
        status VARCHAR(20) NOT NULL DEFAULT 'running',
        rows_customers INT NOT NULL DEFAULT 0,
        rows_payments INT NOT NULL DEFAULT 0,
        error TEXT DEFAULT '',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        finished_at TIMESTAMPTZ NULL
      )
    `);
    await runQuery(
      "CREATE INDEX IF NOT EXISTS idx_maxim_sync_reseller_month ON maxim_sync_logs (reseller_id, snapshot_month DESC)",
    );

    await runQuery(
      `ALTER TABLE channel_commission_logs ADD COLUMN IF NOT EXISTS product_deduction NUMERIC(12,2) DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE channel_commission_logs ADD COLUMN IF NOT EXISTS partner_advances NUMERIC(12,2) DEFAULT 0`,
    );
    await runQuery(
      `ALTER TABLE channel_commission_logs ADD COLUMN IF NOT EXISTS deferred_amount NUMERIC(12,2) DEFAULT 0`,
    );

    const requiredObjects = await pool.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = 'channel_partner_profile_settings'
        ) AS has_profile_settings,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'resellers' AND column_name = 'profit_share_percentage'
        ) AS has_profit_share_column,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'resellers' AND column_name = 'channel_user_count'
        ) AS has_channel_user_count_column
    `);
    const flags = requiredObjects.rows[0] || {};
    if (!flags.has_profile_settings || !flags.has_channel_user_count_column) {
      throw new Error(
        `[ChannelPartner] required schema missing after init: ` +
          `profile_settings=${!!flags.has_profile_settings}, ` +
          `channel_user_count_column=${!!flags.has_channel_user_count_column}`,
      );
    }
    if (!flags.has_profit_share_column) {
      console.warn(
        "[ChannelPartner] optional resellers.profit_share_percentage column missing; using channel_partner_profile_settings as source of truth",
      );
    }

    tablesInitialized = true;
    console.log("[ChannelPartner] tables ready");
  } catch (error) {
    console.error("[ChannelPartner] init failed:", error.message);
    console.error("[ChannelPartner] stack:", error.stack);
    lastInitFailedAt = Date.now();
    // Don't set tablesInitialized = true on failure, so it can be retried after cooldown
  } finally {
    initInProgress = false;
  }
};

module.exports = { initChannelPartnerTables };
