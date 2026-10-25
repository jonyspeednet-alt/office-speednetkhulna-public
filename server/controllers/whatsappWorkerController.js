const crypto = require('crypto');
const {
  claimNextJob,
  markJobCompleted,
  markJobFailed,
  reclaimStaleJobs,
  updateWorkerState,
  updateSessionState
} = require('../utilities/whatsappWorkerQueue');

const requireWorkerApiKey = (req, res, next) => {
  const expected = String(process.env.WHATSAPP_WORKER_API_KEY || '').trim();
  if (!expected) {
    return res.status(503).json({ message: 'Worker API key is not configured' });
  }
  const provided = String(req.headers['x-worker-api-key'] || '').trim();
  // S21: constant-time compare on fixed-length digests (no length oracle).
  let ok = false;
  try {
    const a = crypto.createHash('sha256').update(provided, 'utf8').digest();
    const b = crypto.createHash('sha256').update(expected, 'utf8').digest();
    ok = provided !== '' && a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch (_) {
    ok = false;
  }
  if (!ok) {
    return res.status(401).json({ message: 'Unauthorized worker request' });
  }
  return next();
};

const getNextWorkerJob = async (req, res) => {
  try {
    const workerName = String(req.query.worker || req.body?.worker || 'remote_worker').trim();
    // B22: reclaim crash-orphaned 'processing' jobs before claiming.
    try {
      await reclaimStaleJobs(10);
    } catch (reclaimErr) {
      console.warn('[WhatsAppWorker] reclaim failed:', reclaimErr.message);
    }
    const job = await claimNextJob(workerName, req.query.queue || req.body?.queue || null);
    return res.json({ job });
  } catch (error) {
    console.error('[WhatsAppWorker] next job failed:', error);
    return res.status(500).json({ message: 'Failed to claim worker job' });
  }
};

const completeWorkerJob = async (req, res) => {
  try {
    await markJobCompleted(Number(req.params.id));
    return res.json({ success: true });
  } catch (error) {
    console.error('[WhatsAppWorker] complete job failed:', error);
    return res.status(500).json({ message: 'Failed to complete worker job' });
  }
};

const failWorkerJob = async (req, res) => {
  try {
    await markJobFailed(Number(req.params.id), req.body?.error || 'Worker job failed', Boolean(req.body?.retry));
    return res.json({ success: true });
  } catch (error) {
    console.error('[WhatsAppWorker] fail job failed:', error);
    return res.status(500).json({ message: 'Failed to update worker job' });
  }
};

const syncWorkerState = async (req, res) => {
  try {
    if (req.body?.session) {
      const state = await updateSessionState(req.body.session, req.body || {});
      return res.json({ success: true, state });
    }
    const state = await updateWorkerState(req.body || {});
    return res.json({ success: true, state });
  } catch (error) {
    console.error('[WhatsAppWorker] state sync failed:', error);
    return res.status(500).json({ message: 'Failed to sync worker state' });
  }
};

module.exports = {
  requireWorkerApiKey,
  getNextWorkerJob,
  completeWorkerJob,
  failWorkerJob,
  syncWorkerState
};
