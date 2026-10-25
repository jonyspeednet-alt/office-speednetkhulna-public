#!/usr/bin/env node

/**
 * Phase 2 Data Backfill Script
 * Updates existing channel_user_payments records to set service_period and billing_status
 * 
 * Usage: node server/scripts/phase2-backfill-data.js [--confirm]
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const pool = require('../utilities/db');

async function analyzeExistingData() {
    console.log('\n=== ANALYZING EXISTING DATA ===\n');

    try {
        // Count records without service_period
        const nullServicePeriod = await pool.query(
            `SELECT COUNT(*) AS count FROM channel_user_payments WHERE service_period IS NULL`
        );
        console.log(`Records without service_period: ${nullServicePeriod.rows[0].count}`);

        // Count records without billing_status
        const nullBillingStatus = await pool.query(
            `SELECT COUNT(*) AS count FROM channel_user_payments WHERE billing_status IS NULL`
        );
        console.log(`Records without billing_status: ${nullBillingStatus.rows[0].count}`);

        // Count records without realized/deferred amounts
        const nullAmounts = await pool.query(
            `SELECT COUNT(*) AS count FROM channel_user_payments 
       WHERE realized_amount IS NULL OR deferred_amount IS NULL`
        );
        console.log(`Records without realized/deferred amounts: ${nullAmounts.rows[0].count}`);

        // Sample of records to be updated
        const sample = await pool.query(
            `SELECT id, reseller_id, user_id, month, amount_due, amount_paid, payment_status
       FROM channel_user_payments 
       WHERE service_period IS NULL 
       LIMIT 5`
        );

        if (sample.rows.length > 0) {
            console.log('\nSample records to be updated:');
            sample.rows.forEach(r => {
                console.log(`  ID ${r.id}: month=${r.month}, due=${r.amount_due}, paid=${r.amount_paid}, status=${r.payment_status}`);
            });
        }

        return {
            needsUpdate: Number(nullServicePeriod.rows[0].count) > 0
        };
    } catch (error) {
        console.error('✗ Analysis failed:', error.message);
        throw error;
    }
}

async function backfillData() {
    console.log('\n=== BACKFILLING DATA ===\n');

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Update service_period = month for all existing records
        console.log('Setting service_period = month for existing records...');
        const servicePeriodResult = await client.query(
            `UPDATE channel_user_payments
       SET service_period = month,
           bill_issued_date = COALESCE(bill_issued_date, created_at, NOW())
       WHERE service_period IS NULL`
        );
        console.log(`✓ Updated ${servicePeriodResult.rowCount} records with service_period`);

        // Calculate and set billing_status based on amounts
        console.log('Calculating billing_status for existing records...');
        const billingStatusResult = await client.query(
            `UPDATE channel_user_payments
       SET billing_status = CASE
         WHEN amount_paid >= amount_due AND amount_due > 0 THEN 'realized'
         WHEN amount_paid > 0 AND amount_paid < amount_due THEN 'partial_deferred'
         ELSE 'deferred'
       END
       WHERE billing_status IS NULL`
        );
        console.log(`✓ Updated ${billingStatusResult.rowCount} records with billing_status`);

        // Calculate and set realized_amount and deferred_amount
        console.log('Calculating realized/deferred amounts for existing records...');
        const amountsResult = await client.query(
            `UPDATE channel_user_payments
       SET realized_amount = COALESCE(amount_paid, 0),
           deferred_amount = GREATEST(0, COALESCE(amount_due, 0) - COALESCE(amount_paid, 0))
       WHERE realized_amount IS NULL OR deferred_amount IS NULL`
        );
        console.log(`✓ Updated ${amountsResult.rowCount} records with realized/deferred amounts`);

        await client.query('COMMIT');
        console.log('\n✓ Data backfill completed successfully');

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('✗ Backfill failed:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

async function verifyBackfill() {
    console.log('\n=== VERIFYING BACKFILL ===\n');

    try {
        // Check for any remaining NULL values
        const nullCheck = await pool.query(
            `SELECT 
        COUNT(*) FILTER (WHERE service_period IS NULL) AS null_service_period,
        COUNT(*) FILTER (WHERE billing_status IS NULL) AS null_billing_status,
        COUNT(*) FILTER (WHERE realized_amount IS NULL) AS null_realized,
        COUNT(*) FILTER (WHERE deferred_amount IS NULL) AS null_deferred
       FROM channel_user_payments`
        );

        const check = nullCheck.rows[0];
        console.log(`Records with NULL service_period: ${check.null_service_period}`);
        console.log(`Records with NULL billing_status: ${check.null_billing_status}`);
        console.log(`Records with NULL realized_amount: ${check.null_realized}`);
        console.log(`Records with NULL deferred_amount: ${check.null_deferred}`);

        // Show billing status distribution
        const statusDist = await pool.query(
            `SELECT billing_status, COUNT(*) AS count
       FROM channel_user_payments
       WHERE billing_status IS NOT NULL
       GROUP BY billing_status
       ORDER BY count DESC`
        );

        console.log('\nBilling status distribution:');
        statusDist.rows.forEach(r => {
            console.log(`  ${r.billing_status}: ${r.count} records`);
        });

        // Show sample of updated records
        const sample = await pool.query(
            `SELECT id, month, service_period, billing_status, 
              amount_due, amount_paid, realized_amount, deferred_amount
       FROM channel_user_payments
       ORDER BY id DESC
       LIMIT 5`
        );

        console.log('\nSample of updated records:');
        sample.rows.forEach(r => {
            console.log(`  ID ${r.id}: service=${r.service_period}, status=${r.billing_status}, realized=${r.realized_amount}, deferred=${r.deferred_amount}`);
        });

        const allGood =
            Number(check.null_service_period) === 0 &&
            Number(check.null_billing_status) === 0 &&
            Number(check.null_realized) === 0 &&
            Number(check.null_deferred) === 0;

        if (allGood) {
            console.log('\n✓ All records successfully backfilled');
        } else {
            console.log('\n⚠ Some records still have NULL values');
        }

        return allGood;
    } catch (error) {
        console.error('✗ Verification failed:', error.message);
        throw error;
    }
}

async function main() {
    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  PHASE 2: Data Backfill Script                                    ║');
    console.log('║  Updates existing records with service_period and billing_status  ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');

    try {
        const analysis = await analyzeExistingData();

        if (!analysis.needsUpdate) {
            console.log('\n✓ No records need updating. All data is already backfilled.');
            process.exit(0);
        }

        const args = process.argv.slice(2);
        if (args.includes('--confirm') || args.includes('--auto')) {
            console.log('\n→ Proceeding with backfill...\n');
            await backfillData();
            const verified = await verifyBackfill();

            if (verified) {
                console.log('\n╔══════════════════════════════════════════════════════════════════╗');
                console.log('║  ✓ PHASE 2 DATA BACKFILL COMPLETE                                ║');
                console.log('║  All existing records updated with:                               ║');
                console.log('║  - service_period (set to month value)                            ║');
                console.log('║  - billing_status (calculated from amounts)                       ║');
                console.log('║  - realized_amount and deferred_amount                            ║');
                console.log('╚══════════════════════════════════════════════════════════════════╝\n');
            } else {
                console.log('\n⚠ Backfill completed but some records may need manual review\n');
            }

            process.exit(0);
        } else {
            console.log('\n→ Dry-run complete. To apply backfill, run:');
            console.log('   node server/scripts/phase2-backfill-data.js --confirm\n');
            process.exit(0);
        }
    } catch (error) {
        console.error('\n✗ BACKFILL FAILED');
        console.error('Error:', error.message);
        console.error('\nPlease check the error details above and try again.');
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
