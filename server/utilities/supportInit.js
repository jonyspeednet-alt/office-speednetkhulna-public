const pool = require('./db');

let initialized = false;
let initializing = false;

const initSupportTables = async () => {
  if (initialized || initializing) return;
  initializing = true;
  try {
    const statements = [
      `CREATE TABLE IF NOT EXISTS network_customers (
        id BIGSERIAL PRIMARY KEY,
        router_id TEXT NOT NULL,
        pppoe_username TEXT NOT NULL,
        package_profile TEXT NULL,
        service TEXT NULL,
        remote_address TEXT NULL,
        disabled BOOLEAN NOT NULL DEFAULT FALSE,
        is_online BOOLEAN NOT NULL DEFAULT FALSE,
        comment_raw TEXT NULL,
        phone TEXT NULL,
        alternate_phones JSONB NOT NULL DEFAULT '[]'::jsonb,
        address TEXT NULL,
        parse_status VARCHAR(30) NOT NULL DEFAULT 'no_phone',
        parse_confidence VARCHAR(20) NOT NULL DEFAULT 'low',
        manual_phone TEXT NULL,
        manual_address TEXT NULL,
        last_synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(router_id, pppoe_username)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_network_customers_search ON network_customers (pppoe_username)`,
      `CREATE INDEX IF NOT EXISTS idx_network_customers_phone ON network_customers (phone)`,
      `ALTER TABLE network_customers ADD COLUMN IF NOT EXISTS vlan_id TEXT NULL`,
      `ALTER TABLE network_customers ADD COLUMN IF NOT EXISTS vlan_name TEXT NULL`,
      `ALTER TABLE network_customers ADD COLUMN IF NOT EXISTS session_service TEXT NULL`,
      `CREATE TABLE IF NOT EXISTS mikrotik_sync_runs (
        id BIGSERIAL PRIMARY KEY,
        router_id TEXT NOT NULL,
        status VARCHAR(20) NOT NULL,
        records_seen INTEGER NOT NULL DEFAULT 0,
        records_synced INTEGER NOT NULL DEFAULT 0,
        error_message TEXT NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ NULL
      )`,
      `CREATE TABLE IF NOT EXISTS mikrotik_routers (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'api' CHECK (protocol IN ('api','rest')),
        host TEXT NULL,
        base_url TEXT NULL,
        port INTEGER NULL,
        username TEXT NOT NULL,
        password_enc TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_synced_at TIMESTAMPTZ NULL,
        last_sync_status VARCHAR(20) NULL,
        last_error TEXT NULL,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK ((protocol = 'api' AND host IS NOT NULL) OR (protocol = 'rest' AND base_url IS NOT NULL))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_mikrotik_routers_active ON mikrotik_routers (is_active) WHERE is_active = TRUE`,
      `CREATE TABLE IF NOT EXISTS support_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        name_bn TEXT NOT NULL,
        default_priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS support_tickets (
        id BIGSERIAL PRIMARY KEY,
        ticket_no TEXT NOT NULL UNIQUE,
        customer_id BIGINT NULL REFERENCES network_customers(id),
        customer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
        category_id INTEGER NULL REFERENCES support_categories(id),
        subject TEXT NOT NULL,
        description TEXT NULL,
        source VARCHAR(30) NOT NULL DEFAULT 'phone',
        status VARCHAR(30) NOT NULL DEFAULT 'new',
        priority VARCHAR(20) NOT NULL DEFAULT 'medium',
        assigned_to INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        office_name VARCHAR(100) NOT NULL DEFAULT 'Corporate Office',
        connection_type VARCHAR(50) NOT NULL DEFAULT 'Fiber',
        complaint_no VARCHAR(100) NULL,
        zone VARCHAR(100) NULL,
        subzone VARCHAR(100) NULL,
        box_area VARCHAR(100) NULL,
        opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        first_response_at TIMESTAMPTZ NULL,
        due_at TIMESTAMPTZ NULL,
        resolved_at TIMESTAMPTZ NULL,
        closed_at TIMESTAMPTZ NULL,
        resolution_note TEXT NULL,
        reopen_count INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (status IN ('new','assigned','in_progress','waiting_customer','waiting_vendor','resolved','verification_pending','closed','reopened','cancelled')),
        CHECK (priority IN ('critical','high','medium','low'))
      )`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS office_name VARCHAR(100) NOT NULL DEFAULT 'Corporate Office'`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS connection_type VARCHAR(50) NOT NULL DEFAULT 'Fiber'`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS connection_subtype VARCHAR(30) NULL`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS complaint_no VARCHAR(100)`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS zone VARCHAR(100)`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS subzone VARCHAR(100)`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS box_area VARCHAR(100)`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS additional_technician_ids JSONB NOT NULL DEFAULT '[]'::jsonb`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS is_qc_support BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS is_on_call BOOLEAN NOT NULL DEFAULT FALSE`,
      `ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_type VARCHAR(30) NULL`,
      `CREATE INDEX IF NOT EXISTS idx_support_tickets_status_created ON support_tickets (status, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_support_tickets_customer ON support_tickets (customer_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_support_tickets_office ON support_tickets (office_name)`,
      `CREATE INDEX IF NOT EXISTS idx_support_tickets_is_on_call ON support_tickets (is_on_call) WHERE is_on_call = TRUE`,
      `CREATE TABLE IF NOT EXISTS support_ticket_events (
        id BIGSERIAL PRIMARY KEY,
        ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        event_type VARCHAR(40) NOT NULL,
        message TEXT NULL,
        old_status VARCHAR(30) NULL,
        new_status VARCHAR(30) NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_support_ticket_events_ticket ON support_ticket_events (ticket_id, created_at ASC)`,
      `CREATE INDEX IF NOT EXISTS idx_support_ticket_events_call_handoff_time ON support_ticket_events (created_at DESC) WHERE event_type = 'call_handoff'`,
      `CREATE TABLE IF NOT EXISTS support_3cx_calls (
        id BIGSERIAL PRIMARY KEY,
        call_id TEXT NOT NULL,
        history_id TEXT NOT NULL,
        ticket_id BIGINT NULL REFERENCES support_tickets(id) ON DELETE SET NULL,
        ticket_event_id BIGINT NULL REFERENCES support_ticket_events(id) ON DELETE SET NULL,
        portal_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        extension TEXT NULL,
        caller_number TEXT NULL,
        callee_number TEXT NULL,
        dialed_number TEXT NULL,
        duration_seconds INTEGER NULL CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
        started_at TIMESTAMPTZ NOT NULL,
        answered_at TIMESTAMPTZ NULL,
        ended_at TIMESTAMPTZ NULL,
        termination_reason TEXT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (call_id, history_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_support_3cx_calls_ticket_started ON support_3cx_calls (ticket_id, started_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_support_3cx_calls_user_started ON support_3cx_calls (portal_user_id, started_at DESC)`,
      `CREATE TABLE IF NOT EXISTS support_verifications (
        id SERIAL PRIMARY KEY,
        ticket_id BIGINT UNIQUE REFERENCES support_tickets(id) ON DELETE CASCADE,
        q1_technical BOOLEAN DEFAULT true,
        q2_media BOOLEAN DEFAULT true,
        q3_customercare BOOLEAN DEFAULT true,
        q4_payment BOOLEAN DEFAULT true,
        q5_service_satisfaction BOOLEAN DEFAULT true,
        q6_time_satisfaction BOOLEAN DEFAULT true,
        q7_technician_behavior BOOLEAN DEFAULT true,
        feedback_remarks TEXT,
        verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_verified BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS support_verification_revisions (
        id BIGSERIAL PRIMARY KEY,
        ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        q1_technical BOOLEAN,
        q2_media BOOLEAN,
        q3_customercare BOOLEAN,
        q4_payment BOOLEAN,
        q5_service_satisfaction BOOLEAN,
        q6_time_satisfaction BOOLEAN,
        q7_technician_behavior BOOLEAN,
        feedback_remarks TEXT,
        verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        verified_at TIMESTAMPTZ,
        revised_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_support_verification_revisions_ticket ON support_verification_revisions (ticket_id, archived_at DESC)`,
      `ALTER TABLE support_verifications ADD COLUMN IF NOT EXISTS answers JSONB`,
      `ALTER TABLE support_verification_revisions ADD COLUMN IF NOT EXISTS answers JSONB`,
      `CREATE TABLE IF NOT EXISTS support_verification_call_attempts (
        id BIGSERIAL PRIMARY KEY,
        ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        caller_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        source VARCHAR(20) NOT NULL DEFAULT 'queue' CHECK (source IN ('queue', 'direct')),
        outcome VARCHAR(30) NOT NULL DEFAULT 'in_progress'
          CHECK (outcome IN ('in_progress', 'completed', 'no_answer', 'busy', 'callback_requested', 'wrong_number', 'incomplete', 'abandoned')),
        note VARCHAR(1000) NULL,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ended_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK ((outcome = 'in_progress' AND ended_at IS NULL) OR (outcome <> 'in_progress' AND ended_at IS NOT NULL))
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_support_verification_attempt_active_ticket
        ON support_verification_call_attempts (ticket_id) WHERE outcome = 'in_progress'`,
      `CREATE INDEX IF NOT EXISTS idx_support_verification_attempts_ticket_started
        ON support_verification_call_attempts (ticket_id, started_at DESC, id DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_support_verification_attempts_caller_started
        ON support_verification_call_attempts (caller_id, started_at DESC)`,
      `ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS caller_name_snapshot VARCHAR(255)`,
      `ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS caller_employee_id_snapshot VARCHAR(100)`,
      `ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS caller_office_snapshot VARCHAR(100)`,
      `ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS office_name_snapshot VARCHAR(100)`,
      `ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS zone_snapshot VARCHAR(100)`,
      `INSERT INTO sidebar_menus (menu_name, link, icon, permission_column, category, sort_order, parent_id, is_visible)
        SELECT 'Verification Calls', '/support/verification', 'fa-phone-volume', 'p_support_view', 'Internet', 54, NULL, 1
        WHERE NOT EXISTS (SELECT 1 FROM sidebar_menus WHERE link = '/support/verification')`,
      `ALTER TABLE support_verifications ALTER COLUMN ticket_id TYPE BIGINT USING ticket_id::bigint` ,
      `CREATE TABLE IF NOT EXISTS sms_templates (
        id SERIAL PRIMARY KEY,
        template_name VARCHAR(255) NOT NULL,
        template_type VARCHAR(50) DEFAULT 'Custom',
        message_body TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `ALTER TABLE sms_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
      `DELETE FROM sms_templates a USING sms_templates b WHERE a.id > b.id AND a.template_name = b.template_name`,
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_templates_name ON sms_templates (template_name)`,
      `CREATE TABLE IF NOT EXISTS sms_logs (
        id SERIAL PRIMARY KEY,
        recipient_phone VARCHAR(50) NOT NULL,
        message_body TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Sent',
        sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `ALTER TABLE sms_logs ALTER COLUMN status TYPE TEXT`,
      `CREATE TABLE IF NOT EXISTS sms_rate_counters (
        user_id TEXT PRIMARY KEY,
        hour_window TEXT,
        hour_count INT NOT NULL DEFAULT 0,
        day_window TEXT,
        day_count INT NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS support_ticket_comments (
        id BIGSERIAL PRIMARY KEY,
        ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        customer_id BIGINT REFERENCES network_customers(id) ON DELETE SET NULL,
        comment TEXT NOT NULL,
        is_internal BOOLEAN NOT NULL DEFAULT false,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS ticket_attachments (
        id BIGSERIAL PRIMARY KEY,
        ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER NULL,
        mime_type VARCHAR(50) NULL,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS device_tokens (
        id BIGSERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fcm_token TEXT NOT NULL UNIQUE,
        platform VARCHAR(20) NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket ON ticket_attachments (ticket_id, created_at ASC)`,
      `CREATE TABLE IF NOT EXISTS ticket_work_reports (
        id BIGSERIAL PRIMARY KEY,
        ticket_id BIGINT NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        author_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        work_done TEXT NOT NULL,
        materials_used TEXT NULL,
        time_spent_minutes INTEGER NULL CHECK (time_spent_minutes IS NULL OR time_spent_minutes >= 0),
        status VARCHAR(20) NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','rejected')),
        reviewer_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
        review_note TEXT NULL,
        reviewed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ticket_work_reports_ticket ON ticket_work_reports (ticket_id, created_at ASC)`,
      `ALTER TABLE ticket_attachments ADD COLUMN IF NOT EXISTS report_id BIGINT NULL REFERENCES ticket_work_reports(id) ON DELETE SET NULL`,
      `CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_ticket ON support_ticket_comments (ticket_id, created_at ASC)`,
      `CREATE INDEX IF NOT EXISTS idx_support_ticket_comments_customer ON support_ticket_comments (customer_id, created_at DESC)`,
      `INSERT INTO support_categories (name, name_bn, default_priority, sort_order) VALUES
        ('camera_problem', 'Camera Problem', 'medium', 10),
        ('dhcp_connection', 'DHCP Connection', 'medium', 15),
        ('line_open', 'Line open', 'high', 20),
        ('new_connection', 'New Connection', 'medium', 25),
        ('no_connection', 'No Connection', 'high', 30),
        ('onu_loss', 'ONU LOSS', 'high', 35),
        ('pon_blink_db_high', 'PON Blink / DB High Issue', 'high', 40),
        ('frequently_disconnect', 'Frequently Disconnect', 'medium', 45),
        ('others', 'Others', 'low', 50),
        ('pc_connect', 'PC Connect', 'medium', 55),
        ('re_connect', 'Re-Connect', 'medium', 60),
        ('qc_support', 'QC Support', 'medium', 65),
        ('password_change', 'Password Change', 'low', 70),
        ('router_configure', 'Router Configure', 'medium', 75),
        ('shifting_connection', 'Shifting Connection', 'low', 80),
        ('tv_issue', 'TV issue', 'medium', 85),
        ('slow_connection', 'Slow Connection', 'medium', 90),
        ('on_call_support', 'On Call Support', 'medium', 95)
       ON CONFLICT (name) DO NOTHING`,
      `UPDATE support_categories SET is_active=false WHERE name IN ('internet_down','slow_speed','router_onu','billing','relocation','other')`
    ];
    for (const statement of statements) await pool.query(statement);
    await ensureCoreRoles();
    await ensureTechnicianRole();
    await ensureSystemSmsTemplates();
    await backfillRoleLinks();
    initialized = true;
    console.log('[Support] tables ready');
  } catch (error) {
    console.error('[Support] schema initialization failed:', error.message);
  } finally {
    initializing = false;
  }
};

// System auto-SMS formats (editable from SMS Portal; never overwritten).
// Placeholders: {ticket_no} {subject} {status} {priority} {pppoe} {phone} {olt} {vlan} {address} {description} {zone}
const SYSTEM_SMS_SEEDS = [
  ['ticket_created_customer', 'System', 'Your support ticket {ticket_no} created. SpeedNet will contact you soon.'],
  ['ticket_assigned_technician', 'System', 'SpeedNet New Ticket {ticket_no} [{priority}]\nPPPoE:{pppoe} Mob:{phone}\nOLT:{olt}\nAddr:{address}\nIssue:{subject}\nNote:{description}\nPlz call customer & update portal.'],
  ['ticket_status_customer', 'System', 'Your support ticket {ticket_no} is now {status}. SpeedNet - Thank you.'],
];
const ensureSystemSmsTemplates = async () => {
  try {
    for (const [name, type, body] of SYSTEM_SMS_SEEDS) {
      await pool.query(
        `INSERT INTO sms_templates (template_name, template_type, message_body) VALUES ($1, $2, $3) ON CONFLICT (template_name) DO NOTHING`,
        [name, type, body]
      );
    }
  } catch (error) {
    console.error('[Support] system SMS seed failed:', error.message);
  }
};

// Core role seed: Staff/HR/Manager/Admin rows must exist so employee
// create/update (which resolves role_id by name) never 400s "Unknown role"
// on a fresh DB. Insert-only — never overwrites admin customizations.
// role_id-linked users get ONLY their role's permissions (no legacy
// defaults), so seeds preserve legacy behavior:
// - Staff/Manager: self-service base (same as legacy defaults).
// - HR: staff base + p_office_work (legacy HR had the office-work
//   performance name-bypass in officeWorkController; the real perm keeps
//   it working after linking). can_take_action for HR is unified in
//   employeeController (add + update both grant).
// - Admin: all_access + every menu permission (same as legacy admin
//   defaults). Grant extra powers via Manage Permissions afterwards.
const ensureCoreRoles = async () => {
  try {
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_roles_lower_name ON roles (LOWER(name))`
    ).catch(() => {});
    const staffBase = { p_apply_leave: true, p_my_leaves: true };
    const hrPerms = { ...staffBase, p_office_work: true };
    const full = { all_access: true };
    try {
      const { ALL_MENU_PERMISSIONS } = require('./permissionRegistry');
      for (const key of ALL_MENU_PERMISSIONS) full[key] = true;
    } catch (_) { /* registry unavailable: all_access flag alone */ }
    const seeds = [
      ['Staff', staffBase],
      ['HR', hrPerms],
      ['Manager', staffBase],
      ['Admin', full],
    ];
    for (const [name, perms] of seeds) {
      const existing = await pool.query(
        `SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]
      );
      let roleId = existing.rows[0]?.id;
      if (!roleId) {
        const created = await pool.query(
          `INSERT INTO roles (name, permissions) VALUES ($1, $2)
           ON CONFLICT DO NOTHING RETURNING id`,
          [name, JSON.stringify(perms)]
        ).catch(() => ({ rows: [] }));
        roleId = created.rows[0]?.id;
        if (!roleId) {
          const again = await pool.query(
            `SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]
          );
          roleId = again.rows[0]?.id;
        }
        if (roleId) console.log(`[Roles] ${name} role created`);
      }
      if (!roleId) continue;
      await pool.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         SELECT $1, p.id FROM jsonb_each($2::jsonb) AS kv(key, value)
         JOIN permissions p ON p.legacy_key = kv.key
         WHERE kv.value IN ('true'::jsonb, '1'::jsonb, '"1"'::jsonb)
         AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = $1 AND rp.permission_id = p.id)`,
        [roleId, JSON.stringify(perms)]
      ).catch(() => {});
    }
  } catch (error) {
    console.error('[Roles] core role seed skipped:', error.message);
  }
};

// One-time healing: link legacy text-only users (role_id IS NULL) to their
// roles-table row when the trimmed name matches, and canonicalize stale
// role text on already-linked rows. Decided fate of the legacy exception:
// - Privileged names (admin / super admin) are EXCLUDED and stay legacy
//   NULL — their all_access comes from hardcoded defaults, and linking
//   them would risk a privilege loss if the permissions catalog ever
//   lacks the all_access entry. Zero behavior change for them.
// - Everything else (Staff/HR/Manager/custom like Noc Executive) links to
//   the lowest-id row of that name. HR keeps its office-work access via
//   the seeded p_office_work perm; Manager/Staff behavior is identical.
// Idempotent — already-linked rows are untouched.
const backfillRoleLinks = async () => {
  try {
    const linked = await pool.query(
      `UPDATE users u SET role_id = m.id, role = m.name
       FROM (SELECT DISTINCT ON (LOWER(name)) LOWER(name) AS k, id, name
             FROM roles ORDER BY LOWER(name), id) m
       WHERE u.role_id IS NULL
         AND LOWER(TRIM(u.role)) = m.k
         AND LOWER(TRIM(u.role)) NOT IN ('admin', 'super admin', 'superadmin')`
    ).catch(() => ({ rowCount: 0 }));
    const canon = await pool.query(
      `UPDATE users u SET role = r.name
       FROM roles r WHERE u.role_id = r.id AND u.role IS DISTINCT FROM r.name`
    ).catch(() => ({ rowCount: 0 }));
    const n1 = Number(linked?.rowCount || 0);
    const n2 = Number(canon?.rowCount || 0);
    if (n1 || n2) console.log(`[Roles] backfill: linked ${n1}, canonicalized ${n2}`);
  } catch (error) {
    console.error('[Roles] backfill skipped:', error.message);
  }
};

// Field-technician role for the mobile app: ticket view + update only
// (no assign/create/mikrotik). Insert-only — never overwrites an existing
// role of the same name, so admin customizations survive restarts.
// Runs in its own try/catch so a missing roles table (older DB) can never
// break support-table initialization.
const ensureTechnicianRole = async () => {
  try {
    const existing = await pool.query(
      `SELECT id FROM roles WHERE LOWER(name) = 'technician' LIMIT 1`
    );
    let roleId = existing.rows[0]?.id;
    if (!roleId) {
      const created = await pool.query(
        `INSERT INTO roles (name, permissions) VALUES ('Technician', $1) RETURNING id`,
        [JSON.stringify({ p_support_view: true, p_support_update: true })]
      );
      roleId = created.rows[0].id;
      console.log('[Support] Technician role created');
    }
    // Keep RBAC v2 normalized table in sync (same logic as roleController
    // syncRolePermissions; unknown catalog keys are silently skipped).
    await pool.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, p.id FROM jsonb_each($2::jsonb) AS kv(key, value)
       JOIN permissions p ON p.legacy_key = kv.key
       WHERE kv.value IN ('true'::jsonb, '1'::jsonb, '"1"'::jsonb)
       AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = $1 AND rp.permission_id = p.id)`,
      [roleId, JSON.stringify({ p_support_view: true, p_support_update: true })]
    );
  } catch (error) {
    console.error('[Support] technician role seed skipped:', error.message);
  }
};

module.exports = { initSupportTables };
