const pool = require('./db');

let initDone = false;

const DEFAULT_STATE = {
  enabled: true,
  connected: false,
  ready: false,
  state: 'disconnected',
  headless: true,
  hasQr: false,
  qr: null,
  error: null,
  account: null,
  mode: 'worker_pull',
  updatedAt: null,
  lastSeenAt: null
};

const initWhatsAppWorkerTables = async () => {
  if (initDone) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_worker_jobs (
        id BIGSERIAL PRIMARY KEY,
        job_type VARCHAR(50) NOT NULL,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        worker_name TEXT NULL,
        last_error TEXT NULL,
        claimed_at TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_worker_state (
        id INTEGER PRIMARY KEY DEFAULT 1,
        connected BOOLEAN NOT NULL DEFAULT FALSE,
        ready BOOLEAN NOT NULL DEFAULT FALSE,
        state VARCHAR(40) NOT NULL DEFAULT 'disconnected',
        headless BOOLEAN NOT NULL DEFAULT TRUE,
        has_qr BOOLEAN NOT NULL DEFAULT FALSE,
        qr TEXT NULL,
        error TEXT NULL,
        account_name TEXT NULL,
        account_number TEXT NULL,
        account_platform TEXT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CHECK (id = 1)
      )
    `);

    const indexSql = [
      'CREATE INDEX IF NOT EXISTS idx_whatsapp_worker_jobs_status_created ON whatsapp_worker_jobs (status, created_at)',
      'CREATE INDEX IF NOT EXISTS idx_whatsapp_worker_jobs_type_status ON whatsapp_worker_jobs (job_type, status)'
    ];
    for (const sql of indexSql) {
      await pool.query(sql);
    }

    // Multi-session routing (leave vs support sender numbers): jobs carry
    // a queue name; each session's work is claimed separately.
    await pool.query(`ALTER TABLE whatsapp_worker_jobs ADD COLUMN IF NOT EXISTS queue VARCHAR(20) NOT NULL DEFAULT 'leave'`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_whatsapp_worker_jobs_queue_status ON whatsapp_worker_jobs (queue, status)`);

    // Per-session login state (pushed by the worker; id=1 legacy row stays
    // the leave/default session for old readers).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_worker_sessions (
        session VARCHAR(20) PRIMARY KEY,
        connected BOOLEAN NOT NULL DEFAULT FALSE,
        ready BOOLEAN NOT NULL DEFAULT FALSE,
        state VARCHAR(40) NOT NULL DEFAULT 'disconnected',
        headless BOOLEAN NOT NULL DEFAULT TRUE,
        has_qr BOOLEAN NOT NULL DEFAULT FALSE,
        qr TEXT NULL,
        error TEXT NULL,
        account_name TEXT NULL,
        account_number TEXT NULL,
        account_platform TEXT NULL,
        started BOOLEAN NOT NULL DEFAULT FALSE,
        reconnect_attempts INTEGER NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    initDone = true;
    console.log('[WhatsAppWorkerQueue] tables ready');
  } catch (error) {
    console.error('[WhatsAppWorkerQueue] init failed:', error.message);
  }
};

const VALID_QUEUES = new Set(['leave', 'support']);
const normalizeQueue = (q) => (VALID_QUEUES.has(String(q || '').trim()) ? String(q).trim() : 'leave');

const enqueueJob = async (jobType, payload = {}, queue = 'leave') => {
  const result = await pool.query(
    `INSERT INTO whatsapp_worker_jobs (job_type, payload, queue, status, created_at, updated_at)
     VALUES ($1, $2::jsonb, $3, 'pending', NOW(), NOW())
     RETURNING *`,
    [jobType, JSON.stringify(payload || {}), normalizeQueue(queue)]
  );
  return result.rows[0];
};

const claimNextJob = async (workerName = 'worker', queue = null) => {
  const q = queue ? normalizeQueue(queue) : null;
  const result = await pool.query(
    `WITH next_job AS (
       SELECT id
       FROM whatsapp_worker_jobs
       WHERE status = 'pending'${q ? ` AND queue = '${q}'` : ''}
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE whatsapp_worker_jobs AS j
     SET status = 'processing',
         attempts = j.attempts + 1,
         worker_name = $1,
         claimed_at = NOW(),
         updated_at = NOW()
     FROM next_job
     WHERE j.id = next_job.id
     RETURNING j.*`,
    [workerName]
  );
  return result.rows[0] || null;
};

const markJobCompleted = async (jobId) => {
  // Ownership-lite: only a job currently 'processing' can complete.
  // Prevents key-holders from flipping finished jobs or requeue-gaming.
  await pool.query(
    `UPDATE whatsapp_worker_jobs
     SET status = 'completed',
         completed_at = NOW(),
         updated_at = NOW(),
         last_error = NULL
     WHERE id = $1 AND status = 'processing'`,
    [jobId]
  );
};

// B22: cap retries — without this a failing job bounces pending →
// processing → pending forever (retry storm), and attempts was never read.
const MAX_JOB_ATTEMPTS = 5;

const markJobFailed = async (jobId, errorMessage, retry = false) => {
  await pool.query(
    `UPDATE whatsapp_worker_jobs
     SET status = CASE
           WHEN $2 = 'pending' AND COALESCE(attempts, 0) >= ${MAX_JOB_ATTEMPTS} THEN 'failed'
           ELSE $2
         END,
         last_error = $3,
         updated_at = NOW()
     WHERE id = $1 AND status = 'processing'`,
    [jobId, retry ? 'pending' : 'failed', String(errorMessage || 'Unknown worker error').slice(0, 2000)]
  );
};

// B22: reclaim jobs stuck in 'processing' after a worker crash (no heartbeat
// for > staleMinutes). Called best-effort on each poll — idempotent.
const reclaimStaleJobs = async (staleMinutes = 10) => {
  const result = await pool.query(
    `UPDATE whatsapp_worker_jobs
     SET status = 'pending',
         worker_name = NULL,
         last_error = COALESCE(last_error, 'Reclaimed: worker died while processing'),
         updated_at = NOW()
     WHERE status = 'processing'
       AND updated_at < NOW() - ($1 || ' minutes')::interval
     RETURNING id`,
    [String(staleMinutes)],
  );
  return result.rows.map((r) => r.id);
};

// --- Per-session login state (multi-number maintenance dashboard) ---
const VALID_SESSIONS = new Set(['leave', 'support']);
const normalizeSession = (s) => (VALID_SESSIONS.has(String(s || '').trim()) ? String(s).trim() : 'leave');

const updateSessionState = async (session, state = {}) => {
  const account = state.account || {};
  const result = await pool.query(
    `INSERT INTO whatsapp_worker_sessions (
       session, connected, ready, state, headless, has_qr, qr, error,
       account_name, account_number, account_platform, started,
       reconnect_attempts, updated_at, last_seen_at
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       $9, $10, $11, $12,
       $13, NOW(), NOW()
     )
     ON CONFLICT (session) DO UPDATE SET
       connected = EXCLUDED.connected,
       ready = EXCLUDED.ready,
       state = EXCLUDED.state,
       headless = EXCLUDED.headless,
       has_qr = EXCLUDED.has_qr,
       qr = EXCLUDED.qr,
       error = EXCLUDED.error,
       account_name = EXCLUDED.account_name,
       account_number = EXCLUDED.account_number,
       account_platform = EXCLUDED.account_platform,
       started = EXCLUDED.started,
       reconnect_attempts = EXCLUDED.reconnect_attempts,
       updated_at = NOW(),
       last_seen_at = NOW()
     RETURNING *`,
    [
      normalizeSession(session),
      Boolean(state.connected),
      Boolean(state.ready),
      String(state.state || 'disconnected'),
      state.headless !== false,
      Boolean(state.hasQr),
      state.qr || null,
      state.error || null,
      account.name || null,
      account.number || null,
      account.platform || null,
      Boolean(state.started),
      Number(state.reconnectAttempts || 0),
    ]
  );
  return result.rows[0] || null;
};

const getSessionState = async (session) => {
  const result = await pool.query('SELECT * FROM whatsapp_worker_sessions WHERE session = $1', [normalizeSession(session)]);
  const row = result.rows[0];
  if (!row) return { session: normalizeSession(session), connected: false, ready: false, state: 'never_started', hasQr: false, qr: null, error: null, account: null, started: false, reconnectAttempts: 0, updatedAt: null, lastSeenAt: null };
  const lastSeenAt = row.last_seen_at ? new Date(row.last_seen_at) : null;
  const isStale = !lastSeenAt || (Date.now() - lastSeenAt.getTime()) > WORKER_STALE_THRESHOLD_MS;
  return {
    session: row.session,
    connected: isStale ? false : Boolean(row.connected),
    ready: isStale ? false : Boolean(row.ready),
    state: isStale ? 'stale' : (row.state || 'disconnected'),
    headless: Boolean(row.headless),
    hasQr: isStale ? false : Boolean(row.has_qr),
    qr: isStale ? null : (row.qr || null),
    error: isStale ? 'Worker has not reported in recently.' : (row.error || null),
    account: (!isStale && (row.account_name || row.account_number)) ? { name: row.account_name || 'Office sender', number: row.account_number || '' } : null,
    started: Boolean(row.started),
    reconnectAttempts: Number(row.reconnect_attempts || 0),
    stale: isStale,
    updatedAt: row.updated_at || null,
    lastSeenAt: row.last_seen_at || null,
  };
};

const updateWorkerState = async (state = {}) => {  const account = state.account || {};
  const result = await pool.query(
    `INSERT INTO whatsapp_worker_state (
       id, connected, ready, state, headless, has_qr, qr, error,
       account_name, account_number, account_platform, updated_at, last_seen_at
     ) VALUES (
       1, $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, NOW(), NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       connected = EXCLUDED.connected,
       ready = EXCLUDED.ready,
       state = EXCLUDED.state,
       headless = EXCLUDED.headless,
       has_qr = EXCLUDED.has_qr,
       qr = EXCLUDED.qr,
       error = EXCLUDED.error,
       account_name = EXCLUDED.account_name,
       account_number = EXCLUDED.account_number,
       account_platform = EXCLUDED.account_platform,
       updated_at = NOW(),
       last_seen_at = NOW()
     RETURNING *`,
    [
      Boolean(state.connected),
      Boolean(state.ready),
      String(state.state || 'disconnected'),
      state.headless !== false,
      Boolean(state.hasQr),
      state.qr || null,
      state.error || null,
      account.name || null,
      account.number || null,
      account.platform || null
    ]
  );
  return result.rows[0] || null;
};

const WORKER_STALE_THRESHOLD_MS = 30 * 1000;

const getWorkerState = async () => {
  const result = await pool.query('SELECT * FROM whatsapp_worker_state WHERE id = 1');
  const row = result.rows[0];
  if (!row) return { ...DEFAULT_STATE };

  const lastSeenAt = row.last_seen_at ? new Date(row.last_seen_at) : null;
  const isStale = !lastSeenAt || (Date.now() - lastSeenAt.getTime()) > WORKER_STALE_THRESHOLD_MS;

  return {
    enabled: true,
    connected: isStale ? false : Boolean(row.connected),
    ready: isStale ? false : Boolean(row.ready),
    state: isStale ? 'stale' : (row.state || 'disconnected'),
    headless: Boolean(row.headless),
    hasQr: isStale ? false : Boolean(row.has_qr),
    qr: isStale ? null : (row.qr || null),
    error: isStale ? 'Worker has not reported in recently.' : (row.error || null),
    account: (!isStale && (row.account_name || row.account_number || row.account_platform)) ? {
      name: row.account_name || 'Office sender',
      number: row.account_number || '',
      platform: row.account_platform || ''
    } : null,
    mode: 'worker_pull',
    stale: isStale,
    updatedAt: row.updated_at || null,
    lastSeenAt: row.last_seen_at || null
  };
};

const getWorkerDiagnostics = async () => {
  const lastDeliveryResult = await pool.query(
    `SELECT id, job_type, completed_at, created_at,
            payload->>'approvalId' AS approval_id,
            payload->'payload'->'info'->>'full_name' AS employee_name,
            payload->>'groupName' AS group_name
     FROM whatsapp_worker_jobs
     WHERE status = 'completed'
       AND job_type IN ('send_approval', 'send_test')
     ORDER BY completed_at DESC NULLS LAST, created_at DESC
     LIMIT 1`
  );

  const lastApprovalResult = await pool.query(
    `SELECT id, job_type, completed_at, created_at,
            payload->>'approvalId' AS approval_id,
            payload->'payload'->'info'->>'full_name' AS employee_name,
            payload->>'groupName' AS group_name
     FROM whatsapp_worker_jobs
     WHERE status = 'completed'
       AND job_type = 'send_approval'
     ORDER BY completed_at DESC NULLS LAST, created_at DESC
     LIMIT 1`
  );

  const pendingJobResult = await pool.query(
    `SELECT COUNT(*)::int AS pending_count
     FROM whatsapp_worker_jobs
     WHERE status IN ('pending', 'processing')`
  );

  const recentEventsResult = await pool.query(
    `SELECT job_type, status, created_at, completed_at, updated_at, last_error,
            payload->>'approvalId' AS approval_id,
            payload->'payload'->'info'->>'full_name' AS employee_name
     FROM whatsapp_worker_jobs
     WHERE job_type IN ('start', 'reconnect', 'stop', 'send_approval', 'send_test', 'send_test_image')
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 5`
  );

  return {
    lastDelivery: lastDeliveryResult.rows[0]
      ? {
          jobType: lastDeliveryResult.rows[0].job_type,
          completedAt: lastDeliveryResult.rows[0].completed_at || null,
          createdAt: lastDeliveryResult.rows[0].created_at || null,
          approvalId: lastDeliveryResult.rows[0].approval_id || null,
          employeeName: lastDeliveryResult.rows[0].employee_name || null,
          groupName: lastDeliveryResult.rows[0].group_name || null
        }
      : null,
    lastApproval: lastApprovalResult.rows[0]
      ? {
          completedAt: lastApprovalResult.rows[0].completed_at || null,
          createdAt: lastApprovalResult.rows[0].created_at || null,
          approvalId: lastApprovalResult.rows[0].approval_id || null,
          employeeName: lastApprovalResult.rows[0].employee_name || null,
          groupName: lastApprovalResult.rows[0].group_name || null
        }
      : null,
    pendingJobs: pendingJobResult.rows[0]?.pending_count || 0
    ,
    recentEvents: recentEventsResult.rows.map((row) => ({
      jobType: row.job_type,
      status: row.status,
      createdAt: row.created_at || null,
      completedAt: row.completed_at || null,
      updatedAt: row.updated_at || null,
      lastError: row.last_error || null,
      approvalId: row.approval_id || null,
      employeeName: row.employee_name || null
    }))
  };
};

module.exports = {
  initWhatsAppWorkerTables,
  enqueueJob,
  claimNextJob,
  markJobCompleted,
  markJobFailed,
  reclaimStaleJobs,
  MAX_JOB_ATTEMPTS,
  updateWorkerState,
  getWorkerState,
  getWorkerDiagnostics,
  normalizeQueue,
  normalizeSession,
  updateSessionState,
  getSessionState
};
