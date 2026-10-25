import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getBandwidthRequests, reviewBandwidthRequest } from '../services/resellerService';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';

const rateKeyByType = { IIG: 'rate_iig', BDIX: 'rate_bdix', GGC: 'rate_ggc', FNA: 'rate_fna', CDN: 'rate_cdn', OTHER: 'rate_bcdn', BCDN: 'rate_bcdn', NTTN: 'rate_nttn' };
const filterMeta = {
  pending: { title: 'Pending Flow', subtitle: 'Fresh requests waiting for review', icon: 'fa-hourglass-half' },
  rejected: { title: 'Rejected Vault', subtitle: 'Restore requests back to queue', icon: 'fa-rotate-left' },
  approved: { title: 'Approved Stream', subtitle: 'Already cleared by management', icon: 'fa-circle-check' }
};
const emptyMessageByStatus = {
  pending: 'No pending requests right now.',
  rejected: 'No rejected requests right now.',
  approved: 'No approved requests right now.'
};

const prettyType = (value) => {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return 'IIG';
  if (raw === 'BCDN') return 'Other';
  if (raw.endsWith('_BW')) return raw.replace('_BW', '');
  return raw;
};
const datePart = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const timePart = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
};

const RequestsAdmin = () => {
  const [rows, setRows] = useState([]);
  const [busyKey, setBusyKey] = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');

  const load = useCallback(async () => {
    try {
      const data = await getBandwidthRequests(statusFilter);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Failed to load bandwidth requests');
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      const key = String(row.reseller_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row);
    });
    return Array.from(map.entries());
  }, [rows]);

  const summary = useMemo(() => {
    const totalImpact = groups.reduce((acc, [, list]) => {
      const first = list[0] || {};
      return acc + list.reduce((sum, req) => {
        const type = prettyType(req.bw_type).toUpperCase();
        const rateKey = rateKeyByType[type] || 'rate_iig';
        const rate = Number(first[rateKey] || 0);
        const delta = Number(req.requested_bw_mbps || 0) * rate;
        return sum + (String(req.change_type || '').toLowerCase() === 'decrease' ? -delta : delta);
      }, 0);
    }, 0);
    return { requestCount: rows.length, resellerCount: groups.length, totalImpact };
  }, [rows, groups]);

  const singleAction = async (id, status) => {
    const titleMap = { approved: 'Approve this request?', rejected: 'Reject this request?', pending: 'Move this request back to pending?' };
    const title = titleMap[status] || 'Please confirm';
    if (!(await confirmAction({ title, danger: status === 'rejected' }))) return;
    setBusyKey(`${id}-${status}`);
    try {
      await reviewBandwidthRequest(id, status);
      notify.success(status === 'approved' ? 'Approved successfully' : status === 'rejected' ? 'Rejected successfully' : 'Moved to pending');
      await load();
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Action failed');
    } finally {
      setBusyKey('');
    }
  };

  const batchAction = async (resellerId, status) => {
    const confirmText = status === 'approved'
      ? 'Are you sure you want to approve all requests for this reseller?'
      : status === 'rejected'
        ? 'Are you sure you want to reject all requests for this reseller?'
        : 'Are you sure you want to move these rejected requests back to pending?';
    if (!(await confirmAction({ title: confirmText, danger: status === 'rejected' }))) return;
    const list = rows.filter((r) => String(r.reseller_id) === String(resellerId));
    if (!list.length) return;
    setBusyKey(`batch-${resellerId}-${status}`);
    try {
      for (const item of list) await reviewBandwidthRequest(item.id, status);
      notify.success(`${list.length} request(s) ${status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'moved to pending'} successfully`);
      await load();
    } catch (err) {
      notify.error(err?.response?.data?.message || err?.message || 'Batch action failed');
    } finally {
      setBusyKey('');
    }
  };

  const activeMeta = filterMeta[statusFilter];

  return (
    <div className="requests-admin-page">
      <style>{`
        .requests-admin-page{padding:1.5rem 0 2.5rem;background:radial-gradient(circle at top left,rgba(245,158,11,.16),transparent 28%),radial-gradient(circle at top right,rgba(14,165,233,.12),transparent 24%),linear-gradient(180deg,#f8f3ea 0%,#f3efe8 45%,#f6f7fb 100%);color:#1f2937}
        .ra-shell{width:min(1220px,calc(100% - 24px));margin:0 auto}.ra-hero,.ra-side,.ra-board,.ra-card{border-radius:26px;box-shadow:0 24px 50px rgba(146,64,14,.08)}
        .ra-hero{padding:2rem;border:1px solid rgba(255,255,255,.55);background:linear-gradient(135deg,rgba(120,53,15,.95),rgba(194,65,12,.88) 45%,rgba(251,146,60,.82));color:#fffaf5}
        .ra-hero-top,.ra-board-top,.ra-impact{display:flex;justify-content:space-between;gap:1rem}.ra-hero-top{align-items:flex-start;margin-bottom:1.5rem}.ra-board-top,.ra-impact{align-items:center}
        .ra-eyebrow,.ra-chip,.ra-pill,.ra-shift,.ra-link{display:inline-flex;align-items:center;gap:.55rem;border-radius:999px}
        .ra-eyebrow{padding:.45rem .8rem;background:rgba(255,255,255,.12);font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.85rem}.ra-hero h1{font-size:clamp(1.9rem,4vw,3rem);line-height:1.02;margin:0 0 .7rem;font-weight:800;max-width:720px}.ra-hero p{margin:0;max-width:720px;color:rgba(255,250,245,.82)}
        .ra-link{padding:.8rem 1rem;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.12);color:#fff;text-decoration:none;font-weight:600}
        .ra-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1rem}.ra-stat{padding:1rem 1.1rem;border-radius:20px;background:rgba(255,255,255,.12)}.ra-stat-label{font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,250,245,.7);margin-bottom:.5rem}.ra-stat-value{font-size:1.65rem;font-weight:800;line-height:1}.ra-stat-note{margin-top:.35rem;color:rgba(255,250,245,.74);font-size:.88rem}
        .ra-main{display:grid;grid-template-columns:280px minmax(0,1fr);gap:1.25rem;margin-top:1.25rem}.ra-side,.ra-board{border:1px solid rgba(148,163,184,.22);background:rgba(255,252,247,.9);backdrop-filter:blur(12px)}.ra-side{padding:1rem;align-self:start;position:sticky;top:1rem}.ra-side-title{font-size:.82rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#6b7280;margin-bottom:.8rem}
        .ra-filter-btn{width:100%;text-align:left;border:1px solid transparent;border-radius:18px;padding:.95rem 1rem;background:transparent;color:#1f2937;display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.7rem}.ra-filter-btn.is-active{background:linear-gradient(135deg,rgba(194,65,12,.95),rgba(249,115,22,.88));color:#fff7ed}.ra-filter-copy strong{display:block;font-size:.98rem;margin-bottom:.15rem}.ra-filter-copy span{display:block;font-size:.8rem;opacity:.82}.ra-filter-count{min-width:34px;height:34px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;background:rgba(15,23,42,.06)}
        .ra-side-panel{border-radius:20px;padding:1rem;background:linear-gradient(180deg,rgba(255,255,255,.92),rgba(255,250,244,.86));border:1px solid rgba(148,163,184,.16)}.ra-side-panel h4{margin:0 0 .45rem;font-size:1rem;font-weight:700}.ra-side-panel p,.ra-board-title p,.ra-brand p,.ra-meta p,.ra-empty p{margin:0;color:#6b7280}
        .ra-board{padding:1.1rem}.ra-board-title h3,.ra-empty h4{margin:0 0 .25rem;font-weight:800}.ra-board-title h3{font-size:1.35rem}.ra-chip{padding:.7rem .95rem;background:rgba(194,65,12,.12);color:#c2410c;font-weight:700;font-size:.88rem}
        .ra-list{display:grid;gap:1rem}.ra-card{overflow:hidden;border:1px solid rgba(226,232,240,.94);background:#fffdf9}.ra-card-head{display:grid;grid-template-columns:1.15fr 1fr auto;gap:1rem;padding:1.25rem;background:linear-gradient(180deg,rgba(255,255,255,.95),rgba(250,248,244,.95))}
        .ra-brand{display:flex;gap:.9rem;align-items:flex-start}.ra-brand-mark{width:48px;height:48px;border-radius:16px;display:inline-flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#fed7aa,#fdba74);color:#9a3412;font-size:1.15rem}.ra-brand h4{margin:0 0 .22rem;font-size:1.1rem;font-weight:800}.ra-meta strong{display:block;margin-bottom:.2rem;font-size:.82rem;text-transform:uppercase;letter-spacing:.08em;color:#9a3412}
        .ra-batch{display:flex;flex-direction:column;gap:.6rem;min-width:190px}.ra-btn{border:0;border-radius:14px;padding:.82rem 1rem;font-weight:700;display:inline-flex;justify-content:center;align-items:center;gap:.55rem}.ra-btn-approve{background:linear-gradient(135deg,#059669,#10b981);color:#ecfdf5}.ra-btn-reject{background:linear-gradient(135deg,#dc2626,#f97316);color:#fff7ed}.ra-btn-undo{background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#78350f}
        .ra-items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.85rem;padding:0 1.25rem 1.25rem}.ra-item{border-radius:18px;border:1px solid rgba(226,232,240,.85);padding:1rem;background:linear-gradient(180deg,#fff,#fffaf4);display:grid;grid-template-columns:auto 1fr auto;gap:.9rem;align-items:center}
        .ra-item-badge{min-width:72px;text-align:center;padding:.55rem .75rem;border-radius:14px;background:#fff1df;color:#9a3412;font-weight:800;font-size:.85rem}.ra-item-main strong{display:block;font-size:1rem;margin-bottom:.2rem}.ra-item-main small{color:#6b7280;font-size:.85rem}.ra-shift{padding:.46rem .7rem;font-weight:800;font-size:.85rem}.ra-shift.up{background:rgba(5,150,105,.12);color:#047857}.ra-shift.down{background:rgba(220,38,38,.1);color:#b91c1c}
        .ra-submeta{display:flex;flex-wrap:wrap;gap:.45rem;margin-top:.55rem}.ra-pill{padding:.36rem .62rem;background:#fff7ed;color:#b45309;border:1px solid rgba(245,158,11,.18);font-size:.77rem;font-weight:700}.ra-actions{display:inline-flex;gap:.5rem;align-items:center}.ra-icon-btn{width:42px;height:42px;border-radius:12px;border:1px solid rgba(226,232,240,.9);background:#fff;display:inline-flex;align-items:center;justify-content:center}.ra-icon-btn.approve{color:#047857}.ra-icon-btn.reject{color:#b91c1c}.ra-icon-btn.undo{color:#b45309}
        .ra-impact{border-top:1px solid rgba(226,232,240,.9);padding:1rem 1.25rem 1.15rem;background:linear-gradient(180deg,rgba(248,250,252,.72),rgba(255,255,255,.96))}.ra-impact span{color:#6b7280;font-size:.9rem}.ra-impact strong{font-size:1.05rem}.ra-impact.positive strong{color:#047857}.ra-impact.negative strong{color:#b91c1c}
        .ra-empty{padding:3rem 1.5rem;border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.96),rgba(255,249,242,.88));border:1px dashed rgba(194,65,12,.22);text-align:center}.ra-empty i{font-size:2rem;color:#f59e0b;margin-bottom:.8rem}
        @media (max-width:1100px){.ra-main,.ra-card-head,.ra-items{grid-template-columns:1fr}.ra-side{position:static}.ra-batch{min-width:0}.ra-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media (max-width:640px){.requests-admin-page{padding-top:.75rem}.ra-shell{width:min(100%,calc(100% - 16px))}.ra-hero,.ra-side,.ra-board,.ra-card{border-radius:22px}.ra-hero{padding:1.25rem}.ra-hero-top,.ra-impact{flex-direction:column;align-items:flex-start}.ra-stats{grid-template-columns:1fr}.ra-item{grid-template-columns:1fr}.ra-actions{width:100%;justify-content:flex-end}}
      `}</style>

      <div className="ra-shell">
        <section className="ra-hero">
          <div className="ra-hero-top">
            <div>
              <div className="ra-eyebrow"><i className="fas fa-wave-square" />Requests Admin</div>
              <h1>Bandwidth approval flow, rebuilt for faster review.</h1>
              <p>Grouped cards, stronger visual hierarchy, and a cleaner undo path so management can move through requests with less friction.</p>
            </div>
            <Link to="/reseller-list" className="ra-link"><i className="fas fa-list" />Reseller List</Link>
          </div>
          <div className="ra-stats">
            <div className="ra-stat"><div className="ra-stat-label">Current Lane</div><div className="ra-stat-value">{activeMeta.title}</div><div className="ra-stat-note">{activeMeta.subtitle}</div></div>
            <div className="ra-stat"><div className="ra-stat-label">Requests</div><div className="ra-stat-value">{summary.requestCount}</div><div className="ra-stat-note">Visible in this filter</div></div>
            <div className="ra-stat"><div className="ra-stat-label">Resellers</div><div className="ra-stat-value">{summary.resellerCount}</div><div className="ra-stat-note">Grouped approval batches</div></div>
            <div className="ra-stat"><div className="ra-stat-label">Bill Impact</div><div className="ra-stat-value">{`${summary.totalImpact >= 0 ? '+' : ''}${summary.totalImpact.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}</div><div className="ra-stat-note">Estimated total in BDT</div></div>
          </div>
        </section>

        <section className="ra-main">
          <aside className="ra-side">
            <div className="ra-side-title">Workflow View</div>
            {Object.entries(filterMeta).map(([key, meta]) => (
              <button key={key} type="button" className={`ra-filter-btn ${statusFilter === key ? 'is-active' : ''}`} onClick={() => setStatusFilter(key)}>
                <div className="ra-filter-copy"><strong><i className={`fas ${meta.icon} me-2`} />{meta.title}</strong><span>{meta.subtitle}</span></div>
                <span className="ra-filter-count">{statusFilter === key ? rows.length : ''}</span>
              </button>
            ))}
            <div className="ra-side-panel"><h4>Review Tip</h4><p>In the Rejected lane, use `Undo Reject` to move a request back to the pending queue. In the Pending lane, you can batch approve or reject reseller-wise.</p></div>
          </aside>

          <section className="ra-board">
            <div className="ra-board-top">
              <div className="ra-board-title"><h3>{activeMeta.title}</h3><p>{activeMeta.subtitle}</p></div>
              <div className="ra-chip"><i className={`fas ${activeMeta.icon}`} />{rows.length} item visible</div>
            </div>

            {groups.length === 0 ? (
              <div className="ra-empty"><i className={`fas ${activeMeta.icon}`} /><h4>{activeMeta.title} is clear</h4><p>{emptyMessageByStatus[statusFilter]}</p></div>
            ) : (
              <div className="ra-list">
                {groups.map(([resellerId, list]) => {
                  const first = list[0] || {};
                  const totalImpact = list.reduce((acc, req) => {
                    const type = prettyType(req.bw_type).toUpperCase();
                    const rateKey = rateKeyByType[type] || 'rate_iig';
                    const rate = Number(first[rateKey] || 0);
                    const cost = Number(req.requested_bw_mbps || 0) * rate;
                    return acc + (String(req.change_type || '').toLowerCase() === 'decrease' ? -cost : cost);
                  }, 0);

                  return (
                    <article className="ra-card" key={resellerId}>
                      <div className="ra-card-head">
                        <div className="ra-brand">
                          <div className="ra-brand-mark"><i className="fas fa-tower-broadcast" /></div>
                          <div><h4>{first.reseller_name || '-'}</h4><p>{first.company_name || '-'}</p></div>
                        </div>
                        <div className="ra-meta"><strong>Request Window</strong><p>{datePart(first.created_at)} at {timePart(first.created_at) || '-'}</p><p>{list.length} request item in this batch</p></div>
                        <div className="ra-batch">
                          {statusFilter === 'rejected' ? (
                            <button type="button" className="ra-btn ra-btn-undo" disabled={busyKey.startsWith(`batch-${resellerId}`)} onClick={() => batchAction(resellerId, 'pending')}><i className="fas fa-rotate-left" />Undo Reject All</button>
                          ) : (
                            <>
                              <button type="button" className="ra-btn ra-btn-approve" disabled={busyKey.startsWith(`batch-${resellerId}`)} onClick={() => batchAction(resellerId, 'approved')}><i className="fas fa-check-double" />Approve All</button>
                              <button type="button" className="ra-btn ra-btn-reject" disabled={busyKey.startsWith(`batch-${resellerId}`)} onClick={() => batchAction(resellerId, 'rejected')}><i className="fas fa-ban" />Reject All</button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="ra-items">
                        {list.map((req) => {
                          const up = String(req.change_type || '').toLowerCase() !== 'decrease';
                          const eff = req.requested_effective_date ? datePart(req.requested_effective_date) : '';
                          const isRejectedView = statusFilter === 'rejected';
                          return (
                            <div className="ra-item" key={req.id}>
                              <div className="ra-item-badge">{prettyType(req.bw_type)}</div>
                              <div className="ra-item-main">
                                <strong><span className={`ra-shift ${up ? 'up' : 'down'}`}><i className={`fas ${up ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}`} />{`${up ? '+' : '-'}${Number(req.requested_bw_mbps || 0)} Mbps`}</span></strong>
                                <div className="ra-submeta">
                                  {eff ? <span className="ra-pill"><i className="far fa-clock" />Req: {eff}</span> : null}
                                  <span className="ra-pill"><i className="fas fa-hashtag" />ID {req.id}</span>
                                </div>
                                <small>{req.reason || 'No note provided'}</small>
                              </div>
                              <div className="ra-actions">
                                {isRejectedView ? (
                                  <button type="button" className="ra-icon-btn undo" title="Undo Reject" disabled={busyKey === `${req.id}-pending` || busyKey.startsWith(`batch-${resellerId}`)} onClick={() => singleAction(req.id, 'pending')}><i className="fas fa-rotate-left" /></button>
                                ) : (
                                  <>
                                    <button type="button" className="ra-icon-btn approve" title="Approve Single" disabled={busyKey === `${req.id}-approved` || busyKey.startsWith(`batch-${resellerId}`)} onClick={() => singleAction(req.id, 'approved')}><i className="fas fa-check" /></button>
                                    <button type="button" className="ra-icon-btn reject" title="Reject Single" disabled={busyKey === `${req.id}-rejected` || busyKey.startsWith(`batch-${resellerId}`)} onClick={() => singleAction(req.id, 'rejected')}><i className="fas fa-xmark" /></button>
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <div className={`ra-impact ${totalImpact >= 0 ? 'positive' : 'negative'}`}>
                        <span>Estimated total bill movement for this reseller batch</span>
                        <strong>{`${totalImpact >= 0 ? '+' : ''}${totalImpact.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ৳`}</strong>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  );
};

export default RequestsAdmin;
