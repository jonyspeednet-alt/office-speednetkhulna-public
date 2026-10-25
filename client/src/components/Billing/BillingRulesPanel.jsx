import React, { useState, useEffect, useCallback } from 'react';
import {
  listBillingRules,
  createBillingRule,
  updateBillingRule,
  deactivateBillingRule,
} from '../../services/resellerService';
import { notify } from '../../utils/notify';
import { confirmAction } from '../../utils/confirm';

const RULE_TYPES = [
  { value: 'bw_billable', label: 'Bandwidth billable (Mbps)' },
  { value: 'discount_fixed', label: 'Discount fixed (Tk)' },
];

const BW_TYPES = ['IIG', 'BDIX', 'GGC', 'FNA', 'CDN', 'BCDN', 'NTTN'];

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const newIdempotencyKey = () => {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch (_) { /* fallback below */ }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const emptyForm = (monthYm) => ({
  rule_type: 'bw_billable',
  bw_type: 'GGC',
  amount: '',
  start_month: monthYm || '',
  end_month: '',
  reason: '',
});

const ruleTypeLabel = (t) => RULE_TYPES.find((r) => r.value === t)?.label || t;

const formatAmount = (rule) => {
  const n = Number(rule?.amount || 0);
  if (rule?.rule_type === 'bw_billable') return `${n} Mbps of ${rule?.bw_type || ''}`;
  return `${n} ৳`;
};

const BillingRulesPanel = ({ resellerId, monthYm, partnerType, onChanged }) => {
  const [rules, setRules] = useState([]);
  const [listLoading, setListLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm(monthYm));
  const [saving, setSaving] = useState(false);
  const [stoppingId, setStoppingId] = useState(null);

  const isChannel = partnerType === 'channel_partner';

  const fetchRules = useCallback(async () => {
    if (!resellerId || isChannel) return;
    setListLoading(true);
    try {
      const res = await listBillingRules(resellerId, monthYm);
      setRules(Array.isArray(res) ? res : (res?.rules || res?.data || []));
    } catch (e) {
      console.error('[BillingRules] list:', e);
      notify.error(e?.response?.data?.message || 'Failed to load billing rules');
    } finally {
      setListLoading(false);
    }
  }, [resellerId, monthYm, isChannel]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  if (isChannel) return null;

  const setField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const validate = () => {
    const amount = Number(form.amount);
    if (form.rule_type === 'bw_billable') {
      if (!BW_TYPES.includes(form.bw_type)) {
        notify.error('Select a bandwidth type (IIG, BDIX, GGC, FNA, CDN, BCDN, NTTN)');
        return false;
      }
      if (!Number.isFinite(amount) || amount < 0) {
        notify.error('Billable bandwidth must be 0 or more (Mbps)');
        return false;
      }
    } else if (!Number.isFinite(amount) || amount <= 0) {
      notify.error('Amount must be a number greater than 0');
      return false;
    }
    if (!MONTH_RE.test(form.start_month || '')) {
      notify.error('Start month must be in YYYY-MM format');
      return false;
    }
    if (form.end_month && !MONTH_RE.test(form.end_month)) {
      notify.error('End month must be in YYYY-MM format (or empty for ongoing)');
      return false;
    }
    if (form.end_month && form.end_month < form.start_month) {
      notify.error('End month must be on or after start month');
      return false;
    }
    if (!String(form.reason || '').trim()) {
      notify.error('Reason is required');
      return false;
    }
    return true;
  };

  const buildPayload = () => {
    const payload = {
      rule_type: form.rule_type,
      amount: Number(form.amount),
      start_month: form.start_month,
      effective_month: `${form.start_month}-01`,
      end_month: form.end_month ? `${form.end_month}-01` : null,
      reason: form.reason.trim(),
      note: form.reason.trim(),
      idempotency_key: newIdempotencyKey(),
    };
    if (form.rule_type === 'bw_billable') payload.bw_type = form.bw_type;
    return payload;
  };

  const openAdd = () => {
    setEditingId(null);
    setForm(emptyForm(monthYm));
    setShowForm(true);
  };

  const openEdit = (rule) => {
    setEditingId(rule.id);
    setForm({
      rule_type: rule.rule_type || 'bw_billable',
      bw_type: rule.bw_type || 'GGC',
      amount: String(rule.amount ?? ''),
      start_month: String(rule.start_month || rule.effective_month || '').slice(0, 7),
      end_month: rule.end_month ? String(rule.end_month).slice(0, 7) : '',
      reason: rule.reason || rule.note || '',
    });
    setShowForm(true);
  };

  const handleSave = async (e) => {
    e?.preventDefault();
    if (!validate() || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateBillingRule(resellerId, editingId, buildPayload());
        notify.success('Billing rule updated');
      } else {
        await createBillingRule(resellerId, buildPayload());
        notify.success('Billing rule added');
      }
      setShowForm(false);
      setEditingId(null);
      await fetchRules();
      if (onChanged) await onChanged();
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Failed to save billing rule');
    } finally {
      setSaving(false);
    }
  };

  const handleStop = async (rule) => {
    const confirmed = await confirmAction({
      title: 'Stop billing rule?',
      text: `Stop ${ruleTypeLabel(rule.rule_type)} (${formatAmount(rule)}) from ${String(rule.start_month || rule.effective_month || '').slice(0, 7)}? This deactivates the rule.`,
      confirmText: 'Stop rule',
      danger: true,
    });
    if (!confirmed) return;
    setStoppingId(rule.id);
    try {
      await deactivateBillingRule(resellerId, rule.id, { idempotency_key: newIdempotencyKey() });
      notify.success('Billing rule stopped');
      await fetchRules();
      if (onChanged) await onChanged();
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Failed to stop billing rule');
    } finally {
      setStoppingId(null);
    }
  };

  return (
    <div className="billing-period-card no-print" style={{ maxWidth: 850, margin: '0 auto 16px' }}>
      <div className="d-flex justify-content-between align-items-center mb-2">
        <span className="fw-semibold" style={{ fontSize: '0.85rem', color: '#1e293b' }}>
          <i className="fas fa-redo me-1 text-primary" />Recurring billing rules
          {monthYm && <span className="text-muted fw-normal ms-1">({monthYm})</span>}
        </span>
        {!showForm && (
          <button type="button" className="btn btn-outline-primary btn-sm rounded-pill px-3" onClick={openAdd}>
            <i className="fas fa-plus me-1" />Add rule
          </button>
        )}
      </div>

      {listLoading ? (
        <div className="small text-muted"><span className="spinner-border spinner-border-sm me-1" />Loading rules...</div>
      ) : rules.length === 0 && !showForm ? (
        <div className="small text-muted">No active rules for this reseller and month.</div>
      ) : rules.length > 0 ? (
        <div className="table-responsive">
          <table className="table table-sm align-middle mb-2" style={{ fontSize: '0.82rem' }}>
            <thead className="text-muted">
              <tr>
                <th scope="col">Type</th>
                <th scope="col" className="text-end">Amount</th>
                <th scope="col">Period</th>
                <th scope="col">Reason</th>
                <th scope="col" className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="fw-semibold">{ruleTypeLabel(rule.rule_type)}</td>
                  <td className="text-end">{formatAmount(rule)}</td>
                  <td className="small text-muted">
                    {String(rule.start_month || rule.effective_month || '').slice(0, 7)}
                    {' → '}
                    {rule.end_month ? String(rule.end_month).slice(0, 7) : 'ongoing'}
                  </td>
                  <td className="small">{rule.reason || rule.note || '—'}</td>
                  <td className="text-end text-nowrap">
                    <button type="button" className="btn btn-sm btn-outline-secondary rounded-pill me-1" onClick={() => openEdit(rule)} disabled={saving || stoppingId === rule.id}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-sm btn-outline-danger rounded-pill" onClick={() => handleStop(rule)} disabled={saving || stoppingId === rule.id}>
                      {stoppingId === rule.id ? <span className="spinner-border spinner-border-sm" /> : 'Stop'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {showForm && (
        <form className="row g-2 border-top pt-2 mt-1" onSubmit={handleSave}>
          <div className="col-md-3">
            <label className="form-label small fw-semibold text-muted mb-1">Rule type</label>
            <select className="form-select form-select-sm shadow-none" value={form.rule_type} onChange={(e) => setField('rule_type', e.target.value)} disabled={saving || !!editingId}>
              {RULE_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {form.rule_type === 'bw_billable' && (
            <div className="col-md-2">
              <label className="form-label small fw-semibold text-muted mb-1">Bandwidth</label>
              <select className="form-select form-select-sm shadow-none" value={form.bw_type} onChange={(e) => setField('bw_type', e.target.value)} disabled={saving || !!editingId}>
                {BW_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          )}
          <div className={form.rule_type === 'bw_billable' ? 'col-md-3' : 'col-md-5'}>
            <label className="form-label small fw-semibold text-muted mb-1">
              {form.rule_type === 'bw_billable' ? 'Billable (Mbps)' : 'Amount (Tk)'}
            </label>
            <input
              type="number"
              step="0.01"
              min={form.rule_type === 'bw_billable' ? '0' : '0.01'}
              className="form-control form-control-sm shadow-none"
              value={form.amount}
              onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
              required
              disabled={saving}
            />
          </div>
          <div className="col-md-2">
            <label className="form-label small fw-semibold text-muted mb-1">Start month</label>
            <input type="month" className="form-control form-control-sm shadow-none" value={form.start_month} onChange={(e) => setField('start_month', e.target.value)} required disabled={saving} />
          </div>
          <div className="col-md-2">
            <label className="form-label small fw-semibold text-muted mb-1">End (ongoing)</label>
            <input type="month" className="form-control form-control-sm shadow-none" value={form.end_month} onChange={(e) => setField('end_month', e.target.value)} placeholder="ongoing" disabled={saving} />
          </div>
          <div className="col-12">
            <label className="form-label small fw-semibold text-muted mb-1">Reason</label>
            <textarea className="form-control form-control-sm" rows="2" value={form.reason} onChange={(e) => setField('reason', e.target.value)} required disabled={saving} />
          </div>
          <div className="col-12 text-end">
            <button type="button" className="btn btn-light btn-sm rounded-pill me-2" onClick={() => { setShowForm(false); setEditingId(null); }} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm rounded-pill px-4" disabled={saving}>
              {saving ? <span className="spinner-border spinner-border-sm me-1" /> : null}
              {editingId ? 'Update rule' : 'Save rule'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default BillingRulesPanel;
