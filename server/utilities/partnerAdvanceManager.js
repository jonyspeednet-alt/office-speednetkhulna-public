/**
 * Partner Advance Manager
 * Handles recording, tracking, and settlement of partner advances
 */

const pool = require('./db');
const { logFinancialTransaction } = require('./auditLogger');
const { lockChannelMonth, financialMonth, financialError, currentFinancialMonth } = require('./channelFinancialLock');

class PartnerAdvanceManager {
  /**
   * Record a partner advance (partner paid user bill on their behalf)
   * @param {number} resellerId - Reseller ID
   * @param {number} userId - User ID
   * @param {number} advanceMonth - Month of advance (as Date YYYY-MM-01)
   * @param {number} advanceAmount - Amount advanced
   * @param {string} advanceType - Type: 'direct_payment', 'self_paid', 'manual_adjustment'
   * @param {number} recordedBy - User ID recording this
   * @param {string} notes - Optional notes
   * @returns {Promise<Object>} Created advance record
   */
  static async recordAdvance(resellerId, userId, advanceMonth, advanceAmount, advanceType, recordedBy, notes = null) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (![resellerId, userId].every((id) => Number.isSafeInteger(Number(id)) && Number(id) > 0)) {
        throw financialError(400, 'Valid reseller and user IDs are required');
      }

      // Validate advance amount is positive
      if (!Number.isFinite(Number(advanceAmount)) || Number(advanceAmount) <= 0) {
        throw financialError(400, 'Advance amount must be positive and finite');
      }

      // Validate advance type
      const validTypes = ['direct_payment', 'self_paid', 'manual_adjustment'];
      if (!validTypes.includes(advanceType)) {
        throw financialError(400, `Invalid advance type. Must be one of: ${validTypes.join(', ')}`);
      }
      const month = await lockChannelMonth(client, resellerId, advanceMonth);
      const owner = await client.query('SELECT id FROM channel_partner_users WHERE id=$1 AND reseller_id=$2 FOR UPDATE', [userId, resellerId]);
      if (!owner.rows.length) throw financialError(403, 'Advance user does not belong to this reseller');
      advanceMonth = `${month}-01`;

      // Create advance record
      const advanceResult = await client.query(
        `INSERT INTO channel_partner_advances
         (reseller_id, user_id, advance_month, advance_amount, advance_type, 
          settlement_status, notes, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, 'pending_adjustment', $6, $7, NOW())
         RETURNING *`,
        [resellerId, userId, advanceMonth, advanceAmount, advanceType, notes, recordedBy]
      );

      const advance = advanceResult.rows[0];

      // Log to immutable audit
      await logFinancialTransaction({
        actor_user_id: recordedBy,
        reseller_id: resellerId,
        action_type: `advance.${advanceType}`,
        entity_type: 'channel_partner_advances',
        entity_id: advance.id,
        amount_before: null,
        amount_after: advanceAmount,
        previous_status: null,
        new_status: 'pending_adjustment',
        request_payload: {
          user_id: userId,
          advance_month: advanceMonth,
          advance_type: advanceType,
          notes
        },
        notes: `Partner advance recorded: ${advanceType}`
      });

      await client.query('COMMIT');
      return advance;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Record bulk partner advances
   * @param {number} resellerId - Reseller ID
   * @param {Array} advances - Array of { user_id, advance_amount, advance_type, notes }
   * @param {number} recordedBy - User ID recording
   * @returns {Promise<Array>} Created advance records
   */
  static async recordBulkAdvances(resellerId, advances, recordedBy) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (!Array.isArray(advances) || !advances.length || advances.length > 200 ||
          advances.some((advance) => !advance || !Number.isSafeInteger(Number(advance.user_id)) || Number(advance.user_id) <= 0 ||
            !Number.isFinite(Number(advance.advance_amount)) || Number(advance.advance_amount) <= 0 ||
            !['direct_payment', 'self_paid', 'manual_adjustment'].includes(advance.advance_type || 'self_paid'))) {
        throw financialError(400, 'advances must contain 1 to 200 valid positive amounts, user IDs and advance types');
      }
      const month = await lockChannelMonth(client, resellerId, currentFinancialMonth());
      const advanceMonth = `${month}-01`;
      const userIds = [...new Set(advances.map((advance) => Number(advance.user_id)))];
      const owners = await client.query('SELECT id FROM channel_partner_users WHERE id=ANY($1::int[]) AND reseller_id=$2 ORDER BY id FOR UPDATE', [userIds, resellerId]);
      if (owners.rows.length !== userIds.length) throw financialError(403, 'Advance user does not belong to this reseller');

      const createdAdvances = [];

      for (const advance of advances) {
        const advanceResult = await client.query(
          `INSERT INTO channel_partner_advances
           (reseller_id, user_id, advance_month, advance_amount, advance_type, 
            settlement_status, notes, created_by, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending_adjustment', $6, $7, NOW())
           RETURNING *`,
          [
            resellerId,
            advance.user_id,
            advanceMonth,
            advance.advance_amount,
            advance.advance_type || 'self_paid',
            advance.notes || null,
            recordedBy
          ]
        );

        createdAdvances.push(advanceResult.rows[0]);
      }

      // Log bulk operation
      await logFinancialTransaction({
        actor_user_id: recordedBy,
        reseller_id: resellerId,
        action_type: 'advance.bulk_recorded',
        entity_type: 'channel_partner_advances',
        entity_id: null,
        amount_before: null,
        amount_after: createdAdvances.reduce((sum, a) => sum + parseFloat(a.advance_amount), 0),
        previous_status: null,
        new_status: 'pending_adjustment',
        request_payload: { count: createdAdvances.length, advances },
        notes: `Bulk recorded ${createdAdvances.length} partner advances`
      });

      await client.query('COMMIT');
      return createdAdvances;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Apply partner advance as adjustment to settlement
   * @param {number} advanceId - Advance ID
   * @param {number} approvedBy - User ID approving
   * @returns {Promise<Object>} Updated advance record
   */
  static async applyAdvanceAdjustment(advanceId, approvedBy, expectedResellerId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const scope = await client.query('SELECT reseller_id, advance_month FROM channel_partner_advances WHERE id=$1 AND reseller_id=$2', [advanceId, expectedResellerId]);
      if (!scope.rows.length) throw financialError(404, 'Advance record not found');
      await lockChannelMonth(client, expectedResellerId, scope.rows[0].advance_month);

      // Get advance record
      const advanceResult = await client.query(
        'SELECT * FROM channel_partner_advances WHERE id = $1 AND reseller_id=$2 FOR UPDATE',
        [advanceId, expectedResellerId]
      );

      if (advanceResult.rows.length === 0) {
        throw financialError(404, 'Advance record not found');
      }

      const advance = advanceResult.rows[0];

      if (advance.settlement_status !== 'pending_adjustment') {
        throw financialError(409, `Cannot apply advance with status: ${advance.settlement_status}`);
      }

      // Update advance status
      const updateResult = await client.query(
        `UPDATE channel_partner_advances 
         SET settlement_status = 'adjusted',
             resolved_at = NOW(),
             resolved_by = $1,
             updated_at = NOW()
         WHERE id = $2
         RETURNING *`,
        [approvedBy, advanceId]
      );

      // Log to adjustment audit
      await client.query(
        `INSERT INTO channel_adjustment_audit
         (reseller_id, adjustment_month, adjustment_type, adjustment_amount, reason, 
          created_by, related_user_id, related_payment_id, notes)
         VALUES ($1, $2, 'partner_advance', $3, 'Partner advance applied to settlement', 
                 $4, $5, NULL, $6)`,
        [
          advance.reseller_id,
          advance.advance_month,
          advance.advance_amount,
          approvedBy,
          advance.user_id,
          `Applied partner advance: ${advance.advance_type}`
        ]
      );

      // Log to immutable audit
      await logFinancialTransaction({
        actor_user_id: approvedBy,
        reseller_id: advance.reseller_id,
        action_type: 'advance.applied',
        entity_type: 'channel_partner_advances',
        entity_id: advanceId,
        amount_before: parseFloat(advance.advance_amount),
        amount_after: parseFloat(advance.advance_amount),
        previous_status: 'pending_adjustment',
        new_status: 'adjusted',
        request_payload: { advance_id: advanceId },
        notes: `Applied partner advance to settlement`
      });

      await client.query('COMMIT');
      return updateResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Dispute a partner advance
   * @param {number} advanceId - Advance ID
   * @param {number} disputedBy - User ID disputing
   * @param {string} reason - Reason for dispute
   * @returns {Promise<Object>} Updated advance record
   */
  static async disputeAdvance(advanceId, disputedBy, reason, expectedResellerId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const scope = await client.query('SELECT reseller_id, advance_month FROM channel_partner_advances WHERE id=$1 AND reseller_id=$2', [advanceId, expectedResellerId]);
      if (!scope.rows.length) throw financialError(404, 'Advance record not found');
      await lockChannelMonth(client, expectedResellerId, scope.rows[0].advance_month);

      const advanceResult = await client.query(
        'SELECT * FROM channel_partner_advances WHERE id = $1 AND reseller_id=$2 FOR UPDATE',
        [advanceId, expectedResellerId]
      );

      if (advanceResult.rows.length === 0) {
        throw financialError(404, 'Advance record not found');
      }

      const advance = advanceResult.rows[0];

      // Update to disputed status
      const updateResult = await client.query(
        `UPDATE channel_partner_advances 
         SET settlement_status = 'disputed',
             resolved_at = NOW(),
             resolved_by = $1,
             notes = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [disputedBy, reason, advanceId]
      );

      // Log to immutable audit
      await logFinancialTransaction({
        actor_user_id: disputedBy,
        reseller_id: advance.reseller_id,
        action_type: 'advance.disputed',
        entity_type: 'channel_partner_advances',
        entity_id: advanceId,
        amount_before: parseFloat(advance.advance_amount),
        amount_after: parseFloat(advance.advance_amount),
        previous_status: 'pending_adjustment',
        new_status: 'disputed',
        request_payload: { advance_id: advanceId, reason },
        notes: `Disputed: ${reason}`
      });

      await client.query('COMMIT');
      return updateResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Reverse a partner advance
   * @param {number} advanceId - Advance ID
   * @param {number} reversedBy - User ID reversing
   * @param {string} reason - Reason for reversal
   * @returns {Promise<Object>} Updated advance record
   */
  static async reverseAdvance(advanceId, reversedBy, reason, expectedResellerId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const scope = await client.query('SELECT reseller_id, advance_month FROM channel_partner_advances WHERE id=$1 AND reseller_id=$2', [advanceId, expectedResellerId]);
      if (!scope.rows.length) throw financialError(404, 'Advance record not found');
      await lockChannelMonth(client, expectedResellerId, scope.rows[0].advance_month);

      const advanceResult = await client.query(
        'SELECT * FROM channel_partner_advances WHERE id = $1 AND reseller_id=$2 FOR UPDATE',
        [advanceId, expectedResellerId]
      );

      if (advanceResult.rows.length === 0) {
        throw financialError(404, 'Advance record not found');
      }

      const advance = advanceResult.rows[0];

      // Update to reversed status
      const updateResult = await client.query(
        `UPDATE channel_partner_advances 
         SET settlement_status = 'reversed',
             resolved_at = NOW(),
             resolved_by = $1,
             notes = $2,
             updated_at = NOW()
         WHERE id = $3
         RETURNING *`,
        [reversedBy, reason, advanceId]
      );

      // Log to adjustment audit (negative reversal)
      await client.query(
        `INSERT INTO channel_adjustment_audit
         (reseller_id, adjustment_month, adjustment_type, adjustment_amount, reason, 
          created_by, related_user_id, notes)
         VALUES ($1, $2, 'reversal', $3, $4, $5, $6, $7)`,
        [
          advance.reseller_id,
          advance.advance_month,
          -parseFloat(advance.advance_amount),
          reason,
          reversedBy,
          advance.user_id,
          `Reversed partner advance: ${advance.advance_type}`
        ]
      );

      // Log to immutable audit
      await logFinancialTransaction({
        actor_user_id: reversedBy,
        reseller_id: advance.reseller_id,
        action_type: 'advance.reversed',
        entity_type: 'channel_partner_advances',
        entity_id: advanceId,
        amount_before: parseFloat(advance.advance_amount),
        amount_after: 0,
        previous_status: advance.settlement_status,
        new_status: 'reversed',
        request_payload: { advance_id: advanceId, reason },
        notes: `Reversed: ${reason}`
      });

      await client.query('COMMIT');
      return updateResult.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get all pending advances for a reseller
   * @param {number} resellerId - Reseller ID
   * @param {string} status - Filter by status (default: 'pending_adjustment')
   * @returns {Promise<Array>} Advance records
   */
  static async getPendingAdvances(resellerId, status = 'pending_adjustment') {
    const result = await pool.query(
      `SELECT cpa.*, cpu.user_name
       FROM channel_partner_advances cpa
       LEFT JOIN channel_partner_users cpu ON cpa.user_id = cpu.id
       WHERE cpa.reseller_id = $1 
         AND cpa.settlement_status = $2
       ORDER BY cpa.created_at DESC`,
      [resellerId, status]
    );

    return result.rows;
  }

  /**
   * Get advance history for a user/period
   * @param {number} resellerId - Reseller ID
   * @param {number} userId - User ID
   * @param {Date} month - Month to query
   * @returns {Promise<Array>} Advance records
   */
  static async getAdvanceHistory(resellerId, userId, month) {
    const result = await pool.query(
      `SELECT * FROM channel_partner_advances
       WHERE reseller_id = $1 
         AND user_id = $2 
         AND advance_month = $3
       ORDER BY created_at DESC`,
      [resellerId, userId, month]
    );

    return result.rows;
  }

  /**
   * Get total advances for a reseller in a period
   * @param {number} resellerId - Reseller ID
   * @param {Date} month - Month to query
   * @param {string} status - Filter by status
   * @returns {Promise<Object>} Total amounts by type
   */
  static async getTotalAdvances(resellerId, month, status = null) {
    let query = `
      SELECT 
        advance_type,
        COUNT(*) as count,
        SUM(advance_amount) as total_amount
      FROM channel_partner_advances
      WHERE reseller_id = $1 AND advance_month = $2
    `;
    const params = [resellerId, month];

    if (status) {
      query += ` AND settlement_status = $3`;
      params.push(status);
    }

    query += ` GROUP BY advance_type ORDER BY advance_type`;

    const result = await pool.query(query, params);
    return result.rows;
  }
}

module.exports = PartnerAdvanceManager;
