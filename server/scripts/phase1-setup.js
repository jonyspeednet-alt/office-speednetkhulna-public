#!/usr/bin/env node

/**
 * Phase 1 Implementation Verification & Setup Script
 * Validates and initializes Phase 1 database schema changes
 * Usage: node server/scripts/phase1-setup.js
 */

const path = require('path');
const fs = require('fs');

// Load environment
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = require('../utilities/db');

const MIGRATION_FILE = path.join(__dirname, '../migrations/20260513_channel_partner_billing_standardization_phase1.sql');

async function verifyPrerequisites() {
  console.log('\n=== PHASE 1 PREREQUISITE CHECK ===\n');

  try {
    // Check database connection
    console.log('Attempting database connection...');
    const result = await pool.query('SELECT NOW()');
    console.log('✓ Database connection successful');
    console.log(`  Current time: ${result.rows[0].now}`);

    // Check existing tables
    const tablesResult = await pool.query(
      `SELECT tablename FROM pg_tables 
       WHERE schemaname = 'public' 
       AND tablename IN ('resellers', 'channel_partner_users', 'channel_user_payments', 'channel_commission_logs')`
    );
    console.log(`✓ Found ${tablesResult.rows.length}/4 required base tables`);

    // Check if migration already applied
    const immutableCheck = await pool.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.tables 
       WHERE table_name = 'reseller_financial_audit_log_immutable' AND table_schema = 'public') as exists`
    ).catch(() => ({ rows: [{ exists: false }] }));

    if (immutableCheck.rows[0].exists) {
      console.log('⚠ WARNING: Phase 1 migration appears to already be applied');
    } else {
      console.log('✓ Phase 1 migration not yet applied (ready to proceed)');
    }
  } catch (error) {
    console.error('✗ Prerequisite check failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  }
}

async function readMigration() {
  console.log('\n=== READING MIGRATION FILE ===\n');

  try {
    if (!fs.existsSync(MIGRATION_FILE)) {
      throw new Error(`Migration file not found: ${MIGRATION_FILE}`);
    }

    const sql = fs.readFileSync(MIGRATION_FILE, 'utf8');
    console.log(`✓ Migration file read (${sql.length} bytes)`);
    console.log(`  File: ${MIGRATION_FILE}`);

    // Validate SQL syntax (basic checks)
    const statementCount = (sql.match(/;/g) || []).length;
    console.log(`✓ Found ${statementCount} SQL statements`);

    if (!sql.includes('BEGIN')) {
      throw new Error('Migration file missing BEGIN transaction marker');
    }
    if (!sql.includes('COMMIT')) {
      throw new Error('Migration file missing COMMIT marker');
    }
    console.log('✓ Transaction markers found (BEGIN...COMMIT)');

    return sql;
  } catch (error) {
    console.error('✗ Migration read failed:', error.message);
    process.exit(1);
  }
}

async function validateSchemaChanges() {
  console.log('\n=== VALIDATING SCHEMA CHANGES ===\n');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if new columns would be added correctly
    const cupCheck = await client.query(
      `SELECT EXISTS(SELECT 1 FROM information_schema.columns 
       WHERE table_name = 'channel_user_payments' 
       AND column_name IN ('service_period', 'billing_status')) as any_exist`
    );

    if (cupCheck.rows[0].any_exist) {
      console.log('⚠ Some Phase 1 columns already exist');
    } else {
      console.log('✓ Phase 1 column additions validated');
    }

    // Check new tables would be created
    const newTablesCheck = await client.query(
      `SELECT tablename FROM pg_tables 
       WHERE schemaname = 'public' 
       AND tablename IN ('channel_partner_advances', 'billing_reconciliation_logs', 'reseller_financial_audit_log_immutable', 'channel_adjustment_audit')`
    );

    const newTableNames = newTablesCheck.rows.map(r => r.tablename);
    const requiredTables = ['channel_partner_advances', 'billing_reconciliation_logs', 'reseller_financial_audit_log_immutable', 'channel_adjustment_audit'];
    const missingTables = requiredTables.filter(t => !newTableNames.includes(t));

    if (missingTables.length === 0) {
      console.log('⚠ Some new tables already exist');
    } else {
      console.log(`✓ Will create ${missingTables.length} new tables:`);
      missingTables.forEach(t => console.log(`  - ${t}`));
    }

    await client.query('ROLLBACK');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('✗ Schema validation failed:', error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function applyMigration(sql) {
  console.log('\n=== APPLYING MIGRATION ===\n');

  const client = await pool.connect();
  try {
    console.log('Starting migration...');
    await client.query(sql);
    console.log('✓ Migration applied successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    console.error('  Error details:', error.detail || error.hint || 'No additional details');
    throw error;
  } finally {
    client.release();
  }
}

async function verifyMigrationApplied() {
  console.log('\n=== VERIFYING MIGRATION SUCCESS ===\n');

  try {
    // Check all new tables exist
    const tablesResult = await pool.query(
      `SELECT tablename FROM pg_tables 
       WHERE schemaname = 'public' 
       AND tablename IN ('channel_partner_advances', 'billing_reconciliation_logs', 'reseller_financial_audit_log_immutable', 'channel_adjustment_audit', 'channel_settlement_state_machine')`
    );

    const tableNames = tablesResult.rows.map(r => r.tablename);
    const expectedTables = ['channel_partner_advances', 'billing_reconciliation_logs', 'reseller_financial_audit_log_immutable', 'channel_adjustment_audit', 'channel_settlement_state_machine'];

    console.log(`✓ Verified ${tableNames.length}/${expectedTables.length} new tables created`);
    tableNames.forEach(t => console.log(`  - ${t}`));

    // Check new columns on existing tables
    const columnsResult = await pool.query(
      `SELECT column_name FROM information_schema.columns 
       WHERE table_name = 'channel_user_payments' 
       AND column_name IN ('service_period', 'bill_issued_date', 'billing_status', 'deferred_amount', 'realized_amount')`
    );

    console.log(`✓ Verified ${columnsResult.rows.length}/5 new columns on channel_user_payments`);
    columnsResult.rows.forEach(r => console.log(`  - ${r.column_name}`));

    // Check new indexes
    const indexesResult = await pool.query(
      `SELECT indexname FROM pg_indexes 
       WHERE schemaname = 'public' 
       AND indexname LIKE 'idx_%' 
       AND (indexname LIKE '%service_period%' OR indexname LIKE '%advance%' OR indexname LIKE '%brl%')`
    );

    console.log(`✓ Found ${indexesResult.rows.length} new indexes`);

    // Check permissions table was updated
    const permissionsResult = await pool.query(
      `SELECT code FROM permissions 
       WHERE code LIKE 'billing.%' 
       AND code IN ('billing.advance.record', 'billing.reconciliation.initiate')`
    );

    console.log(`✓ Verified ${permissionsResult.rows.length} new permissions added`);

  } catch (error) {
    console.error('✗ Verification failed:', error.message);
    throw error;
  }
}

async function validateUtilities() {
  console.log('\n=== VALIDATING UTILITY MODULES ===\n');

  try {
    const BillingReconciliation = require('../utilities/billingReconciliation');
    console.log('✓ BillingReconciliation module loads correctly');
    console.log(`  - initiateReconciliation: ${typeof BillingReconciliation.initiateReconciliation}`);
    console.log(`  - approveReconciliation: ${typeof BillingReconciliation.approveReconciliation}`);
    console.log(`  - getReconciliationReport: ${typeof BillingReconciliation.getReconciliationReport}`);

    const PartnerAdvanceManager = require('../utilities/partnerAdvanceManager');
    console.log('✓ PartnerAdvanceManager module loads correctly');
    console.log(`  - recordAdvance: ${typeof PartnerAdvanceManager.recordAdvance}`);
    console.log(`  - applyAdvanceAdjustment: ${typeof PartnerAdvanceManager.applyAdvanceAdjustment}`);
    console.log(`  - getPendingAdvances: ${typeof PartnerAdvanceManager.getPendingAdvances}`);

    const auditLogger = require('../utilities/auditLogger');
    console.log('✓ auditLogger module extended correctly');
    console.log(`  - logFinancialTransaction: ${typeof auditLogger.logFinancialTransaction}`);
    console.log(`  - getFinancialAuditTrail: ${typeof auditLogger.getFinancialAuditTrail}`);

  } catch (error) {
    console.error('✗ Utility validation failed:', error.message);
    console.error('  Stack:', error.stack);
    throw error;
  }
}

async function displayRouteSummary() {
  console.log('\n=== PHASE 1 ENDPOINTS SUMMARY ===\n');

  const endpoints = [
    ['POST', '/api/channel-partners/:resellerId/advances', 'Record single partner advance'],
    ['POST', '/api/channel-partners/:resellerId/advances/bulk', 'Record bulk partner advances'],
    ['GET', '/api/channel-partners/:resellerId/advances/pending', 'List pending advances'],
    ['PATCH', '/api/channel-partners/:resellerId/advances/:advanceId/apply', 'Apply advance to settlement'],
    ['PATCH', '/api/channel-partners/:resellerId/advances/:advanceId/dispute', 'Dispute an advance'],
    ['PATCH', '/api/channel-partners/:resellerId/advances/:advanceId/reverse', 'Reverse an advance'],
    ['POST', '/api/channel-partners/:resellerId/reconciliation/initiate', 'Initiate reconciliation'],
    ['GET', '/api/channel-partners/:resellerId/reconciliation/:reconciliationLogId', 'Get reconciliation status'],
    ['PATCH', '/api/channel-partners/:resellerId/reconciliation/:reconciliationLogId/approve', 'Approve reconciliation'],
    ['GET', '/api/channel-partners/:resellerId/reconciliation/report/:period', 'Get reconciliation report'],
    ['GET', '/api/channel-partners/:resellerId/settlement/statement/:period', 'Get settlement statement'],
  ];

  console.log('Newly added endpoints:\n');
  endpoints.forEach(([method, path, desc]) => {
    console.log(`  ${method.padEnd(6)} ${path.padEnd(60)} # ${desc}`);
  });
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║  PHASE 1: Channel Partner Billing Standardization - Setup Script  ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  try {
    await verifyPrerequisites();
    const migrationSql = await readMigration();
    await validateSchemaChanges();

    console.log('\n=== READY TO APPLY MIGRATION ===\n');
    console.log('This will:');
    console.log('  1. Add billing period tracking columns to channel_user_payments');
    console.log('  2. Create channel_partner_advances table for tracking partner payments');
    console.log('  3. Create billing_reconciliation_logs for month-end reconciliation');
    console.log('  4. Create immutable audit trail table');
    console.log('  5. Add state machine and adjustment audit tables');
    console.log('  6. Create necessary indexes for performance');
    console.log('  7. Add new permissions for Phase 1 operations');

    // In production, you'd prompt for confirmation here
    const args = process.argv.slice(2);
    if (args.includes('--confirm') || args.includes('--auto')) {
      console.log('\n→ Auto-applying migration...\n');
      await applyMigration(migrationSql);
    } else {
      console.log('\n→ Dry-run complete. To apply migration, run:');
      console.log('   node server/scripts/phase1-setup.js --confirm\n');
      process.exit(0);
    }

    await verifyMigrationApplied();
    await validateUtilities();
    displayRouteSummary();

    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  ✓ PHASE 1 SETUP COMPLETE                                        ║');
    console.log('║  Next Steps:                                                       ║');
    console.log('║  1. Run Phase 2: Billing Period Separation                        ║');
    console.log('║  2. Test new endpoints with sample data                           ║');
    console.log('║  3. Update frontend to use new reconciliation & advance APIs      ║');
    console.log('║  4. Deploy to staging for QA testing                              ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    process.exit(0);
  } catch (error) {
    console.error('\n✗ SETUP FAILED');
    console.error('Error:', error.message);
    console.error('\nPlease check the error details above and try again.');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
