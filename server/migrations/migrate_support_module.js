require('../config/env');
const pool = require('../utilities/db');

async function migrate() {
  console.log('Running support module migrations...');
  
  await pool.query(`
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS office_name VARCHAR(100) DEFAULT 'Corporate Office';
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS connection_type VARCHAR(50) DEFAULT 'Fiber';
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS complaint_no VARCHAR(100);
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS zone VARCHAR(100);
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS subzone VARCHAR(100);
    ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS box_area VARCHAR(100);
    CREATE INDEX IF NOT EXISTS idx_support_tickets_office ON support_tickets (office_name);
    UPDATE support_tickets SET office_name = 'Corporate Office' WHERE office_name IS NULL OR TRIM(office_name) = '';
    -- Normalize legacy Head Office aliases to canonical Corporate Office
    UPDATE support_tickets SET office_name = 'Corporate Office' WHERE LOWER(TRIM(office_name)) IN ('head office','khulna head office','head office (corporate office)');
    UPDATE support_tickets SET office_name = 'Shonadanga Office' WHERE LOWER(TRIM(office_name)) IN ('sonadanga office','sonadanga branch','shonadanga branch');
    UPDATE support_tickets SET zone = office_name WHERE zone IS NULL OR TRIM(zone) = '';
    -- Keep complaint_no separate; ticket_no is the system-generated identifier.

    CREATE TABLE IF NOT EXISTS support_verifications (
      id SERIAL PRIMARY KEY,
      ticket_id INT UNIQUE REFERENCES support_tickets(id) ON DELETE CASCADE,
      q1_technical BOOLEAN DEFAULT true,
      q2_media BOOLEAN DEFAULT true,
      q3_customercare BOOLEAN DEFAULT true,
      q4_payment BOOLEAN DEFAULT true,
      q5_service_satisfaction BOOLEAN DEFAULT true,
      q6_time_satisfaction BOOLEAN DEFAULT true,
      q7_technician_behavior BOOLEAN DEFAULT true,
      feedback_remarks TEXT,
      verified_by INT,
      is_verified BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS support_verification_revisions (
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
    );
    CREATE INDEX IF NOT EXISTS idx_support_verification_revisions_ticket ON support_verification_revisions (ticket_id, archived_at DESC);
    ALTER TABLE support_verifications ADD COLUMN IF NOT EXISTS answers JSONB;
    ALTER TABLE support_verification_revisions ADD COLUMN IF NOT EXISTS answers JSONB;

    CREATE TABLE IF NOT EXISTS support_verification_call_attempts (
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
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_support_verification_attempt_active_ticket
      ON support_verification_call_attempts (ticket_id) WHERE outcome = 'in_progress';
    CREATE INDEX IF NOT EXISTS idx_support_verification_attempts_ticket_started
      ON support_verification_call_attempts (ticket_id, started_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_support_verification_attempts_caller_started
      ON support_verification_call_attempts (caller_id, started_at DESC);
    ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS caller_name_snapshot VARCHAR(255);
    ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS caller_employee_id_snapshot VARCHAR(100);
    ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS caller_office_snapshot VARCHAR(100);
    ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS office_name_snapshot VARCHAR(100);
    ALTER TABLE support_verification_call_attempts ADD COLUMN IF NOT EXISTS zone_snapshot VARCHAR(100);
    INSERT INTO sidebar_menus (menu_name, link, icon, permission_column, category, sort_order, parent_id, is_visible)
    SELECT 'Verification Calls', '/support/verification', 'fa-phone-volume', 'p_support_view', 'Internet', 54, NULL, 1
    WHERE NOT EXISTS (SELECT 1 FROM sidebar_menus WHERE link = '/support/verification');

    CREATE TABLE IF NOT EXISTS sms_templates (
      id SERIAL PRIMARY KEY,
      template_name VARCHAR(255) NOT NULL,
      template_type VARCHAR(50) DEFAULT 'Custom',
      message_body TEXT NOT NULL,
      created_by INT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    ALTER TABLE sms_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

    CREATE TABLE IF NOT EXISTS sms_logs (
      id SERIAL PRIMARY KEY,
      recipient_phone VARCHAR(50) NOT NULL,
      message_body TEXT NOT NULL,
      status VARCHAR(50) DEFAULT 'Sent',
      sent_by INT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);

  console.log('Migration completed successfully!');
}

migrate()
  .catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
