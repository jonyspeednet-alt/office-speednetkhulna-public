const LEGACY_ANSWER_KEYS = [
  'q1_technical',
  'q2_media',
  'q3_customercare',
  'q4_payment',
  'q5_service_satisfaction',
  'q6_time_satisfaction',
  'q7_technician_behavior',
];

const VERIFICATION_ATTEMPT_OUTCOMES = new Set([
  'in_progress',
  'completed',
  'no_answer',
  'busy',
  'callback_requested',
  'wrong_number',
  'incomplete',
  'abandoned',
]);

const getVerificationQuestionKeys = (ticket = {}) => {
  const categoryId = Number(ticket.category_id);
  const category = String(ticket.category || ticket.category_name || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  if (categoryId === 915 || category.includes('shifting')) return ['work_received', 'payment_made'];
  if (categoryId === 904 || category.includes('new_connection')) return ['connection_usable'];
  if (categoryId === 912 || ticket.is_qc_support === true || category.includes('qc')) {
    return ['connection_problem', 'speednet_rating'];
  }
  return ['support_understood', 'payment_made', 'team_satisfied'];
};

const hasVerificationAnswers = (verification) => {
  if (!verification) return false;
  if (
    verification.answers &&
    typeof verification.answers === 'object' &&
    !Array.isArray(verification.answers) &&
    Object.keys(verification.answers).length > 0
  ) {
    return true;
  }
  return LEGACY_ANSWER_KEYS.some((key) => verification[key] !== null && verification[key] !== undefined);
};

module.exports = {
  LEGACY_ANSWER_KEYS,
  VERIFICATION_ATTEMPT_OUTCOMES,
  getVerificationQuestionKeys,
  hasVerificationAnswers,
};
