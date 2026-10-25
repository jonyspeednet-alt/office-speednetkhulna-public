import React, { useEffect, useMemo, useState } from 'react';
import { formatDateTime } from '../utils/formatters';
import { Link } from 'react-router-dom';
import { applyBandwidthRequest, getBandwidthRequests, getResellers } from '../services/resellerService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const bwLabel = (raw) => {
  const s = String(raw || '').toLowerCase();
  if (s.includes('iig')) return 'IIG';
  if (s.includes('bdix')) return 'BDIX';
  if (s.includes('ggc')) return 'GGC';
  if (s.includes('fna')) return 'FNA';
  if (s.includes('cdn')) return 'CDN';
  if (s.includes('bcdn') || s.includes('other')) return 'Other';
  if (s.includes('nttn')) return 'NTTN';
  return String(raw || '').toUpperCase();
};

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmtDateTime = (v) => {
  return formatDateTime(v) || '-';
};

const fmtDate = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const PARTNER_TABS = {
  distribution_partner: { label: 'Distribution Partner', icon: 'fas fa-network-wired', color: '#2563eb' },
  channel_partner: { label: 'Channel Partner', icon: 'fas fa-handshake', color: '#059669' },
  mac_partner: { label: 'Mac Partner', icon: 'fas fa-desktop', color: '#7c3aed' }
};

const TAB_STYLE = `
  .corp-tabs { display: inline-flex; background: #fff; border-radius: 12px; padding: 4px; gap: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); border: 1px solid #f1f5f9; }
  .corp-tab { padding: 8px 20px; border-radius: 8px; border: none; font-size: .85rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all .2s ease; background: transparent; color: #64748b; }
  .corp-tab:hover { background: #f8fafc; color: #1e293b; }
  .corp-tab.active { background: linear-gradient(135deg,#1e40af,#2563eb); color: #fff; box-shadow: 0 4px 12px rgba(37,99,235,.3); }
  .corp-tab .badge-count { background: #f1f5f9; color: #64748b; padding: 2px 8px; border-radius: 20px; font-size: .75rem; font-weight: 600; transition: all .2s ease; }
  .corp-tab.active .badge-count { background: rgba(255,255,255,.2); color: #fff; }
`;

const TasksEngineer = () => {
  const [tasks, setTasks] = useState([]);
  const [resellers, setResellers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [notes, setNotes] = useState({});
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('distribution_partner');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [taskResult, resellerResult] = await Promise.allSettled([
        getBandwidthRequests('approved'),
        getResellers('')
      ]);

      const taskRows = taskResult.status === 'fulfilled' ? taskResult.value : [];
      const resellerRows = resellerResult.status === 'fulfilled' ? resellerResult.value : [];

      const normalizedTasks = Array.isArray(taskRows)
        ? taskRows.filter((x) => {
          const adminOk = String(x.admin_status || '').toLowerCase() === 'approved';
          const eng = String(x.engineer_status || 'pending').toLowerCase();
          return adminOk && eng !== 'implemented' && eng !== 'approved';
        })
        : [];

      setTasks(normalizedTasks);
      setResellers(Array.isArray(resellerRows) ? resellerRows : []);
      if (taskResult.status === 'rejected') {
        setError('Engineer tasks load failed. Please check your permission.');
      } else if (resellerResult.status === 'rejected') {
        setError('Reseller status list is unavailable for your current permission.');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const groupedTasks = useMemo(() => {
    const map = new Map();
    tasks.forEach((r) => {
      if (!map.has(r.reseller_id)) {
        map.set(r.reseller_id, {
          info: {
            name: r.reseller_name || 'Unknown',
            pop: r.pop_location || '-',
            date: r.created_at || null
          },
          tasks: []
        });
      }
      const g = map.get(r.reseller_id);
      g.tasks.push(r);
      if (r.created_at && g.info.date && new Date(r.created_at) < new Date(g.info.date)) g.info.date = r.created_at;
      if (!g.info.pop && r.pop_location) g.info.pop = r.pop_location;
    });

    const rows = Array.from(map.entries()).map(([resellerId, group]) => {
      group.tasks.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
      return [resellerId, group];
    });

    rows.sort((a, b) => new Date(a[1].info.date || 0) - new Date(b[1].info.date || 0));
    return rows;
  }, [tasks]);

  const resellerPartnerMap = useMemo(() => {
    const map = new Map();
    resellers.forEach(r => map.set(Number(r.id), r.partner_type || 'distribution_partner'));
    return map;
  }, [resellers]);

  const filteredGroupedTasks = useMemo(() => {
    return groupedTasks.filter(([rid]) => {
      const pt = resellerPartnerMap.get(Number(rid));
      return pt === activeTab;
    });
  }, [groupedTasks, activeTab, resellerPartnerMap]);

  const filteredResellers = useMemo(() => {
    return resellers.filter(r => (r.partner_type || 'distribution_partner') === activeTab);
  }, [resellers, activeTab]);

  const tabCounts = useMemo(() => {
    const counts = {};
    Object.keys(PARTNER_TABS).forEach(key => {
      counts[key] = resellers.filter(r => (r.partner_type || 'distribution_partner') === key).length;
    });
    return counts;
  }, [resellers]);

  const applyAll = async (resellerId) => {
    const techNote = (notes[resellerId] || '').trim();
    if (!techNote) {
      notify.error('Please write a technical note.');
      return;
    }

    const list = tasks.filter((t) => Number(t.reseller_id) === Number(resellerId));
    if (!list.length) return;

    if (!(await confirmAction({ title: 'Apply these tasks?', text: 'Are you sure all tasks for this reseller are complete?' }))) return;

    setBusy(`all-${resellerId}`);
    try {
      for (const t of list) {
        await applyBandwidthRequest(t.id, { note: techNote });
      }
      await load();
      notify.success('Tasks applied successfully');
    } catch (e) {
      const msg = e?.response?.data?.message || e.message || 'Could not complete the work';
      notify.error(msg);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="container-fluid py-4 reseller-page" style={{ backgroundColor: '#f4f7fe', minHeight: '100vh' }}>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="fw-bold m-0"><i className="fas fa-tools text-primary me-2" />Engineering Task List</h2>
          <p className="text-muted mt-1 mb-0">Complete management-approved work here</p>
        </div>
        <Link to="/dashboard" className="btn btn-outline-primary rounded-pill px-4">Dashboard</Link>
      </div>

      <style>{TAB_STYLE}</style>
      <div className="mb-4 overflow-auto pb-1">
        <div className="corp-tabs">
          {Object.entries(PARTNER_TABS).map(([key, tab]) => (
            <button
              key={key}
              type="button"
              className={`corp-tab ${activeTab === key ? 'active' : ''}`}
              onClick={() => setActiveTab(key)}
            >
              <i className={tab.icon} />
              {tab.label}
              <span className="badge-count">{tabCounts[key]}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="row">
        {error && (
          <div className="col-12 mb-3">
            <div className="alert alert-warning mb-0">{error}</div>
          </div>
        )}
        {loading ? (
          <div className="col-12"><div className="card border-0 shadow-sm rounded-4 p-4">Loading...</div></div>
        ) : filteredGroupedTasks.length === 0 ? (
          <div className="col-12 text-center py-5">
            <i className="fas fa-check-circle fa-4x text-success opacity-25 mb-3" />
            <h4 className="text-muted">No pending tasks in this section.</h4>
          </div>
        ) : (
          filteredGroupedTasks.map(([rid, group]) => (
            <div className="col-lg-6 mb-4" key={rid}>
              <div className="card border-0 shadow-sm rounded-4 p-4 h-100">
                <div className="d-flex justify-content-between mb-3">
                  <h5 className="fw-bold mb-1">{group.info.name}</h5>
                  <small className="text-muted"><i className="far fa-clock" /> {fmtDateTime(group.info.date)}</small>
                </div>
                <p className="text-muted small mb-3"><i className="fas fa-map-marker-alt" /> {group.info.pop || '-'}</p>

                <div className="table-responsive mb-3">
                  <table className="table table-sm table-bordered align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Type</th>
                        <th>Action</th>
                        <th>Quantity</th>
                        <th>Effective Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.tasks.map((task) => (
                        <tr key={task.id}>
                          <td>
                            <span className="badge" style={{ background: '#eef2ff', color: '#4318ff', border: '1px solid #4318ff' }}>
                              {bwLabel(task.bw_type)}
                            </span>
                          </td>
                          <td>
                            <span className={`fw-bold small ${String(task.change_type).toLowerCase() === 'increase' ? 'text-success' : 'text-danger'}`}>
                              {String(task.change_type).toLowerCase() === 'increase' ? 'Upgradation' : 'Downgradation'}
                            </span>
                          </td>
                          <td className="fw-bold">{num(task.requested_bw_mbps)} Mbps</td>
                          <td>
                            {task.requested_effective_date ? (
                              <span className="badge bg-warning text-dark border"><i className="far fa-clock me-1" /> {fmtDate(task.requested_effective_date)}</span>
                            ) : (
                              <span className="text-muted small">Immediate</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mb-3">
                  <label className="form-label small fw-bold">Technical Note (for all tasks)</label>
                  <textarea
                    className="form-control form-control-sm"
                    rows={2}
                    placeholder="e.g. VLAN configuration has been updated..."
                    value={notes[rid] || ''}
                    onChange={(e) => setNotes((p) => ({ ...p, [rid]: e.target.value }))}
                    required
                  />
                </div>

                <button
                  type="button"
                  className="btn btn-primary w-100 fw-bold rounded-3"
                  disabled={busy === `all-${rid}`}
                  onClick={() => applyAll(rid)}
                >
                  {busy === `all-${rid}` ? 'Processing...' : <>Complete All Tasks <i className="fas fa-check-double ms-1" /></>}
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="card border-0 shadow-sm rounded-4 mt-4">
        <div className="card-header bg-white border-0 py-3 d-flex align-items-center justify-content-between">
          <h5 className="fw-bold m-0"><i className="fas fa-list text-primary me-2" />Reseller Bandwidth Status <span className="badge bg-primary bg-opacity-10 text-primary ms-2">{PARTNER_TABS[activeTab].label}</span></h5>
          <small className="text-muted">Total: {filteredResellers.length}</small>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr>
                <th className="text-uppercase small text-muted">Reseller</th>
                <th className="text-uppercase small text-muted">Contact</th>
                {activeTab === 'distribution_partner' ? (
                  <>
                    <th className="text-uppercase small text-muted">IIG</th>
                    <th className="text-uppercase small text-muted">BDIX</th>
                    <th className="text-uppercase small text-muted">GGC</th>
                    <th className="text-uppercase small text-muted">FNA</th>
                    <th className="text-uppercase small text-muted">CDN</th>
                    <th className="text-uppercase small text-muted">Other</th>
                    <th className="text-uppercase small text-muted">NTTN</th>
                  </>
                ) : activeTab === 'channel_partner' ? (
                  <th className="text-uppercase small text-muted">Users</th>
                ) : (
                  <th className="text-uppercase small text-muted">Type</th>
                )}
                <th className="text-uppercase small text-muted">Location</th>
                <th className="text-uppercase small text-muted">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredResellers.map((res) => (
                <tr key={res.id}>
                  <td>
                    <div className="fw-bold text-dark">{res.name || '-'}</div>
                    <small className="text-muted">{res.company_name || '-'}</small>
                  </td>
                  <td>
                    <small className="text-dark fw-bold"><i className="fas fa-phone-alt text-primary me-1" /> {res.phone || '-'}</small>
                  </td>
                  {activeTab === 'distribution_partner' ? (
                    <>
                      <td><span className="badge bg-primary bg-opacity-10 text-primary">{num(res.iig_bw)} Mbps</span></td>
                      <td><span className="badge bg-success bg-opacity-10 text-success">{num(res.bdix_bw)} Mbps</span></td>
                      <td><span className="badge bg-warning bg-opacity-10 text-warning">{num(res.ggc_bw)} Mbps</span></td>
                      <td><span className="badge bg-info bg-opacity-10 text-info">{num(res.fna_bw)} Mbps</span></td>
                      <td><span className="badge bg-danger bg-opacity-10 text-danger">{num(res.cdn_bw)} Mbps</span></td>
                      <td><span className="badge bg-secondary bg-opacity-10 text-secondary">{num(res.bcdn_bw)} Mbps</span></td>
                      <td><span className="badge bg-dark bg-opacity-10 text-dark">{num(res.nttn_capacity)} Mbps</span></td>
                    </>
                  ) : activeTab === 'channel_partner' ? (
                    <td><span className="badge bg-success bg-opacity-10 text-success"><i className="fas fa-users me-1" />{num(res.channel_user_count)} Users</span></td>
                  ) : (
                    <td><span className="badge" style={{ background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe' }}><i className="fas fa-desktop me-1" />MAC Partner</span></td>
                  )}
                  <td><small className="text-muted"><i className="fas fa-map-marker-alt me-1" /> {res.pop_location || '-'}</small></td>
                  <td>
                    <Link to={`/reseller-profile/${res.id}`} className="btn btn-sm rounded-pill px-3" style={{ background: '#eef2ff', color: '#4318ff' }} title="View profile">
                      <i className="fas fa-eye" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default TasksEngineer;
