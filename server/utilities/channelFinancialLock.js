const financialError = (status, message) => Object.assign(new Error(message), { status });
const completedReconciliationStatuses = ['approved', 'reconciled', 'finalized'];
const isReconciliationLocked = (status) => completedReconciliationStatuses.includes(String(status || '').toLowerCase());
const currentFinancialMonth = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}`;
};
const financialMonth = (value) => {
  let text;
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (Number.isNaN(value.getTime())) throw financialError(400, 'Valid month (YYYY-MM) required');
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit' }).formatToParts(value);
    text = `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}`;
  } else text = String(value || '').slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text) || Number(text.slice(0, 4)) === 0) throw financialError(400, 'Valid month (YYYY-MM) required');
  return text;
};

// Transaction-scoped lock exists even before the first reconciliation row.
// Initiation, approval and financial writes must acquire it before row locks.
const lockChannelMonth = async (client, resellerId, value, { allowApproved = false } = {}) => {
  const id = Number(resellerId);
  if (!Number.isSafeInteger(id) || id <= 0) throw financialError(400, 'Invalid reseller ID');
  const month = financialMonth(value);
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '15s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('channel-financial-month'),hashtext($1))", [`${id}:${month}`]);
  const result = await client.query(
    `SELECT id, reconciliation_status FROM billing_reconciliation_logs
     WHERE reseller_id=$1 AND reconciliation_month=($2||'-01')::date ORDER BY id FOR UPDATE`, [id, month]
  );
  if (!allowApproved && result.rows.some((row) => isReconciliationLocked(row.reconciliation_status))) {
    throw financialError(403, 'Cannot modify an approved reconciliation month');
  }
  return month;
};

const lockProductMonth = async (client, resellerId, value) => {
  const month = await lockChannelMonth(client, resellerId, value);
  const logs = await client.query('SELECT status FROM channel_commission_logs WHERE reseller_id=$1 AND month=$2 FOR UPDATE', [resellerId, month]);
  if (logs.rows.some((row) => row.status === 'finalized')) throw financialError(403, 'Product month is finalized');
  return month;
};

const withChannelMonthTransaction = async (pool, resellerId, month, callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockChannelMonth(client, resellerId, month);
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw error;
  } finally { client.release(); }
};

const withCommissionTransaction = async (pool, resellerId, logId, callback) => {
  const scope = await pool.query('SELECT month FROM channel_commission_logs WHERE id=$1 AND reseller_id=$2', [logId, resellerId]);
  if (!scope.rows.length) throw financialError(404, 'Commission log not found');
  return withChannelMonthTransaction(pool, resellerId, scope.rows[0].month, async (client) => {
    const locked = await client.query('SELECT id FROM channel_commission_logs WHERE id=$1 AND reseller_id=$2 FOR UPDATE', [logId, resellerId]);
    if (!locked.rows.length) throw financialError(404, 'Commission log not found');
    return callback(client);
  });
};

module.exports = { lockChannelMonth, lockProductMonth, withChannelMonthTransaction, withCommissionTransaction, financialMonth, financialError, currentFinancialMonth, isReconciliationLocked };
