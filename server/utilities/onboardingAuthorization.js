const { isSuperAdmin, resolvePermission } = require('./permissionRegistry');

const canReviewOnboarding = (user) => isSuperAdmin(user) ||
  resolvePermission(user, 'system.all_access') || resolvePermission(user, 'reseller.requests.approve') ||
  resolvePermission(user, 'partner_onboarding.approve');

const canWriteOnboarding = (user) => ['reseller.add', 'partner_onboarding.create', 'reseller.profile',
  'reseller.requests.approve', 'users.manage'].some((permission) => resolvePermission(user, permission));

// Apply the same approval policy to every endpoint that writes a status.
const onboardingStatusError = (user, submittedBy, target, currentStatus) => {
  if (target === 'converted') return { status: 400, message: 'Use the conversion endpoint to convert an onboarding.' };
  if (target === currentStatus || ![target, currentStatus].some((status) => ['verified', 'approved', 'rejected'].includes(status))) return null;
  const superAdmin = isSuperAdmin(user);
  if (!superAdmin && Number(submittedBy) === Number(user?.id) &&
      [target, currentStatus].some((status) => ['verified', 'approved'].includes(status))) {
    return { status: 403, message: 'You cannot approve your own submission.' };
  }
  return canReviewOnboarding(user) ? null : { status: 403, message: 'Approve permission required' };
};

// Approved stage data is authoritative, even when the overall status is unchanged.
const prepareOnboardingApprovals = (user, submittedBy, approvals, previous = []) => {
  const allowedStages = new Set(['Verified By / Onboarding Officer', 'Finance Verification',
    'Technical / NOC Verification', 'Management Approval']);
  if (!Array.isArray(approvals) || approvals.length > allowedStages.size) {
    return { error: { status: 400, message: 'Invalid onboarding approvals' } };
  }
  const prepared = [];
  const seen = new Set();
  const dateKey = (value) => {
    if (!value) return '';
    const text = String(value);
    const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
    if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  };
  for (const entry of approvals) {
    const stage = String(entry?.stage || '').trim();
    const status = String(entry?.status || 'pending').toLowerCase();
    if (!allowedStages.has(stage) || seen.has(stage) || !['pending', 'approved', 'rejected'].includes(status)) {
      return { error: { status: 400, message: 'Invalid onboarding approvals' } };
    }
    seen.add(stage);
    const old = previous.find((item) => item.stage === stage);
    const name = String(entry.name || '').trim();
    const signDate = dateKey(entry.signDate);
    const unchanged = old && status === old.status && name === String(old.approver_name || '').trim() &&
      signDate === dateKey(old.sign_date);
    if (!unchanged && (status !== 'pending' || (old && old.status !== 'pending'))) {
      if (!canReviewOnboarding(user) || (!isSuperAdmin(user) && Number(submittedBy) === Number(user?.id))) {
        return { error: { status: 403, message: 'Only an independent approver may change approval records' } };
      }
      prepared.push({ stage, status, name: String(user.full_name || user.employee_id || `Reviewer ${user.id}`),
        signDate: status === 'pending' ? '' : new Date().toISOString().slice(0, 10) });
    } else {
      prepared.push({ stage, status, name, signDate });
    }
  }
  return { approvals: prepared };
};

module.exports = { onboardingStatusError, canWriteOnboarding, prepareOnboardingApprovals };
