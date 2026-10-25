import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime as formatDateTimeValue } from '../utils/formatters';
import {
  finishVerificationCallAttempt,
  getVerificationCallAnalytics,
  getVerificationCallQueue,
  getVerificationCallReport,
  exportVerificationCallMonth,
  startVerificationCallAttempt,
} from '../services/supportService';
import '../styles/SupportVerification.css';

const SupportTickets = lazy(() => import('./SupportTickets'));

const PAGE_SIZE = 20;
const EXPORT_PAGE_SIZE = 100;
const MAX_EXPORT_PAGES = 1000;
const ANALYTICS_VIEWS = ['daily', 'monthly', 'breakdown'];
const QUEUE_QUERY_KEY = ['supportVerification', 'queue'];
const REPORT_QUERY_KEY = ['supportVerification', 'report'];
const PHONE_FIELD_PATTERN = /(phone|mobile|telephone|contact[\s_-]*number)/i;
const BANGLADESH_MOBILE_PATTERN = /(^|\D)((?:\+?88[\s().-]*)?0?1[3-9](?:[\s().-]*\d){8})(?=$|\D)/g;

const OUTCOME_OPTIONS = [
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
  { value: 'callback_requested', label: 'Callback requested' },
  { value: 'wrong_number', label: 'Wrong number' },
];

const REPORT_OUTCOME_OPTIONS = [
  { value: 'completed', label: 'Verified' },
  { value: 'pending', label: 'Verification pending' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'no_answer', label: 'No answer' },
  { value: 'busy', label: 'Busy' },
  { value: 'callback_requested', label: 'Callback requested' },
  { value: 'wrong_number', label: 'Wrong number' },
  { value: 'incomplete', label: 'Incomplete call' },
  { value: 'abandoned', label: 'Abandoned' },
];

const ANALYTICS_OUTCOMES = [
  { key: 'completed', label: 'Completed' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'no_answer', label: 'No answer' },
  { key: 'busy', label: 'Busy' },
  { key: 'callback_requested', label: 'Callback' },
  { key: 'wrong_number', label: 'Wrong number' },
  { key: 'incomplete', label: 'Incomplete' },
  { key: 'abandoned', label: 'Abandoned' },
];

const VERIFICATION_CATEGORIES = [
  { value: 'shifting', label: 'Shifting' },
  { value: 'new_connection', label: 'New Connection' },
  { value: 'qc', label: 'QC' },
  { value: 'support', label: 'Support' },
];

const readPath = (source, path) => path.split('.').reduce((value, key) => value?.[key], source);

const firstValue = (source, paths) => {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
};

const isTruthyFlag = (value) => (
  value === true ||
  value === 1 ||
  ['1', 'true', 'yes', 'y'].includes(String(value ?? '').trim().toLowerCase())
);

const normalizeEnvelope = (response) => {
  const payload = response?.data && !Array.isArray(response.rows) ? response.data : response;
  return payload && typeof payload === 'object'
    ? { ...payload, rows: Array.isArray(payload.rows) ? payload.rows : [] }
    : { rows: [] };
};

const errorStatus = (error) => Number(error?.response?.status || error?.status || 0);

const isPermissionError = (error) => [401, 403].includes(errorStatus(error));

const isConflictError = (error) => (
  errorStatus(error) === 409 ||
  /conflict|already\s+(?:claimed|started|in progress)/i.test(
    String(error?.response?.data?.message || error?.message || '')
  )
);

const getErrorMessage = (error, fallback) => {
  if (isPermissionError(error)) return 'You do not have permission to access this verification call data.';
  return error?.response?.data?.message || error?.message || fallback;
};

const formatCount = (value) => {
  if (value === undefined || value === null || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : String(value);
};

const getLocalDateInput = () => {
  const date = new Date();
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return localDate.toISOString().slice(0, 10);
};

const formatPercent = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number.parseFloat(String(value).replace('%', ''));
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
};

const formatDateTime = (value) => {
  return formatDateTimeValue(value) || '—';
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const getTicketId = (row) => firstValue(row, ['ticket_id', 'id']);

const getTicketLabel = (row) => (
  firstValue(row, ['ticket_no', 'ticket_number', 'ticket_ref']) ||
  (getTicketId(row) ? `#${getTicketId(row)}` : '—')
);

const getComplaintNumber = (row) => String(firstValue(row, ['complaint_no', 'complaint_number']) || '').trim();

const getCustomerName = (row) => {
  const value = firstValue(row, [
    'customer_name',
    'customer_full_name',
    'customer_snapshot.name',
    'customer_snapshot.customer_name',
    'customer.name',
    'customer.full_name',
    'pppoe_username',
    'customer_snapshot.pppoe_username',
  ]);
  if (value) return typeof value === 'object' ? value.name || value.full_name || '—' : String(value);
  return typeof row?.customer === 'string' ? row.customer : '—';
};

const getCustomerPhone = (row) => {
  const value = firstValue(row, [
    'customer_phone',
    'phone_number',
    'mobile',
    'phone',
    'contact_number',
    'customer_snapshot.phone',
    'customer_snapshot.mobile',
    'customer.phone',
    'customer.mobile',
  ]);
  return value ? String(value) : '';
};

const getCategoryLabel = (row) => {
  const value = firstValue(row, [
    'category_name',
    'category_label',
    'category.name_bn',
    'category.name',
    'category.label',
    'category',
    'problem_category',
    'category_id',
  ]);
  if (value && typeof value === 'object') {
    return String(value.name_bn || value.name || value.label || value.id || '—');
  }
  return value ? String(value) : '—';
};

const getOfficeLabel = (row) => {
  const value = firstValue(row, [
    'office_name',
    'office.name',
    'office',
    'zone',
    'branch_name',
    'assigned_office',
  ]);
  if (value && typeof value === 'object') return String(value.name || value.label || '—');
  return value ? String(value) : '—';
};

const getSolvedAt = (row) => firstValue(row, [
  'solved_at',
  'solved_date',
  'closed_at',
  'resolved_at',
  'verification_eligible_at',
]);

const getLatestAttempt = (row) => (
  firstValue(row, ['latest_attempt', 'current_attempt', 'active_attempt']) || {}
);

const getLatestAttemptId = (row) => (
  firstValue(getLatestAttempt(row), ['id', 'attempt_id']) ||
  firstValue(row, ['latest_attempt_id', 'current_attempt_id'])
);

const getAttemptCount = (row) => {
  const value = firstValue(row, ['attempt_count', 'attempts_count', 'verification_attempt_count']);
  if (value !== undefined) return Number(value) || 0;
  return Array.isArray(row?.attempts) ? row.attempts.length : 0;
};

const getVerificationState = (row) => {
  const verified = [
    row?.is_verified,
    row?.current_verification?.is_verified,
    row?.verification?.is_verified,
  ].some(isTruthyFlag);
  if (verified) return 'completed';

  const stateValue = firstValue(row, [
    'verification_state',
    'current_verification.state',
    'current_verification.status',
    'verification.state',
    'verification.status',
    'verification_status',
  ]);
  const state = String(stateValue || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['verified', 'complete', 'completed', 'done', 'success', 'passed'].includes(state)) return 'completed';
  if (['in_progress', 'inprogress', 'calling', 'started', 'active'].includes(state)) return 'in_progress';
  if (state) return 'pending';

  const attempt = getLatestAttempt(row);
  const attemptState = String(firstValue(attempt, ['state', 'status']) || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['in_progress', 'inprogress', 'calling', 'started', 'active'].includes(attemptState)) return 'in_progress';
  if (attempt.started_at && !attempt.finished_at && !attempt.completed_at && !attempt.ended_at) return 'in_progress';
  return 'pending';
};

const getStateLabel = (state) => ({
  pending: 'Verification pending',
  in_progress: 'In progress',
  completed: 'Verified',
}[state] || 'Verification pending');

const getOutcomeValue = (row) => firstValue(row, [
  'outcome',
  'latest_outcome',
  'latest_attempt.outcome',
  'current_attempt.outcome',
  'verification.outcome',
]);

const getOutcomeLabel = (value) => {
  if (!value) return '—';
  const normalized = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const known = {
    verified: 'Verified',
    completed: 'Verified',
    success: 'Verified',
    no_answer: 'No answer',
    busy: 'Busy',
    callback_requested: 'Callback requested',
    wrong_number: 'Wrong number',
    incomplete: 'Incomplete call',
    abandoned: 'Abandoned',
  };
  return known[normalized] || String(value).replace(/[_-]+/g, ' ');
};

const getReportVerifiedBy = (row) => {
  const value = firstValue(row, [
    'latest_attempt.caller_name',
    'current_attempt.caller_name',
    'verified_by_name',
    'caller_name',
    'verified_by.name',
    'caller.name',
    'user_name',
  ]);
  return value ? String(value) : '—';
};

const getReportVerifiedAt = (row) => {
  const activityPaths = [
    'latest_attempt.started_at',
    'latest_attempt.ended_at',
    'latest_attempt.finished_at',
    'current_attempt.started_at',
    'current_attempt.ended_at',
  ];
  const verificationPaths = [
    'verified_at',
    'verification_at',
    'completed_at',
    'current_verification.verified_at',
    'verification.verified_at',
  ];
  return firstValue(row, getOutcomeValue(row) === 'completed'
    ? [...verificationPaths, ...activityPaths]
    : [...activityPaths, ...verificationPaths]);
};

const getReportFeedback = (row) => firstValue(row, [
  'feedback',
  'feedback_remarks',
  'customer_feedback',
  'verification_feedback',
  'current_verification.feedback',
  'verification.feedback',
  'latest_attempt.note',
  'current_attempt.note',
]);

const getAttemptHistory = (row) => {
  if (!Array.isArray(row?.attempt_history)) return [];
  return row.attempt_history
    .map((attempt, index) => ({
      attempt,
      index,
      startedAt: attempt?.started_at ? new Date(attempt.started_at).getTime() : Number.NaN,
    }))
    .sort((left, right) => {
      const leftValid = Number.isFinite(left.startedAt);
      const rightValid = Number.isFinite(right.startedAt);
      if (leftValid && rightValid && left.startedAt !== right.startedAt) return right.startedAt - left.startedAt;
      if (leftValid !== rightValid) return leftValid ? -1 : 1;
      return left.index - right.index;
    })
    .map(({ attempt }) => attempt);
};

const getAttemptCountLabel = (row) => {
  const count = getAttemptCount(row);
  if (count === 0 && getVerificationState(row) === 'completed') {
    return 'Historical verification; call attempts not tracked';
  }
  return `${formatCount(count)} attempt${count === 1 ? '' : 's'}`;
};

const getAnswerSource = (row) => firstValue(row, [
  'answers',
  'verification_answers',
  'legacy_answers',
  'answer_data',
  'responses',
  'verification.answers',
  'current_verification.answers',
]);

const parseStructuredString = (value) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
};

const collectAnswerEntries = (rawValue, { excludePhoneFields = false } = {}) => {
  const entries = [];
  const visit = (raw, label = 'Answer') => {
    const value = parseStructuredString(raw);
    if (value === undefined || value === null || value === '') return;

    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const question = firstValue(item, ['question', 'label', 'title', 'key', 'name']);
          const answer = firstValue(item, ['answer', 'response', 'value', 'text']);
          if (question && answer !== undefined) {
            if (excludePhoneFields && PHONE_FIELD_PATTERN.test(String(question))) return;
            visit(answer, String(question));
          } else {
            visit(item, `${label} ${index + 1}`);
          }
        } else {
          visit(item, `${label} ${index + 1}`);
        }
      });
      return;
    }

    if (typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => {
        if (excludePhoneFields && PHONE_FIELD_PATTERN.test(key)) return;
        visit(child, label === 'Answer' ? key : `${label} · ${key}`);
      });
      return;
    }

    entries.push([label, String(value)]);
  };

  visit(rawValue);
  return entries;
};

const getAnswerEntries = (row, options) => collectAnswerEntries(getAnswerSource(row), options);

const isCorrectionRecord = (row) => {
  if (Number(row?.correction_count) > 0) return true;
  const direct = firstValue(row, ['is_correction', 'has_correction', 'correction']);
  if (direct !== undefined && isTruthyFlag(direct)) return true;
  return Boolean(firstValue(row, ['correction_of', 'corrected_from', 'correction_id', 'revision_of']));
};

const isLegacyRecord = (row) => {
  const direct = firstValue(row, ['is_legacy', 'legacy', 'legacy_format', 'is_legacy_record']);
  if (direct !== undefined && isTruthyFlag(direct)) return true;
  return /legacy/i.test(String(firstValue(row, ['source', 'record_type', 'format']) || ''));
};

const normalizeCategoryOptions = (byCategory) => {
  const counts = new Map(
    (Array.isArray(byCategory) ? byCategory : [])
      .filter((item) => item?.verification_type)
      .map((item) => [String(item.verification_type), item])
  );
  return VERIFICATION_CATEGORIES.map(({ value, label }) => {
    const stats = counts.get(value) || {};
    const eligible = Number(stats.eligible) || 0;
    return {
      value,
      label,
      count: eligible,
      eligible,
      completed: Number(stats.completed) || 0,
      pending: Number(stats.pending) || 0,
      in_progress: Number(stats.in_progress) || 0,
    };
  });
};

const sortOldestFirst = (rows) => [...rows].sort((left, right) => {
  const leftValue = getSolvedAt(left) ? new Date(getSolvedAt(left)).getTime() : Number.POSITIVE_INFINITY;
  const rightValue = getSolvedAt(right) ? new Date(getSolvedAt(right)).getTime() : Number.POSITIVE_INFINITY;
  const leftTime = Number.isNaN(leftValue) ? Number.POSITIVE_INFINITY : leftValue;
  const rightTime = Number.isNaN(rightValue) ? Number.POSITIVE_INFINITY : rightValue;
  return leftTime - rightTime;
});

const redactPhoneLikeText = (value) => String(value ?? '').replace(
  BANGLADESH_MOBILE_PATTERN,
  '$1[redacted]'
);

const safeCsvCell = (value) => {
  const text = redactPhoneLikeText(value).replace(/\r\n?/g, '\n');
  const protectedText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replace(/"/g, '""')}"`;
};

const getAttemptHistoryExportText = (row) => {
  const attempts = getAttemptHistory(row);
  if (!attempts.length && getVerificationState(row) === 'completed') {
    return 'Historical verification recorded; individual call attempts were not tracked.';
  }
  return attempts.map((attempt, index) => {
    const caller = redactPhoneLikeText(attempt?.caller_name || 'Caller not recorded').trim();
    const outcome = redactPhoneLikeText(getOutcomeLabel(attempt?.outcome)).trim();
    const note = redactPhoneLikeText(attempt?.note || '').trim();
    return [
      `Attempt ${index + 1}`,
      `Outcome: ${outcome}`,
      `Caller: ${caller}`,
      `Started: ${formatDateTime(attempt?.started_at)}`,
      `Ended: ${formatDateTime(attempt?.ended_at)}`,
      note ? `Note: ${note}` : '',
    ].filter(Boolean).join(' | ');
  })
  .join('\n');
};

const makeReportCsv = (rows) => {
  const headers = [
    'Ticket',
    'Complaint No',
    'Customer',
    'Category',
    'Office',
    'Outcome',
    'Verification answers',
    'Call note / feedback',
    'Latest caller',
    'Activity at',
    'Attempt count',
    'Attempt history',
    'Correction',
    'Legacy record',
  ];
  const records = rows.map((row) => [
    getTicketLabel(row),
    getComplaintNumber(row),
    getCustomerName(row),
    getCategoryLabel(row),
    getOfficeLabel(row),
    getOutcomeLabel(getOutcomeValue(row)),
    getAnswerEntries(row, { excludePhoneFields: true })
      .map(([label, answer]) => `${label}: ${answer}`)
      .join(' | '),
    getReportFeedback(row) || '',
    getReportVerifiedBy(row),
    formatDateTime(getReportVerifiedAt(row)),
    getAttemptCountLabel(row),
    getAttemptHistoryExportText(row),
    isCorrectionRecord(row) ? 'Yes' : 'No',
    isLegacyRecord(row) ? 'Yes' : 'No',
  ]);

  return [headers, ...records].map((record) => record.map(safeCsvCell).join(',')).join('\r\n');
};

const getPagination = (data, fallbackPage) => {
  const total = Math.max(0, Number(data?.total ?? data?.rows?.length ?? 0) || 0);
  const page = Math.max(1, Number(data?.page ?? fallbackPage) || 1);
  const limit = Math.max(1, Number(data?.limit) || PAGE_SIZE);
  const totalPages = Math.max(1, Number(data?.totalPages) || 1);
  return {
    total,
    page,
    limit,
    totalPages,
    from: total ? ((page - 1) * limit) + 1 : 0,
    to: Math.min(page * limit, total),
  };
};

const ErrorState = ({ denied, title, message, onRetry }) => (
  <div className={`sv-state sv-state--error${denied ? ' sv-state--denied' : ''}`} role="alert">
    <span className="sv-state-icon" aria-hidden="true">
      <i className={`fa-solid ${denied ? 'fa-lock' : 'fa-triangle-exclamation'}`} />
    </span>
    <strong>{title}</strong>
    <span>{message}</span>
    {!denied && onRetry && (
      <button type="button" className="sv-button sv-button--quiet" onClick={onRetry}>
        <i className="fa-solid fa-rotate-right" aria-hidden="true" /> Retry
      </button>
    )}
  </div>
);

const LoadingState = ({ label }) => (
  <div className="sv-state" role="status" aria-live="polite">
    <span className="sv-spinner" aria-hidden="true" />
    <strong>{label}</strong>
    <span>Please wait while the latest records load.</span>
  </div>
);

const Pagination = ({ label, page, totalPages, range, onPageChange, disabled }) => (
  <nav className="sv-pagination" aria-label={`${label} pagination`}>
    <span className="sv-pagination-range">
      {range.total
        ? <>Showing <strong>{formatCount(range.from)}–{formatCount(range.to)}</strong> of <strong>{formatCount(range.total)}</strong></>
        : 'No records'}
    </span>
    <div className="sv-pagination-controls">
      <button
        type="button"
        className="sv-button sv-button--quiet"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={disabled || page <= 1}
        aria-label="Previous page"
      >
        <i className="fa-solid fa-chevron-left" aria-hidden="true" /> Previous
      </button>
      <span aria-live="polite">Page <strong>{page}</strong> of <strong>{totalPages}</strong></span>
      <button
        type="button"
        className="sv-button sv-button--quiet"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={disabled || page >= totalPages}
        aria-label="Next page"
      >
        Next <i className="fa-solid fa-chevron-right" aria-hidden="true" />
      </button>
    </div>
  </nav>
);

const AnswerSummary = ({ row }) => {
  const entries = getAnswerEntries(row);
  if (!entries.length) return <span className="sv-dim">No answers recorded</span>;
  const visibleEntries = entries.slice(0, 2);
  const remainingEntries = entries.slice(2);
  return (
    <div className="sv-answer-summary">
      <ul>
        {visibleEntries.map(([label, value], index) => (
          <li key={`${label}-${index}`}>
            <span>{label}</span>
            <strong>{value}</strong>
          </li>
        ))}
      </ul>
      {remainingEntries.length > 0 && (
        <details className="sv-answer-details">
          <summary>View {remainingEntries.length} more answer{remainingEntries.length === 1 ? '' : 's'}</summary>
          <ul>
            {remainingEntries.map(([label, value], index) => (
              <li key={`${label}-${index}`}>
                <span>{label}</span>
                <strong>{value}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};

const AttemptHistory = ({ row }) => {
  const attempts = getAttemptHistory(row);

  return (
    <details className="sv-attempt-history">
      <summary>
        <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
        <span>Attempt history</span>
        <strong>{formatCount(attempts.length)}</strong>
        <i className="fa-solid fa-chevron-down sv-attempt-history-chevron" aria-hidden="true" />
      </summary>
      {attempts.length ? (
        <ol className="sv-attempt-history-list">
          {attempts.map((attempt, index) => {
            const caller = redactPhoneLikeText(attempt?.caller_name || 'Caller not recorded');
            const outcome = redactPhoneLikeText(getOutcomeLabel(attempt?.outcome));
            const note = redactPhoneLikeText(attempt?.note || '').trim();
            return (
              <li key={attempt?.id || `${attempt?.started_at || 'attempt'}-${index}`}>
                <div className="sv-attempt-history-heading">
                  <span className="sv-history-outcome">{outcome}</span>
                  <span className="sv-history-started">{formatDateTime(attempt?.started_at)}</span>
                </div>
                <div className="sv-history-caller">
                  <i className="fa-solid fa-user" aria-hidden="true" />
                  <span>{caller}</span>
                </div>
                <dl className="sv-history-times">
                  <div><dt>Started</dt><dd>{formatDateTime(attempt?.started_at)}</dd></div>
                  <div><dt>Ended</dt><dd>{formatDateTime(attempt?.ended_at)}</dd></div>
                </dl>
                {note && <p className="sv-history-note"><strong>Note</strong> {note}</p>}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="sv-history-empty">
          <i className="fa-solid fa-circle-info" aria-hidden="true" />
          <span>
            {getVerificationState(row) === 'completed'
              ? 'Verification is recorded, but individual call attempts were not tracked for this historical ticket.'
              : 'No call attempts are recorded for this ticket.'}
          </span>
        </p>
      )}
    </details>
  );
};

const AnalyticsPanel = ({
  activeTab,
  analyticsDate,
  analyticsMonth,
  analyticsData,
  analyticsQuery,
  analyticsExportState,
  onDateChange,
  onMonthChange,
  onExport,
}) => (
  <section
    id="sv-analytics-panel"
    className="sv-panel"
    role="tabpanel"
    aria-labelledby={activeTab === 'daily' ? 'sv-daily-tab' : activeTab === 'monthly' ? 'sv-monthly-tab' : 'sv-breakdown-tab'}
    aria-busy={analyticsQuery.isFetching}
  >
    <div className="sv-filter-panel">
      <div className="sv-filter-heading">
        <div>
          <span className="sv-section-kicker">CALL ACTIVITY</span>
          <h2>{activeTab === 'daily' ? 'Daily employee call report' : activeTab === 'monthly' ? 'Monthly employee call report' : 'Monthly office and employee breakdown'}</h2>
          <p>
            {activeTab === 'daily'
              ? 'Call attempts are counted by the employee who started each call, using Bangladesh local time.'
              : 'Each started call attempt is counted, including retries and calls still in progress.'}
          </p>
        </div>
        <div className="sv-report-export">
          {activeTab === 'daily' ? (
            <label className="sv-field" htmlFor="sv-analytics-date">
              <span className="sv-filter-label">Report date</span>
              <input
                id="sv-analytics-date"
                className="sv-control"
                type="date"
                value={analyticsDate}
                onChange={(event) => onDateChange(event.target.value)}
              />
            </label>
          ) : (
            <label className="sv-field" htmlFor="sv-analytics-month">
              <span className="sv-filter-label">Report month</span>
              <input
                id="sv-analytics-month"
                className="sv-control"
                type="month"
                value={analyticsMonth}
                onChange={(event) => onMonthChange(event.target.value)}
              />
            </label>
          )}
          {activeTab !== 'daily' && (
            <button
              type="button"
              className="sv-button sv-button--export"
              onClick={onExport}
              disabled={!analyticsMonth || analyticsExportState?.kind === 'loading'}
            >
              <i className={`fa-solid ${analyticsExportState?.kind === 'loading' ? 'fa-spinner fa-spin' : 'fa-download'}`} aria-hidden="true" />
              {analyticsExportState?.kind === 'loading' ? 'Preparing backup…' : 'Download full month CSV'}
            </button>
          )}
        </div>
      </div>
      {analyticsExportState && (
        <div className={`sv-export-status sv-export-status--${analyticsExportState.kind}`} role={analyticsExportState.kind === 'error' ? 'alert' : 'status'}>
          <span>{analyticsExportState.message}</span>
        </div>
      )}
    </div>

    {!(activeTab === 'daily' ? analyticsDate : analyticsMonth) ? (
      <div className="sv-state sv-state--validation" role="status">
        <span className="sv-state-icon" aria-hidden="true"><i className="fa-solid fa-calendar-xmark" /></span>
        <strong>Select a report period</strong>
        <span>Choose a date or month to load call totals.</span>
      </div>
    ) : analyticsQuery.isError && (isPermissionError(analyticsQuery.error) || !analyticsQuery.data) ? (
      <ErrorState
        denied={isPermissionError(analyticsQuery.error)}
        title={isPermissionError(analyticsQuery.error) ? 'Call analytics restricted' : 'Call analytics could not be loaded'}
        message={getErrorMessage(analyticsQuery.error, 'The call analytics report is temporarily unavailable.')}
        onRetry={() => analyticsQuery.refetch()}
      />
    ) : analyticsQuery.isLoading ? (
      <LoadingState label="Loading call analytics…" />
    ) : analyticsQuery.isError ? (
      <div className="sv-inline-error" role="alert">
        <span>{getErrorMessage(analyticsQuery.error, 'Could not refresh call analytics.')}</span>
        <button type="button" className="sv-button sv-button--quiet" onClick={() => analyticsQuery.refetch()}>Retry</button>
      </div>
    ) : (
      <section className="sv-table-card" aria-label="Employee call analytics">
        <div className="sv-table-heading">
          <div>
            <span className="sv-section-kicker">{activeTab === 'daily' ? analyticsDate : analyticsMonth}</span>
            <h2>{activeTab === 'breakdown' ? 'Calls by office and employee' : 'Calls by employee'}</h2>
            <p>Total calls include every attempt and older verified records whose individual attempts were not tracked; repeated calls count separately when available.</p>
          </div>
          <span className="sv-record-count">{formatCount(analyticsData.rows.length)} rows</span>
        </div>
        {!analyticsData.rows.length ? (
          <div className="sv-state sv-state--empty" role="status">
            <span className="sv-state-icon" aria-hidden="true"><i className="fa-solid fa-phone-slash" /></span>
            <strong>No call attempts found</strong>
            <span>There are no recorded call attempts for this report period and office scope.</span>
          </div>
        ) : (
          <div className="sv-table-scroll" role="region" aria-label="Employee call count table" tabIndex="0">
            <table className="sv-table sv-analytics-table">
              <thead>
                <tr>
                  {activeTab === 'breakdown' && <th scope="col">Employee office</th>}
                  <th scope="col">Employee</th>
                  <th scope="col">Total calls</th>
                  <th scope="col">Tickets</th>
                  {ANALYTICS_OUTCOMES.map((outcome) => <th scope="col" key={outcome.key}>{outcome.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {analyticsData.rows.map((row, index) => (
                  <tr key={`${row.office_name || ''}-${row.caller_id || 'unassigned'}-${index}`}>
                    {activeTab === 'breakdown' && <td data-label="Employee office"><strong>{row.office_name || 'Unknown office'}</strong></td>}
                    <td data-label="Employee">
                      <div className="sv-ticket-cell">
                        <strong>{row.caller_name || 'Unassigned'}</strong>
                        {row.caller_employee_id
                          ? <span>Employee ID: {row.caller_employee_id}</span>
                          : row.caller_id && <span>Account ID: {row.caller_id}</span>}
                      </div>
                    </td>
                    <td data-label="Total calls"><strong>{formatCount(row.total_calls)}</strong></td>
                    <td data-label="Tickets">{formatCount(row.unique_tickets)}</td>
                    {ANALYTICS_OUTCOMES.map((outcome) => (
                      <td data-label={outcome.label} key={outcome.key}>{formatCount(row[outcome.key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    )}
  </section>
);

const SupportVerification = () => {
  const location = useLocation();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState('queue');
  const [queuePage, setQueuePage] = useState(1);
  const [queueCategory, setQueueCategory] = useState('');
  const [queueOffice, setQueueOffice] = useState('');
  const [queueSearch, setQueueSearch] = useState('');
  const [debouncedQueueSearch, setDebouncedQueueSearch] = useState('');
  const [queueSolvedFrom, setQueueSolvedFrom] = useState('');
  const [queueSolvedTo, setQueueSolvedTo] = useState('');
  const [queueStateFilter, setQueueStateFilter] = useState('');
  const [reportPage, setReportPage] = useState(1);
  const [reportSearch, setReportSearch] = useState('');
  const [debouncedReportSearch, setDebouncedReportSearch] = useState('');
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportCategory, setReportCategory] = useState('');
  const [reportCallerId, setReportCallerId] = useState('');
  const [reportOutcome, setReportOutcome] = useState('');
  const [analyticsDate, setAnalyticsDate] = useState(getLocalDateInput);
  const [analyticsMonth, setAnalyticsMonth] = useState(() => getLocalDateInput().slice(0, 7));
  const [analyticsExportState, setAnalyticsExportState] = useState(null);
  const [queueActionMessage, setQueueActionMessage] = useState(null);
  const [complaintCopyStatus, setComplaintCopyStatus] = useState(null);
  const [startingTicketId, setStartingTicketId] = useState(null);
  const [outcomeTicketId, setOutcomeTicketId] = useState(null);
  const [outcomeDraft, setOutcomeDraft] = useState({ outcome: OUTCOME_OPTIONS[0].value, note: '' });
  const [finishingTicketId, setFinishingTicketId] = useState(null);
  const [exportState, setExportState] = useState(null);
  const [ticketModalId, setTicketModalId] = useState(null);
  const [verificationModalTicket, setVerificationModalTicket] = useState(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQueueSearch(queueSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [queueSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedReportSearch(reportSearch.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [reportSearch]);

  useEffect(() => {
    if (!location.state?.verificationCallReturn) return;
    setActiveTab('queue');
    queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
    queryClient.invalidateQueries({ queryKey: REPORT_QUERY_KEY });
  }, [location.key, location.state, queryClient]);

  const queueType = activeTab === 'follow_up' ? 'follow_up' : 'first';
  const queueParams = useMemo(() => ({
    page: queuePage,
    limit: PAGE_SIZE,
    queue_type: queueType,
    ...(queueCategory ? { category: queueCategory } : {}),
    ...(queueOffice ? { office: queueOffice } : {}),
    ...(debouncedQueueSearch ? { q: debouncedQueueSearch } : {}),
    ...(queueSolvedFrom ? { from: queueSolvedFrom } : {}),
    ...(queueSolvedTo ? { to: queueSolvedTo } : {}),
    ...(queueStateFilter ? { state: queueStateFilter } : {}),
  }), [queuePage, queueType, queueCategory, queueOffice, debouncedQueueSearch, queueSolvedFrom, queueSolvedTo, queueStateFilter]);

  const analyticsView = ANALYTICS_VIEWS.includes(activeTab);
  const analyticsParams = useMemo(() => (
    activeTab === 'daily'
      ? { view: 'daily', date: analyticsDate }
      : { view: activeTab, month: analyticsMonth }
  ), [activeTab, analyticsDate, analyticsMonth]);
  const reportDateRangeInvalid = Boolean(reportFrom && reportTo && reportFrom > reportTo);
  const queueDateRangeInvalid = Boolean(queueSolvedFrom && queueSolvedTo && queueSolvedFrom > queueSolvedTo);
  const reportParams = useMemo(() => ({
    page: reportPage,
    limit: PAGE_SIZE,
    ...(reportFrom ? { from: reportFrom } : {}),
    ...(reportTo ? { to: reportTo } : {}),
    ...(reportCategory ? { category: reportCategory } : {}),
    ...(reportCallerId.trim() ? { caller_id: reportCallerId.trim() } : {}),
    ...(reportOutcome ? { outcome: reportOutcome } : {}),
    ...(debouncedReportSearch ? { q: debouncedReportSearch } : {}),
  }), [reportPage, reportFrom, reportTo, reportCategory, reportCallerId, reportOutcome, debouncedReportSearch]);

  const queueQuery = useQuery({
    queryKey: [...QUEUE_QUERY_KEY, queueParams],
    queryFn: () => getVerificationCallQueue(queueParams),
    enabled: ['queue', 'follow_up'].includes(activeTab) && !queueDateRangeInvalid,
    placeholderData: keepPreviousData,
  });

  const reportQuery = useQuery({
    queryKey: [...REPORT_QUERY_KEY, reportParams],
    queryFn: () => getVerificationCallReport(reportParams),
    enabled: activeTab === 'report' && !reportDateRangeInvalid,
    placeholderData: keepPreviousData,
  });

  const analyticsQuery = useQuery({
    queryKey: ['supportVerification', 'analytics', analyticsParams],
    queryFn: () => getVerificationCallAnalytics(analyticsParams),
    enabled: analyticsView && Boolean(activeTab === 'daily' ? analyticsDate : analyticsMonth),
  });

  const queueData = useMemo(() => normalizeEnvelope(queueQuery.data), [queueQuery.data]);
  const reportData = useMemo(() => normalizeEnvelope(reportQuery.data), [reportQuery.data]);
  const analyticsData = useMemo(() => normalizeEnvelope(analyticsQuery.data), [analyticsQuery.data]);
  const queueRowsFromServer = queueData.rows;
  const queueRows = useMemo(() => sortOldestFirst(queueRowsFromServer), [queueRowsFromServer]);

  const queueCategories = useMemo(
    () => normalizeCategoryOptions(queueData.summary?.by_category),
    [queueData.summary]
  );
  const queueOffices = useMemo(
    () => [...new Set((Array.isArray(queueData.office_options) ? queueData.office_options : [])
      .map((office) => String(office || '').trim())
      .filter(Boolean))],
    [queueData.office_options]
  );
  const reportCategories = VERIFICATION_CATEGORIES;
  const reportOutcomeOptions = REPORT_OUTCOME_OPTIONS;

  const activeSummary = queueData.summary || reportData.summary;
  const categoryProgress = normalizeCategoryOptions(
    activeSummary?.by_category
  );
  const completionRate = formatPercent(activeSummary?.completion_rate);
  const eligibleCount = activeSummary?.eligible;
  const completedCount = activeSummary?.completed;
  const queuePagination = getPagination(queueData, queuePage);
  const reportPagination = getPagination(reportData, reportPage);
  const reportTotal = reportPagination.total;
  const queueSearchPending = queueSearch.trim() !== debouncedQueueSearch;
  const reportSearchPending = reportSearch.trim() !== debouncedReportSearch;
  const queueIsLoading = queueQuery.isLoading || (queueQuery.isFetching && queueQuery.isPlaceholderData);
  const reportIsLoading = reportQuery.isLoading || (reportQuery.isFetching && reportQuery.isPlaceholderData);
  const startMutation = useMutation({
    mutationFn: (ticketId) => startVerificationCallAttempt(ticketId),
    retry: false,
  });
  const finishMutation = useMutation({
    mutationFn: ({ ticketId, attemptId, data }) => finishVerificationCallAttempt(ticketId, attemptId, data),
    retry: false,
  });
  const isStarting = Boolean(startMutation.isLoading || startMutation.isPending);
  const isFinishing = Boolean(finishMutation.isLoading || finishMutation.isPending);
  const canCall = queueData.can_call === true;

  const showQueueActionError = (error, fallback) => {
    const conflict = isConflictError(error);
    const denied = isPermissionError(error);
    setQueueActionMessage({
      kind: conflict ? 'conflict' : denied ? 'denied' : 'error',
      title: conflict ? 'This call was claimed by another operator.' : denied ? 'Permission denied' : 'Call action failed',
      message: getErrorMessage(error, fallback),
    });
  };

  const refreshQueue = async () => {
    if (queueDateRangeInvalid) return;
    setQueueActionMessage(null);
    const result = await queueQuery.refetch();
    if (result.error) {
      showQueueActionError(result.error, 'The queue could not be refreshed.');
    }
  };

  const openTicket = (ticketId) => {
    if (!ticketId) return;
    setTicketModalId(Number(ticketId));
  };

  const copyComplaintNumber = async (complaintNumber) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable in this browser.');
      }
      await navigator.clipboard.writeText(complaintNumber);
      setComplaintCopyStatus({ complaintNumber, copied: true });
    } catch (error) {
      setComplaintCopyStatus({ complaintNumber, copied: false, message: error?.message || 'Clipboard access was denied.' });
    }
  };

  const openVerificationForm = async (ticketId) => {
    if (!ticketId) return;
    if (!canCall) {
      setQueueActionMessage({
        kind: 'denied',
        title: 'Call actions are restricted',
        message: 'Your account can view this queue but cannot start verification calls.',
      });
      return;
    }
    setQueueActionMessage(null);
    setStartingTicketId(String(ticketId));
    try {
      const result = await startMutation.mutateAsync(ticketId);
      const attempt = result?.attempt || result?.data?.attempt;
      if (!attempt?.id) throw new Error('The server did not return a verification attempt ID.');
      queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
      setVerificationModalTicket({
        ...queueRows.find((row) => String(getTicketId(row)) === String(ticketId)),
        id: Number(ticketId),
        verification_attempt_id: Number(attempt.id),
      });
    } catch (error) {
      showQueueActionError(error, 'The verification call could not be started.');
    } finally {
      setStartingTicketId(null);
    }
  };

  const submitOutcome = async (event, row) => {
    event.preventDefault();
    const ticketId = getTicketId(row);
    const attemptId = getLatestAttemptId(row);
    if (!ticketId || !attemptId) {
      setQueueActionMessage({
        kind: 'error',
        title: 'Attempt details unavailable',
        message: 'Refresh the queue before logging an outcome for this call.',
      });
      return;
    }

    setQueueActionMessage(null);
    setFinishingTicketId(String(ticketId));
    try {
      await finishMutation.mutateAsync({
        ticketId,
        attemptId,
        data: {
          outcome: outcomeDraft.outcome,
          note: outcomeDraft.note.trim(),
        },
      });
      setOutcomeTicketId(null);
      setOutcomeDraft({ outcome: OUTCOME_OPTIONS[0].value, note: '' });
      queryClient.invalidateQueries({ queryKey: QUEUE_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: REPORT_QUERY_KEY });
    } catch (error) {
      showQueueActionError(error, 'The call outcome could not be saved.');
    } finally {
      setFinishingTicketId(null);
    }
  };

  const resetQueueFilters = () => {
    setQueueCategory('');
    setQueueOffice('');
    setQueueSearch('');
    setDebouncedQueueSearch('');
    setQueueSolvedFrom('');
    setQueueSolvedTo('');
    setQueueStateFilter('');
    setQueuePage(1);
  };

  const resetReportFilters = () => {
    setReportSearch('');
    setDebouncedReportSearch('');
    setReportFrom('');
    setReportTo('');
    setReportCategory('');
    setReportCallerId('');
    setReportOutcome('');
    setReportPage(1);
    setExportState(null);
  };

  const exportFilteredReport = async () => {
    if (reportDateRangeInvalid || reportSearchPending) return;
    setExportState({ kind: 'loading', message: 'Preparing all filtered report rows…' });
    const filters = {
      limit: EXPORT_PAGE_SIZE,
      ...(reportFrom ? { from: reportFrom } : {}),
      ...(reportTo ? { to: reportTo } : {}),
      ...(reportCategory ? { category: reportCategory } : {}),
      ...(reportCallerId.trim() ? { caller_id: reportCallerId.trim() } : {}),
      ...(reportOutcome ? { outcome: reportOutcome } : {}),
      ...(debouncedReportSearch ? { q: debouncedReportSearch } : {}),
    };

    try {
      const allRows = [];
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages && page <= MAX_EXPORT_PAGES) {
        const response = normalizeEnvelope(await getVerificationCallReport({ ...filters, page }));
        allRows.push(...response.rows);
        totalPages = Math.max(1, Number(response.totalPages) || 1);
        if (!response.rows.length) {
          if (page < totalPages) throw new Error('A report page could not be loaded, so the export is incomplete.');
          break;
        }
        page += 1;
      }
      if (page <= totalPages && page > MAX_EXPORT_PAGES) {
        throw new Error('This filtered report is too large to export in one request.');
      }
      if (!allRows.length) {
        setExportState({ kind: 'empty', message: 'No filtered report rows are available to export.' });
        return;
      }

      const csv = `\uFEFF${makeReportCsv(allRows)}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `verification-call-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportState({ kind: 'success', message: `Exported ${formatCount(allRows.length)} filtered report rows.` });
    } catch (error) {
      setExportState({
        kind: 'error',
        message: getErrorMessage(error, 'The filtered report could not be exported.'),
      });
    }
  };

  const exportMonthlyCalls = async () => {
    if (!analyticsMonth) return;
    setAnalyticsExportState({ kind: 'loading', message: 'Preparing the full monthly call backup…' });
    try {
      const response = await exportVerificationCallMonth(analyticsMonth);
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `verification-call-details-${analyticsMonth}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setAnalyticsExportState({ kind: 'success', message: `Downloaded all call attempts for ${analyticsMonth}.` });
    } catch (error) {
      setAnalyticsExportState({
        kind: 'error',
        message: getErrorMessage(error, 'The monthly call backup could not be downloaded.'),
      });
    }
  };

  return (
    <main className="sv-page" aria-labelledby="sv-page-title">
      <header className="sv-header">
        <div className="sv-header-title">
          <span className="sv-header-mark" aria-hidden="true">
            <i className="fa-solid fa-headset" />
          </span>
          <div className="sv-header-copy">
            <span className="sv-eyebrow">OPERATIONS · CUSTOMER CARE</span>
            <h1 id="sv-page-title">
              Verification Call
              <span lang="bn">যাচাইকরণ কল</span>
            </h1>
            <p>এক নজরে কল কিউ, অগ্রগতি এবং সম্পন্ন যাচাইয়ের রিপোর্ট দেখুন।</p>
          </div>
        </div>
        <div className="sv-header-actions">
          <div className="sv-cutoff">
            <span>QUEUE SCOPE</span>
            <strong>All solved tickets</strong>
          </div>
        </div>
      </header>

      {!analyticsView && (
      <>
      <section className="sv-progress-panel" aria-label="Verification progress">
        <div className="sv-progress-copy">
          <span className="sv-progress-kicker">TEAM PROGRESS</span>
          <strong>{formatCount(completedCount)} <span>of</span> {formatCount(eligibleCount)} completed</strong>
        </div>
        <div
          className="sv-progress-track"
          role="progressbar"
          aria-label="Verification completion rate"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={completionRate ?? 0}
        >
          <span style={{ width: `${completionRate ?? 0}%` }} />
        </div>
        <div className="sv-progress-rate">
          <strong>{completionRate === null ? '—' : `${completionRate.toFixed(completionRate % 1 ? 1 : 0)}%`}</strong>
          <span>completion rate</span>
        </div>
        <div className="sv-category-progress" aria-label="Verification call counts by category">
          {categoryProgress.some((category) => category.eligible > 0) ? categoryProgress
            .filter((category) => category.eligible > 0)
            .map((category) => (
            <span className="sv-category-progress-item" key={category.value}>
              <span>{category.label}</span>
              <strong>{formatCount(category.completed)} / {formatCount(category.eligible)}</strong>
            </span>
          )) : <span className="sv-category-progress-empty">Category totals appear when data is available.</span>}
        </div>
      </section>

      <section className="sv-kpi-grid" aria-label="Verification call summary">
        <article className="sv-kpi sv-kpi--eligible">
          <span className="sv-kpi-icon" aria-hidden="true"><i className="fa-solid fa-inbox" /></span>
          <div><span>Eligible</span><strong>{formatCount(activeSummary?.eligible)}</strong></div>
        </article>
        <article className="sv-kpi sv-kpi--completed">
          <span className="sv-kpi-icon" aria-hidden="true"><i className="fa-solid fa-circle-check" /></span>
          <div><span>Completed</span><strong>{formatCount(activeSummary?.completed)}</strong></div>
        </article>
        <article className="sv-kpi sv-kpi--pending">
          <span className="sv-kpi-icon" aria-hidden="true"><i className="fa-solid fa-hourglass-half" /></span>
          <div><span>Verification pending</span><strong>{formatCount(activeSummary?.pending)}</strong></div>
        </article>
        <article className="sv-kpi sv-kpi--progress">
          <span className="sv-kpi-icon" aria-hidden="true"><i className="fa-solid fa-phone" /></span>
          <div><span>In progress</span><strong>{formatCount(activeSummary?.in_progress)}</strong></div>
        </article>
        <article className="sv-kpi sv-kpi--rate">
          <span className="sv-kpi-icon" aria-hidden="true"><i className="fa-solid fa-chart-simple" /></span>
          <div>
            <span>Completion rate</span>
            <strong>{completionRate === null ? '—' : `${completionRate.toFixed(completionRate % 1 ? 1 : 0)}%`}</strong>
          </div>
        </article>
      </section>
      </>
      )}

      <div className="sv-tabs" role="tablist" aria-label="Verification call views">
        <button
          id="sv-queue-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'queue'}
          aria-controls="sv-queue-panel"
          className={activeTab === 'queue' ? 'is-active' : ''}
          onClick={() => { setActiveTab('queue'); setQueuePage(1); }}
        >
          <i className="fa-solid fa-list-check" aria-hidden="true" /> Tickets awaiting verification
          {activeTab === 'queue' && <span className="sv-tab-count">{formatCount(queuePagination.total)}</span>}
        </button>
        <button
          id="sv-follow-up-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'follow_up'}
          aria-controls="sv-queue-panel"
          className={activeTab === 'follow_up' ? 'is-active' : ''}
          onClick={() => { setActiveTab('follow_up'); setQueuePage(1); }}
        >
          <i className="fa-solid fa-phone-arrow-up-right" aria-hidden="true" /> Call follow-up
          {activeTab === 'follow_up' && <span className="sv-tab-count">{formatCount(queuePagination.total)}</span>}
        </button>
        <button
          id="sv-daily-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'daily'}
          aria-controls="sv-analytics-panel"
          className={activeTab === 'daily' ? 'is-active' : ''}
          onClick={() => setActiveTab('daily')}
        >
          <i className="fa-solid fa-calendar-day" aria-hidden="true" /> Daily Report
          {activeTab === 'daily' && <span className="sv-tab-count">{formatCount(analyticsData.rows.length)}</span>}
        </button>
        <button
          id="sv-monthly-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'monthly'}
          aria-controls="sv-analytics-panel"
          className={activeTab === 'monthly' ? 'is-active' : ''}
          onClick={() => setActiveTab('monthly')}
        >
          <i className="fa-solid fa-calendar-days" aria-hidden="true" /> Monthly Report
          {activeTab === 'monthly' && <span className="sv-tab-count">{formatCount(analyticsData.rows.length)}</span>}
        </button>
        <button
          id="sv-breakdown-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'breakdown'}
          aria-controls="sv-analytics-panel"
          className={activeTab === 'breakdown' ? 'is-active' : ''}
          onClick={() => setActiveTab('breakdown')}
        >
          <i className="fa-solid fa-chart-column" aria-hidden="true" /> Call Breakdown
          {activeTab === 'breakdown' && <span className="sv-tab-count">{formatCount(analyticsData.rows.length)}</span>}
        </button>
        <button
          id="sv-report-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'report'}
          aria-controls="sv-report-panel"
          className={activeTab === 'report' ? 'is-active' : ''}
          onClick={() => setActiveTab('report')}
        >
          <i className="fa-solid fa-file-lines" aria-hidden="true" /> Call Report
          {activeTab === 'report' && <span className="sv-tab-count">{formatCount(reportTotal)}</span>}
        </button>
      </div>

      {['queue', 'follow_up'].includes(activeTab) ? (
        <section
          id="sv-queue-panel"
          className="sv-panel"
          role="tabpanel"
          aria-labelledby={activeTab === 'follow_up' ? 'sv-follow-up-tab' : 'sv-queue-tab'}
          aria-busy={queueQuery.isFetching}
        >
          {queueActionMessage && (
            <div className={`sv-action-alert sv-action-alert--${queueActionMessage.kind}`} role="alert">
              <i className={`fa-solid ${queueActionMessage.kind === 'conflict' ? 'fa-user-clock' : queueActionMessage.kind === 'denied' ? 'fa-lock' : 'fa-circle-exclamation'}`} aria-hidden="true" />
              <div>
                <strong>{queueActionMessage.title}</strong>
                <span>{queueActionMessage.message}</span>
              </div>
              {queueActionMessage.kind !== 'denied' && (
                <button
                  type="button"
                  className="sv-button sv-button--quiet"
                  onClick={refreshQueue}
                  disabled={queueQuery.isFetching || queueDateRangeInvalid}
                >
                  <i className="fa-solid fa-rotate-right" aria-hidden="true" /> Refresh queue
                </button>
              )}
            </div>
          )}

          <div className="sv-filter-panel">
            <div className="sv-filter-heading">
              <div>
                <span className="sv-section-kicker">WORKLIST</span>
                <h2>{activeTab === 'follow_up' ? 'Call follow-up' : 'Call Queue'}</h2>
                <p>{activeTab === 'follow_up'
                  ? 'Previously attempted tickets stay here until verification is completed.'
                  : 'Tickets with no previous call attempt are listed oldest first.'}</p>
                {!canCall && <p className="sv-filter-warning">Read-only access: your account cannot start or finish calls.</p>}
              </div>
              <button
                type="button"
                className="sv-button sv-button--quiet"
                onClick={refreshQueue}
                disabled={queueQuery.isFetching || queueDateRangeInvalid}
              >
                <i className={`fa-solid ${queueQuery.isFetching ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`} aria-hidden="true" />
                Refresh
              </button>
            </div>

            <div className="sv-category-filter">
              <span className="sv-filter-label">Category</span>
              <div className="sv-category-chips" role="group" aria-label="Filter queue by category">
                <button
                  type="button"
                  className={`sv-category-chip${queueCategory ? '' : ' is-selected'}`}
                  aria-pressed={!queueCategory}
                  onClick={() => { setQueueCategory(''); setQueuePage(1); }}
                >
                  All categories
                </button>
                {queueCategories.map((category) => (
                  <button
                    type="button"
                    key={category.value}
                    className={`sv-category-chip${queueCategory === category.value ? ' is-selected' : ''}`}
                    aria-pressed={queueCategory === category.value}
                    onClick={() => { setQueueCategory(category.value); setQueuePage(1); }}
                  >
                    {category.label}
                    {category.count !== undefined && <span>{formatCount(category.count)}</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="sv-filter-grid sv-queue-filters">
              <label className="sv-field" htmlFor="sv-queue-office">
                <span className="sv-filter-label">Office / Branch</span>
                <select
                  id="sv-queue-office"
                  className="sv-control"
                  value={queueOffice}
                  onChange={(event) => { setQueueOffice(event.target.value); setQueuePage(1); }}
                >
                  <option value="">All offices</option>
                  {queueOffices.map((office) => <option key={office} value={office}>{office}</option>)}
                </select>
              </label>
              <label className="sv-field sv-field--search" htmlFor="sv-queue-search">
                <span className="sv-filter-label">Search ticket or customer</span>
                <span className="sv-search-control">
                  <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                  <input
                    id="sv-queue-search"
                    type="search"
                    value={queueSearch}
                    onChange={(event) => { setQueueSearch(event.target.value); setQueuePage(1); }}
                    placeholder="Ticket, customer, or phone"
                  />
                  {queueSearch && (
                    <button
                      type="button"
                      aria-label="Clear queue search"
                      onClick={() => { setQueueSearch(''); setDebouncedQueueSearch(''); setQueuePage(1); }}
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  )}
                </span>
              </label>
              <label className="sv-field" htmlFor="sv-queue-solved-from">
                <span className="sv-filter-label">Solved from</span>
                <input
                  id="sv-queue-solved-from"
                  className="sv-control"
                  type="date"
                  max={queueSolvedTo || undefined}
                  value={queueSolvedFrom}
                  onChange={(event) => { setQueueSolvedFrom(event.target.value); setQueuePage(1); }}
                />
              </label>
              <label className="sv-field" htmlFor="sv-queue-solved-to">
                <span className="sv-filter-label">Solved to</span>
                <input
                  id="sv-queue-solved-to"
                  className="sv-control"
                  type="date"
                  min={queueSolvedFrom || undefined}
                  value={queueSolvedTo}
                  onChange={(event) => { setQueueSolvedTo(event.target.value); setQueuePage(1); }}
                />
              </label>
              <label className="sv-field" htmlFor="sv-queue-state">
                <span className="sv-filter-label">Verification status</span>
                <select
                  id="sv-queue-state"
                  className="sv-control"
                  value={queueStateFilter}
                  onChange={(event) => { setQueueStateFilter(event.target.value); setQueuePage(1); }}
                >
                  <option value="">All active states</option>
                  <option value="pending">Verification pending</option>
                  <option value="in_progress">In progress</option>
                </select>
              </label>
              <button
                type="button"
                className="sv-button sv-button--reset"
                onClick={resetQueueFilters}
                disabled={!queueCategory && !queueOffice && !queueSearch && !queueSolvedFrom && !queueSolvedTo && !queueStateFilter}
              >
                <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Reset
              </button>
            </div>
            {queueDateRangeInvalid && (
              <p className="sv-filter-warning" role="alert">Solved from date must be on or before Solved to date.</p>
            )}
            <p className="sv-filter-note">
              <i className="fa-solid fa-circle-info" aria-hidden="true" />
              Office, category, search, solved date, and status filters apply across the full server-side queue.
            </p>
          </div>

          {queueQuery.isError && (isPermissionError(queueQuery.error) || !queueQuery.data) ? (
            <ErrorState
              denied={isPermissionError(queueQuery.error)}
              title={isPermissionError(queueQuery.error) ? 'Verification queue restricted' : 'Queue could not be loaded'}
              message={getErrorMessage(queueQuery.error, 'The verification call queue is temporarily unavailable.')}
              onRetry={() => queueQuery.refetch()}
            />
          ) : queueIsLoading ? (
            <LoadingState label={queueSearchPending ? 'Searching the queue…' : 'Loading call queue…'} />
          ) : queueQuery.isError ? (
            <div className="sv-inline-error" role="alert">
              <span>{getErrorMessage(queueQuery.error, 'Could not refresh the queue.')}</span>
              <button type="button" className="sv-button sv-button--quiet" onClick={() => queueQuery.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <section className="sv-table-card" aria-label="Verification call queue">
              <div className="sv-table-heading">
                <div>
                  <span className="sv-section-kicker">OLDEST FIRST</span>
                  <h2>{activeTab === 'follow_up' ? 'Tickets needing another call' : 'Tickets awaiting verification'}</h2>
                </div>
                <span className="sv-record-count">
                  {formatCount(queuePagination.total)} total
                </span>
              </div>

              {queueDateRangeInvalid ? (
                <div className="sv-state sv-state--validation" role="status">
                  <span className="sv-state-icon" aria-hidden="true"><i className="fa-solid fa-calendar-xmark" /></span>
                  <strong>Check the solved date range</strong>
                  <span>Choose an end date on or after the start date.</span>
                </div>
              ) : !queueRowsFromServer.length ? (
                <div className="sv-state sv-state--empty" role="status">
                  <span className="sv-state-icon" aria-hidden="true"><i className="fa-solid fa-circle-check" /></span>
                  <strong>{queuePagination.total ? 'No tickets on this page' : 'The verification queue is clear'}</strong>
                  <span>
                    {queuePagination.total
                      ? 'Use the page controls to view more queue records.'
                      : activeTab === 'follow_up'
                        ? 'There are no previous call attempts waiting for follow-up.'
                        : 'There are no matching tickets waiting for their first verification call.'}
                  </span>
                  {(queueCategory || queueSearch) && (
                    <button type="button" className="sv-button sv-button--quiet" onClick={resetQueueFilters}>Clear filters</button>
                  )}
                </div>
              ) : (
                <>
                  <div className="sv-table-scroll" role="region" aria-label="Verification call queue" tabIndex="0">
                    <table className="sv-table sv-queue-table">
                      <thead>
                        <tr>
                          <th scope="col">Complaint No</th>
                          <th scope="col">Ticket / Category</th>
                          <th scope="col">Customer / Phone</th>
                          <th scope="col">Office</th>
                          <th scope="col">Solved</th>
                          <th scope="col">Latest attempt / Caller</th>
                          <th scope="col">Call state</th>
                          <th scope="col">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {queueRows.map((row) => {
                          const ticketId = getTicketId(row);
                          const attempt = getLatestAttempt(row);
                          const state = getVerificationState(row);
                          const latestOutcome = getOutcomeValue(row);
                          const latestCaller = firstValue(attempt, ['caller_name', 'user_name', 'started_by_name']);
                          const latestTime = firstValue(attempt, ['started_at', 'created_at', 'finished_at', 'completed_at']);
                          const latestNote = firstValue(attempt, ['note', 'feedback']);
                          const isOpen = String(outcomeTicketId) === String(ticketId);
                          const isRowStarting = isStarting && String(startingTicketId) === String(ticketId);
                          const isRowFinishing = isFinishing && String(finishingTicketId) === String(ticketId);
                          const latestAttemptId = getLatestAttemptId(row);
                          const complaintNumber = getComplaintNumber(row);
                          const phoneNumber = getCustomerPhone(row);
                          const copyNumber = complaintNumber || phoneNumber;
                          return (
                            <tr key={ticketId || getTicketLabel(row)}>
                              <td data-label="Complaint No">
                                {copyNumber ? (
                                  <div className="sv-complaint-cell">
                                    {complaintNumber ? (
                                      <strong>{complaintNumber}</strong>
                                    ) : (
                                      <span className="sv-complaint-phone">
                                        <i className="fa-solid fa-phone" aria-hidden="true" />
                                        <strong>{phoneNumber}</strong>
                                      </span>
                                    )}
                                    <button
                                      type="button"
                                      className="sv-copy-button"
                                      onClick={() => copyComplaintNumber(copyNumber)}
                                      aria-label={complaintCopyStatus?.complaintNumber === copyNumber && complaintCopyStatus.copied
                                        ? `Number ${copyNumber} copied`
                                        : `Copy number ${copyNumber}`}
                                      title={complaintCopyStatus?.complaintNumber === copyNumber && complaintCopyStatus.copied
                                        ? 'Copied'
                                        : 'Copy number'}
                                    >
                                      <i className={`fa-solid ${complaintCopyStatus?.complaintNumber === copyNumber && complaintCopyStatus.copied ? 'fa-check' : 'fa-copy'}`} aria-hidden="true" />
                                    </button>
                                    {complaintCopyStatus?.complaintNumber === copyNumber && !complaintCopyStatus.copied && (
                                      <span className="sv-copy-error" role="status">Could not copy: {complaintCopyStatus.message}</span>
                                    )}
                                  </div>
                                ) : <span className="sv-dim">—</span>}
                              </td>
                              <td data-label="Ticket / category">
                                <div className="sv-ticket-cell">
                                  <button
                                    type="button"
                                    className="sv-ticket-link"
                                    onClick={() => openTicket(ticketId)}
                                    disabled={!ticketId}
                                    aria-label={`Open ticket ${getTicketLabel(row)}`}
                                  >
                                    {getTicketLabel(row)}
                                  </button>
                                  <span>{getCategoryLabel(row)}</span>
                                </div>
                              </td>
                              <td data-label="Customer / phone">
                                <div className="sv-customer-cell">
                                  <strong>{getCustomerName(row)}</strong>
                                  {canCall && getCustomerPhone(row) && (
                                    <span><i className="fa-solid fa-phone" aria-hidden="true" /> {getCustomerPhone(row)}</span>
                                  )}
                                </div>
                              </td>
                              <td data-label="Office">{getOfficeLabel(row)}</td>
                              <td className="sv-date-cell" data-label="Solved">
                                <strong>{formatDate(getSolvedAt(row))}</strong>
                              </td>
                              <td data-label="Latest attempt / caller">
                                {attempt?.id || latestAttemptId ? (
                                  <div className="sv-attempt-cell">
                                    <strong>{latestCaller || 'Caller not recorded'}</strong>
                                    <span>{getOutcomeLabel(latestOutcome)}</span>
                                    <small>{formatDateTime(latestTime)}</small>
                                    {latestNote && <small className="sv-attempt-note" title={String(latestNote)}>{latestNote}</small>}
                                  </div>
                                ) : <span className="sv-dim">No attempt yet</span>}
                              </td>
                              <td data-label="Call state">
                                <span className={`sv-state-badge sv-state-badge--${state}`}>
                                  <i className={`fa-solid ${state === 'completed' ? 'fa-circle-check' : state === 'in_progress' ? 'fa-phone-volume' : 'fa-clock'}`} aria-hidden="true" />
                                  {getStateLabel(state)}
                                </span>
                                <small className="sv-attempt-count">{formatCount(getAttemptCount(row))} attempt{getAttemptCount(row) === 1 ? '' : 's'}</small>
                              </td>
                              <td className="sv-action-cell" data-label="Call action">
                                {!canCall ? (
                                  <span className="sv-dim">Read-only access</span>
                                ) : state !== 'completed' ? (
                                  <div className="sv-row-actions">
                                    <button
                                      type="button"
                                      className="sv-button sv-button--start"
                                      onClick={() => openVerificationForm(ticketId)}
                                      disabled={!ticketId || isStarting || isFinishing}
                                    >
                                      <i className={`fa-solid ${isRowStarting ? 'fa-spinner fa-spin' : state === 'in_progress' ? 'fa-play' : 'fa-phone'}`} aria-hidden="true" />
                                      {isRowStarting ? 'Opening…' : state === 'in_progress' ? 'Resume call' : 'Start call'}
                                    </button>
                                    {state === 'in_progress' && latestAttemptId && (
                                      <button
                                        type="button"
                                        className="sv-button sv-button--log"
                                        onClick={() => {
                                          setOutcomeTicketId(isOpen ? null : ticketId);
                                          setOutcomeDraft({ outcome: OUTCOME_OPTIONS[0].value, note: '' });
                                          setQueueActionMessage(null);
                                        }}
                                        disabled={isStarting || isFinishing}
                                      >
                                        <i className="fa-solid fa-clipboard-check" aria-hidden="true" />
                                        {isOpen ? 'Close form' : 'Log outcome'}
                                      </button>
                                    )}
                                    {isOpen && (
                                      <form className="sv-outcome-form" onSubmit={(event) => submitOutcome(event, row)}>
                                        <label htmlFor={`sv-outcome-${ticketId}`}>Call outcome</label>
                                        <select
                                          id={`sv-outcome-${ticketId}`}
                                          className="sv-control"
                                          value={outcomeDraft.outcome}
                                          onChange={(event) => setOutcomeDraft((current) => ({ ...current, outcome: event.target.value }))}
                                          required
                                        >
                                          {[...OUTCOME_OPTIONS, { value: 'abandoned', label: 'Abandoned / cancelled' }].map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                          ))}
                                        </select>
                                        <label htmlFor={`sv-note-${ticketId}`}>Note <span>(optional)</span></label>
                                        <textarea
                                          id={`sv-note-${ticketId}`}
                                          className="sv-control"
                                          rows="2"
                                          maxLength="1000"
                                          value={outcomeDraft.note}
                                          onChange={(event) => setOutcomeDraft((current) => ({ ...current, note: event.target.value }))}
                                          placeholder="Add a short call note"
                                        />
                                        <div className="sv-outcome-actions">
                                          <button type="submit" className="sv-button sv-button--start" disabled={isRowFinishing}>
                                            <i className={`fa-solid ${isRowFinishing ? 'fa-spinner fa-spin' : 'fa-check'}`} aria-hidden="true" />
                                            {isRowFinishing ? 'Saving…' : 'Save outcome'}
                                          </button>
                                          <button type="button" className="sv-button sv-button--quiet" onClick={() => setOutcomeTicketId(null)} disabled={isRowFinishing}>
                                            Cancel
                                          </button>
                                        </div>
                                      </form>
                                    )}
                                  </div>
                                ) : (
                                  <span className="sv-complete-note">
                                    <i className="fa-solid fa-check" aria-hidden="true" /> Verified
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    label="Queue"
                    page={queuePagination.page}
                    totalPages={queuePagination.totalPages}
                    range={queuePagination}
                    disabled={queueQuery.isFetching || queueDateRangeInvalid}
                    onPageChange={setQueuePage}
                  />
                </>
              )}
            </section>
          )}
        </section>
      ) : analyticsView ? (
        <AnalyticsPanel
          activeTab={activeTab}
          analyticsDate={analyticsDate}
          analyticsMonth={analyticsMonth}
          analyticsData={analyticsData}
          analyticsQuery={analyticsQuery}
          analyticsExportState={analyticsExportState}
          onDateChange={setAnalyticsDate}
          onMonthChange={(month) => {
            setAnalyticsMonth(month);
            setAnalyticsExportState(null);
          }}
          onExport={exportMonthlyCalls}
        />
      ) : (
        <section
          id="sv-report-panel"
          className="sv-panel"
          role="tabpanel"
          aria-labelledby="sv-report-tab"
          aria-busy={reportQuery.isFetching}
        >
          <div className="sv-filter-panel sv-report-filter-panel">
            <div className="sv-filter-heading">
              <div>
                <span className="sv-section-kicker">AUDIT TRAIL</span>
                <h2>Call Report</h2>
                <p>Review completed verification answers, feedback, and call history.</p>
              </div>
              <button
                type="button"
                className="sv-button sv-button--quiet"
                onClick={() => reportQuery.refetch()}
                disabled={reportQuery.isFetching || reportDateRangeInvalid}
              >
                <i className={`fa-solid ${reportQuery.isFetching ? 'fa-spinner fa-spin' : 'fa-rotate-right'}`} aria-hidden="true" />
                Refresh
              </button>
            </div>

            <div className="sv-filter-grid sv-report-filters">
              <label className="sv-field sv-field--search" htmlFor="sv-report-search">
                <span className="sv-filter-label">Search ticket or customer</span>
                <span className="sv-search-control">
                  <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                  <input
                    id="sv-report-search"
                    type="search"
                    value={reportSearch}
                    onChange={(event) => { setReportSearch(event.target.value); setReportPage(1); setExportState(null); }}
                    placeholder="Ticket, customer, category, or phone"
                  />
                  {reportSearch && (
                    <button
                      type="button"
                      aria-label="Clear report search"
                      onClick={() => { setReportSearch(''); setDebouncedReportSearch(''); setReportPage(1); setExportState(null); }}
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  )}
                </span>
              </label>
              <label className="sv-field" htmlFor="sv-report-from">
                <span className="sv-filter-label">Activity from</span>
                <input
                  id="sv-report-from"
                  className="sv-control"
                  type="date"
                  max={reportTo || undefined}
                  value={reportFrom}
                  onChange={(event) => { setReportFrom(event.target.value); setReportPage(1); setExportState(null); }}
                />
              </label>
              <label className="sv-field" htmlFor="sv-report-to">
                <span className="sv-filter-label">Activity to</span>
                <input
                  id="sv-report-to"
                  className="sv-control"
                  type="date"
                  min={reportFrom || undefined}
                  value={reportTo}
                  onChange={(event) => { setReportTo(event.target.value); setReportPage(1); setExportState(null); }}
                />
              </label>
              <label className="sv-field" htmlFor="sv-report-category">
                <span className="sv-filter-label">Category</span>
                <select
                  id="sv-report-category"
                  className="sv-control"
                  value={reportCategory}
                  onChange={(event) => { setReportCategory(event.target.value); setReportPage(1); setExportState(null); }}
                >
                  <option value="">All categories</option>
                  {reportCategories.map((category) => (
                    <option key={category.value} value={category.value}>{category.label}</option>
                  ))}
                </select>
              </label>
              <label className="sv-field" htmlFor="sv-report-caller">
                <span className="sv-filter-label">Latest caller ID</span>
                <input
                  id="sv-report-caller"
                  className="sv-control"
                  type="text"
                  inputMode="numeric"
                  value={reportCallerId}
                  onChange={(event) => { setReportCallerId(event.target.value); setReportPage(1); setExportState(null); }}
                  placeholder="Enter caller ID"
                />
              </label>
              <label className="sv-field" htmlFor="sv-report-outcome">
                <span className="sv-filter-label">Outcome</span>
                <select
                  id="sv-report-outcome"
                  className="sv-control"
                  value={reportOutcome}
                  onChange={(event) => { setReportOutcome(event.target.value); setReportPage(1); setExportState(null); }}
                >
                  <option value="">All outcomes</option>
                  {reportOutcomeOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="sv-button sv-button--reset"
                onClick={resetReportFilters}
                disabled={!reportSearch && !reportFrom && !reportTo && !reportCategory && !reportCallerId && !reportOutcome}
              >
                <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Reset
              </button>
            </div>
            {reportDateRangeInvalid && (
              <p className="sv-filter-warning" role="alert">Activity from date must be on or before Activity to date.</p>
            )}
          </div>

          {reportQuery.isError && (isPermissionError(reportQuery.error) || !reportQuery.data) ? (
            <ErrorState
              denied={isPermissionError(reportQuery.error)}
              title={isPermissionError(reportQuery.error) ? 'Verification report restricted' : 'Report could not be loaded'}
              message={getErrorMessage(reportQuery.error, 'The verification call report is temporarily unavailable.')}
              onRetry={() => reportQuery.refetch()}
            />
          ) : reportDateRangeInvalid ? (
            <div className="sv-state sv-state--validation" role="status">
              <span className="sv-state-icon" aria-hidden="true"><i className="fa-solid fa-calendar-xmark" /></span>
              <strong>Check the report date range</strong>
              <span>Choose an end date on or after the start date.</span>
            </div>
          ) : reportIsLoading ? (
            <LoadingState label={reportSearchPending ? 'Searching the report…' : 'Loading call report…'} />
          ) : reportQuery.isError ? (
            <div className="sv-inline-error" role="alert">
              <span>{getErrorMessage(reportQuery.error, 'Could not refresh the report.')}</span>
              <button type="button" className="sv-button sv-button--quiet" onClick={() => reportQuery.refetch()}>
                Retry
              </button>
            </div>
          ) : (
            <section className="sv-table-card" aria-label="Verification call report">
              <div className="sv-table-heading sv-report-table-heading">
                <div>
                  <span className="sv-section-kicker">VERIFICATION HISTORY</span>
                  <h2>Call activity and verification results</h2>
                  <p>One latest activity row per ticket; the attempt count includes previous calls. Phone numbers are excluded from exports.</p>
                </div>
                <div className="sv-report-export">
                  <span className="sv-record-count">{formatCount(reportTotal)} filtered records</span>
                  <button
                    type="button"
                    className="sv-button sv-button--export"
                    onClick={exportFilteredReport}
                    disabled={!reportQuery.data || reportTotal === 0 || reportQuery.isFetching || reportSearchPending || reportDateRangeInvalid || exportState?.kind === 'loading'}
                  >
                    <i className={`fa-solid ${exportState?.kind === 'loading' ? 'fa-spinner fa-spin' : 'fa-file-csv'}`} aria-hidden="true" />
                    {exportState?.kind === 'loading' ? 'Preparing CSV…' : 'Export filtered CSV'}
                  </button>
                </div>
              </div>

              {exportState && (
                <div className={`sv-export-status sv-export-status--${exportState.kind}`} role={exportState.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
                  <i
                    className={`fa-solid ${
                      exportState.kind === 'success'
                        ? 'fa-circle-check'
                        : exportState.kind === 'error'
                          ? 'fa-circle-exclamation'
                          : exportState.kind === 'loading'
                            ? 'fa-spinner fa-spin'
                            : 'fa-circle-info'
                    }`}
                    aria-hidden="true"
                  />
                  <span>{exportState.message}</span>
                </div>
              )}

              {!reportData.rows.length ? (
                <div className="sv-state sv-state--empty" role="status">
                  <span className="sv-state-icon" aria-hidden="true"><i className="fa-solid fa-file-circle-question" /></span>
                  <strong>{reportTotal ? 'No report rows on this page' : 'No verification reports found'}</strong>
                  <span>
                    {reportTotal
                      ? 'Use the page controls to view more matching reports.'
                      : 'Try a broader date range or clear one or more filters.'}
                  </span>
                  {(reportSearch || reportFrom || reportTo || reportCategory || reportCallerId || reportOutcome) && (
                    <button type="button" className="sv-button sv-button--quiet" onClick={resetReportFilters}>Clear report filters</button>
                  )}
                </div>
              ) : (
                <>
                  <div className="sv-table-scroll" role="region" aria-label="Verification call report" tabIndex="0">
                    <table className="sv-table sv-report-table">
                      <thead>
                        <tr>
                          <th scope="col">Ticket / Customer</th>
                          <th scope="col">Complaint No</th>
                          <th scope="col">Category / Office</th>
                          <th scope="col">Outcome</th>
                          <th scope="col">Verification answers</th>
                          <th scope="col">Call note / feedback</th>
                          <th scope="col">Latest caller / activity</th>
                          <th scope="col">Attempts / record</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reportData.rows.map((row) => {
                          const ticketId = getTicketId(row);
                          const feedback = getReportFeedback(row);
                          const complaintNumber = getComplaintNumber(row);
                          return (
                            <tr key={ticketId || `${getTicketLabel(row)}-${getReportVerifiedAt(row)}`}>
                              <td data-label="Ticket / customer">
                                <div className="sv-ticket-cell">
                                  <button
                                    type="button"
                                    className="sv-ticket-link"
                                    onClick={() => openTicket(ticketId)}
                                    disabled={!ticketId}
                                    aria-label={`Open ticket ${getTicketLabel(row)}`}
                                  >
                                    {getTicketLabel(row)}
                                  </button>
                                  <span>{getCustomerName(row)}</span>
                                </div>
                              </td>
                              <td data-label="Complaint No">
                                {complaintNumber ? (
                                  <div className="sv-complaint-cell">
                                    <strong>{complaintNumber}</strong>
                                    <button
                                      type="button"
                                      className="sv-copy-button"
                                      onClick={() => copyComplaintNumber(complaintNumber)}
                                      aria-label={complaintCopyStatus?.complaintNumber === complaintNumber && complaintCopyStatus.copied
                                        ? `Complaint number ${complaintNumber} copied`
                                        : `Copy complaint number ${complaintNumber}`}
                                      title={complaintCopyStatus?.complaintNumber === complaintNumber && complaintCopyStatus.copied
                                        ? 'Copied'
                                        : 'Copy complaint number'}
                                    >
                                      <i className={`fa-solid ${complaintCopyStatus?.complaintNumber === complaintNumber && complaintCopyStatus.copied ? 'fa-check' : 'fa-copy'}`} aria-hidden="true" />
                                    </button>
                                    {complaintCopyStatus?.complaintNumber === complaintNumber && !complaintCopyStatus.copied && (
                                      <span className="sv-copy-error" role="status">Could not copy: {complaintCopyStatus.message}</span>
                                    )}
                                  </div>
                                ) : <span className="sv-dim">—</span>}
                              </td>
                              <td data-label="Category / office">
                                <div className="sv-ticket-cell">
                                  <strong>{getCategoryLabel(row)}</strong>
                                  <span>{getOfficeLabel(row)}</span>
                                </div>
                              </td>
                              <td data-label="Outcome">
                                <span className={`sv-outcome-badge sv-outcome-badge--${String(getOutcomeValue(row) || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                                  {getOutcomeLabel(getOutcomeValue(row))}
                                </span>
                              </td>
                              <td data-label="Verification answers"><AnswerSummary row={row} /></td>
                              <td className="sv-feedback-cell" data-label="Call note / feedback">{feedback ? String(feedback) : <span className="sv-dim">No note</span>}</td>
                              <td data-label="Latest caller / activity">
                                <div className="sv-attempt-cell">
                                  <strong>{getReportVerifiedBy(row)}</strong>
                                  <small>{formatDateTime(getReportVerifiedAt(row))}</small>
                                </div>
                              </td>
                              <td data-label="Attempts / record">
                                <div className="sv-record-flags">
                                  <span className="sv-attempt-number">{getAttemptCountLabel(row)}</span>
                                  {isCorrectionRecord(row) && <span className="sv-record-flag sv-record-flag--correction">Correction</span>}
                                  {isLegacyRecord(row) && <span className="sv-record-flag sv-record-flag--legacy">Legacy</span>}
                                  <AttemptHistory row={row} />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <Pagination
                    label="Report"
                    page={reportPagination.page}
                    totalPages={reportPagination.totalPages}
                    range={reportPagination}
                    disabled={reportQuery.isFetching || reportDateRangeInvalid}
                    onPageChange={setReportPage}
                  />
                </>
              )}
            </section>
          )}
        </section>
      )}
      {(ticketModalId || verificationModalTicket) && (
        <div className="support-ticket-modal-route">
          <Suspense fallback={null}>
            <SupportTickets
              modalOnly
              initialTicketId={ticketModalId}
              initialVerificationTicket={verificationModalTicket}
              onModalClose={() => {
                setTicketModalId(null);
                setVerificationModalTicket(null);
              }}
            />
          </Suspense>
        </div>
      )}
    </main>
  );
};

export default SupportVerification;
