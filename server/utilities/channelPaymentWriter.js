const paymentError = (status, message) => Object.assign(new Error(message), { status });
const { lockChannelMonth } = require('./channelFinancialLock');

// Ownership and reconciliation state must be checked on the connection that writes.
const writeChannelPayments = async (pool, resellerId, month, payments, calculate) => {
  const partnerId = Number(resellerId);
  if (!Number.isSafeInteger(partnerId) || partnerId <= 0 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month)) || Number(String(month).slice(0, 4)) === 0) {
    throw paymentError(400, 'Valid reseller ID and month (YYYY-MM) are required');
  }
  if (!Array.isArray(payments) || !payments.length || payments.length > 200) {
    throw paymentError(400, 'payments must contain 1 to 200 items');
  }
  if (payments.some((item) => !item || typeof item !== 'object')) throw paymentError(400, 'Invalid payment item');
  const ids = payments.map((item) => Number(item.user_id));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length ||
      payments.some((item) => !Number.isFinite(item.paid) || item.paid < 0)) {
    throw paymentError(400, 'Invalid or duplicate payment user IDs or amounts');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockChannelMonth(client, partnerId, month);
    // Lock users in a stable order and validate the entire batch before its first write.
    const users = await client.query(
      `SELECT id, monthly_rate FROM channel_partner_users
       WHERE id=ANY($1::int[]) AND reseller_id=$2 ORDER BY id FOR UPDATE`, [ids, partnerId]
    );
    if (users.rows.length !== ids.length) throw paymentError(403, 'Payment user does not belong to this reseller');
    const current = await client.query(
      `SELECT user_id, reseller_id, amount_due FROM channel_user_payments
       WHERE user_id=ANY($1::int[]) AND month=$2 ORDER BY user_id FOR UPDATE`, [ids, month]
    );
    if (current.rows.some((row) => Number(row.reseller_id) !== partnerId)) {
      throw paymentError(403, 'Existing payment does not belong to this reseller');
    }
    const results = [];
    for (const payment of payments) {
      const id = Number(payment.user_id);
      const previous = current.rows.find((row) => Number(row.user_id) === id);
      const user = users.rows.find((row) => Number(row.id) === id);
      const values = calculate(Number(previous?.amount_due ?? user.monthly_rate ?? 0), payment.paid);
      const result = await client.query(
        `INSERT INTO channel_user_payments (
           reseller_id, user_id, month, service_period, bill_issued_date, billing_status,
           amount_due, amount_paid, realized_amount, deferred_amount, payment_date, payment_status, note)
         VALUES ($1,$2,$3::varchar,($3||'-01')::date,NOW(),$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (user_id, month) DO UPDATE SET
           amount_paid=$6, realized_amount=$7, deferred_amount=$8, payment_date=$9,
           billing_status=$4, payment_status=$10,
           note=COALESCE($11,channel_user_payments.note), updated_at=NOW()
         WHERE channel_user_payments.reseller_id=EXCLUDED.reseller_id RETURNING *`,
        [partnerId, id, month, values.billingStatus, values.amountDue, payment.paid,
          values.realized, values.deferred, payment.payment_date || null, values.paymentStatus, payment.note || '']
      );
      if (!result.rows.length) throw paymentError(403, 'Payment does not belong to this reseller');
      results.push(result.rows[0]);
    }
    await client.query('COMMIT');
    return results;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { writeChannelPayments };
