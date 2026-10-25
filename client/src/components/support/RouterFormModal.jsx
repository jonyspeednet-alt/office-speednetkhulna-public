import React, { useEffect, useState } from 'react';
import { Modal, Button } from 'react-bootstrap';
import { testMikrotikRouter } from '../../services/supportService';

const DEFAULT_PORTS = { api: 8728, rest: 443 };

const mapTestErrorBn = (err) => {
  const rawData = err?.response?.data?.data ?? err?.response?.data ?? {};
  const code = String(rawData?.code || err?.response?.data?.code || '').toUpperCase();
  const retryAfter = rawData?.retry_after_seconds ?? err?.response?.data?.retry_after_seconds;
  const retrySuffix = retryAfter ? ` (retry after ~${retryAfter}s)` : '';
  if (code === 'AUTH') {
    return `Invalid username/password${retrySuffix}`;
  }
  if (code === 'TIMEOUT') {
    return `Timed out reaching the router (check timeout)${retrySuffix}`;
  }
  if (code === 'UNREACHABLE') {
    return `Cannot reach the router (check IP/port/firewall)${retrySuffix}`;
  }
  if (code === 'UNKNOWN') {
    return `${rawData?.message || err?.response?.data?.message || 'Test failed'}${retrySuffix}`;
  }
  const status = err?.response?.status;
  const msg = String(err?.response?.data?.message || rawData?.message || err?.message || '').toLowerCase();
  if (status === 401 || msg.includes('401') || msg.includes('unauthorized') || msg.includes('invalid user') || msg.includes('wrong')) {
    return `Invalid username/password${retrySuffix}`;
  }
  if (
    err?.code === 'ECONNABORTED' ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('refused') ||
    msg.includes('ehostunreach') ||
    msg.includes('network') ||
    status === 503
  ) {
    return `Cannot reach the router (check IP/port/firewall)${retrySuffix}`;
  }
  return `${err?.response?.data?.message || rawData?.message || 'Test failed'}${retrySuffix}`;
};

const RouterFormModal = ({ show, onHide, isEdit, initialData = {}, onSubmit, submitting }) => {
  const [submitted, setSubmitted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [portEdited, setPortEdited] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null); // { ok, text }
  const [formData, setFormData] = useState({
    id: '',
    label: '',
    protocol: 'rest',
    host: '',
    base_url: '',
    port: 443,
    username: '',
    password: '',
    is_active: true,
  });

  useEffect(() => {
    if (show) {
      setSubmitted(false);
      setShowPassword(false);
      setTestResult(null);
      setPortEdited(true); // edit mode: don't auto-overwrite saved port
      setFormData({
        id: initialData?.id || '',
        label: initialData?.label || '',
        protocol: initialData?.protocol || 'rest',
        host: initialData?.host || '',
        base_url: initialData?.base_url || '',
        port: initialData?.port ?? 443,
        username: initialData?.username || '',
        password: '',
        is_active: initialData?.is_active ?? true,
      });
      if (!isEdit) setPortEdited(false);
    }
  }, [show, isEdit, initialData?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleProtocolChange = (protocol) => {
    setFormData((prev) => ({
      ...prev,
      protocol,
      port: portEdited ? prev.port : (DEFAULT_PORTS[protocol] ?? prev.port),
    }));
  };

  const isRest = formData.protocol === 'rest';
  const errors = {};
  if (!String(formData.id || '').trim()) errors.id = 'Enter ID (e.g. main-router)';
  if (!String(formData.label || '').trim()) errors.label = 'Enter name';
  if (!String(formData.username || '').trim()) errors.username = 'Enter username';
  if (!isEdit && !String(formData.password || '').trim()) errors['password'] = 'Enter password';
  if (isRest) {
    // REST: base_url required (valid URL), host/port hidden + sent empty
    const bu = String(formData.base_url || '').trim();
    if (!bu) {
      errors.base_url = 'Enter Base URL (e.g. https://192.168.1.1/rest)';
    } else {
      try {
        const u = new URL(bu);
        if (!['http:', 'https:'].includes(u.protocol)) errors.base_url = 'Base URL must start with http:// or https://';
        else if (bu.length > 500) errors.base_url = 'Base URL must be within 500 characters';
      } catch {
        errors.base_url = 'Enter a valid Base URL (e.g. https://192.168.1.1/rest)';
      }
    }
  } else {
    // API: host required, base_url hidden + sent empty
    if (!String(formData.host || '').trim()) errors.host = 'Enter Host/IP';
    const portNum = Number(formData.port);
    if (!portNum || portNum < 1 || portNum > 65535) errors.port = 'Enter a valid port (1-65535)';
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.keys(errors).length > 0) return;
    const payload = {
      id: String(formData.id).trim(),
      label: String(formData.label).trim(),
      protocol: formData.protocol,
      username: String(formData.username).trim(),
      is_active: Boolean(formData.is_active),
    };
    // backend contract: rest → base_url + empty host/port; api → host/port + empty base_url
    if (formData.protocol === 'rest') {
      payload.base_url = String(formData.base_url).trim();
      payload.host = '';
      payload.port = null;
    } else {
      payload.host = String(formData.host).trim();
      payload.port = Number(formData.port);
      payload.base_url = '';
    }
    // edit-এ password blank = unchanged → payload থেকে delete
    if (String(formData.password || '').trim()) {
      payload.password = formData.password;
    }
    onSubmit?.(payload);
  };

  const handleTest = async () => {
    if (!isEdit || !initialData?.id) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testMikrotikRouter(initialData.id);
      setTestResult({
        ok: true,
        text: `Success (${res?.records_seen ?? 0} records, ${res?.latency_ms ?? '?'}ms)`,
      });
    } catch (err) {
      setTestResult({ ok: false, text: mapTestErrorBn(err) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered size="lg" scrollable>
      <Modal.Header closeButton className="border-0 px-3 px-md-4 pt-4">
        <Modal.Title className="fw-bold">{isEdit ? 'Update Router' : 'New Router'}</Modal.Title>
      </Modal.Header>
      <Modal.Body className="px-3 px-md-4">
        <form onSubmit={handleSubmit}>
          <div className="mb-3">
            <label htmlFor="rm-id" className="form-label small fw-bold text-muted ui-required">ID</label>
            <input
              id="rm-id"
              type="text"
              className={`form-control rounded-3 ${submitted && errors.id ? 'is-invalid' : ''}`}
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value })}
              placeholder="main-router"
            />
            {submitted && errors.id && <div className="invalid-feedback">{errors.id}</div>}
            {isEdit && <div className="form-text">Changing the ID will move customers and sync history to the new ID.</div>}
          </div>
          <div className="mb-3">
            <label htmlFor="rm-label" className="form-label small fw-bold text-muted ui-required">Name (Label)</label>
            <input
              id="rm-label"
              type="text"
              className={`form-control rounded-3 ${submitted && errors.label ? 'is-invalid' : ''}`}
              value={formData.label}
              onChange={(e) => setFormData({ ...formData, label: e.target.value })}
              placeholder="Head Office Router"
            />
            {submitted && errors.label && <div className="invalid-feedback">{errors.label}</div>}
          </div>
          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-6">
              <label htmlFor="rm-protocol" className="form-label small fw-bold text-muted">Protocol</label>
              <select
                id="rm-protocol"
                className="form-select rounded-3"
                value={formData.protocol}
                onChange={(e) => handleProtocolChange(e.target.value)}
              >
                <option value="rest">REST (HTTPS)</option>
                <option value="api">API (RouterOS)</option>
              </select>
            </div>
            <div className="col-12 col-sm-6">
              <label htmlFor="rm-port" className="form-label small fw-bold text-muted ui-required">Port</label>
              <input
                id="rm-port"
                type="number"
                className={`form-control rounded-3 ${submitted && errors.port ? 'is-invalid' : ''}`}
                value={formData.port}
                disabled={isRest}
                onChange={(e) => { setPortEdited(true); setFormData({ ...formData, port: e.target.value }); }}
              />
              {submitted && errors.port && <div className="invalid-feedback">{errors.port}</div>}
              {isRest && <div className="form-text">REST needs no port (base_url is used).</div>}
            </div>
          </div>
          {!isRest && (
          <div className="mb-3">
            <label htmlFor="rm-host" className="form-label small fw-bold text-muted ui-required">Host / IP</label>
            <input
              id="rm-host"
              type="text"
              className={`form-control rounded-3 ${submitted && errors.host ? 'is-invalid' : ''}`}
              value={formData.host}
              onChange={(e) => setFormData({ ...formData, host: e.target.value })}
              placeholder="192.168.1.1"
            />
            {submitted && errors.host && <div className="invalid-feedback">{errors.host}</div>}
          </div>
          )}
          {isRest && (
            <div className="mb-3">
              <label htmlFor="rm-base-url" className="form-label small fw-bold text-muted ui-required">Base URL</label>
              <input
                id="rm-base-url"
                type="text"
                className={`form-control rounded-3 ${submitted && errors.base_url ? 'is-invalid' : ''}`}
                value={formData.base_url}
                onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
                placeholder="https://192.168.1.1/rest"
              />
              {submitted && errors.base_url && <div className="invalid-feedback">{errors.base_url}</div>}
            </div>
          )}
          <div className="row g-3 mb-3">
            <div className="col-12 col-sm-6">
              <label htmlFor="rm-username" className="form-label small fw-bold text-muted ui-required">Username</label>
              <input
                id="rm-username"
                type="text"
                className={`form-control rounded-3 ${submitted && errors.username ? 'is-invalid' : ''}`}
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="admin"
              />
              {submitted && errors.username && <div className="invalid-feedback">{errors.username}</div>}
            </div>
            <div className="col-12 col-sm-6">
              <label htmlFor="rm-password" className="form-label small fw-bold text-muted {!isEdit ? 'ui-required' : ''}">Password</label>
              <div className="input-group">
                <input
                  id="rm-password"
                  type={showPassword ? 'text' : 'password'}
                  className={`form-control rounded-start-3 ${submitted && errors.password ? 'is-invalid' : ''}`}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={isEdit ? '•••••• (unchanged)' : '••••••'}
                />
                <button type="button" className="btn btn-outline-secondary" onClick={() => setShowPassword((v) => !v)} title="show/hide">
                  <i className={`fas ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`}></i>
                </button>
              </div>
              {submitted && errors.password && <div className="invalid-feedback d-block">{errors.password}</div>}
              {isEdit && <div className="form-text">Leave empty to keep the password unchanged.</div>}
            </div>
          </div>
          <div className="form-check form-switch mb-3">
            <input
              id="rm-active"
              className="form-check-input"
              type="checkbox"
              checked={Boolean(formData.is_active)}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
            />
            <label className="form-check-label small fw-bold text-muted" htmlFor="rm-active">Active</label>
          </div>

          <div className="d-flex flex-wrap gap-2 align-items-center mb-3">
            <Button
              variant="outline-primary"
              className="rounded-pill"
              type="button"
              disabled={!isEdit || testing}
              title={!isEdit ? 'Test is only available in edit mode (on a saved router)' : 'Test Connection'}
              onClick={handleTest}
            >
              {testing && <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>}
              <i className="fas fa-plug me-2"></i>Test Connection
            </Button>
            {!isEdit && <span className="text-muted small">Test is only available in edit mode — save first.</span>}
          </div>
          {testResult && (
            <div className={`alert ${testResult.ok ? 'alert-success' : 'alert-danger'} py-2 small`} role="alert">
              {testResult.text}
            </div>
          )}

          <div className="d-flex justify-content-end gap-2 pb-2 flex-wrap">
            <Button variant="light" className="rounded-pill flex-fill flex-sm-grow-0" onClick={onHide}>Close</Button>
            <Button type="submit" variant="primary" className="rounded-pill px-4 flex-fill flex-sm-grow-0" disabled={submitting}>
              {submitting && <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>}
              {isEdit ? 'Update' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal.Body>
    </Modal>
  );
};

export default RouterFormModal;
