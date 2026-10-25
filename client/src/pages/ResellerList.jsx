import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { getResellers } from '../services/resellerService';
import { notify } from '../utils/notify';
import '../styles/ResellerList.css';

const PARTNER_TABS = {
  mac_partner: { label: 'Mac Partner', kind: 'db', icon: 'fas fa-desktop' },
  channel_partner: { label: 'Channel Partner', kind: 'db', icon: 'fas fa-handshake' },
  distribution_partner: { label: 'Distribution Partner', kind: 'db', icon: 'fas fa-network-wired' }
};

const bw = (val) => Number(val || 0);

const normalize = (value) => String(value ?? '').toLowerCase();
const normalizePartnerType = (value) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (['mac_partner', 'mac partner', 'mac'].includes(raw)) return 'mac_partner';
  if (['channel_partner', 'channel partner', 'chanel_partner', 'chanel partner', 'channel', 'chanel'].includes(raw)) return 'channel_partner';
  if (['distribution_partner', 'distribution partner', 'distribution'].includes(raw)) return 'distribution_partner';
  return 'distribution_partner';
};

const getRowText = (row) => Object.values(row || {})
  .filter((value) => value !== null && value !== undefined)
  .join(' ')
  .toLowerCase();

const getVisibleSheetColumns = (headers, rows) => {
  if (Array.isArray(headers) && headers.length > 0) {
    return headers;
  }

  const seen = new Set();
  const columns = [];
  (rows || []).forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (key === '__rowNumber' || seen.has(key)) return;
      seen.add(key);
      columns.push(key);
    });
  });
  return columns;
};

const ResellerList = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'distribution_partner';

  const setActiveTab = (tabKey) => {
    setSearchParams(prev => {
      prev.set('tab', tabKey);
      return prev;
    }, { replace: true });
  };

  const [rows, setRows] = useState([]);
  const [sheetMeta, setSheetMeta] = useState({ headers: [], title: '' });
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadIdRef = useRef(0);

  const tabConfig = PARTNER_TABS[activeTab] || PARTNER_TABS.mac_partner;
  const isSheetTab = tabConfig.kind === 'sheet';

  const load = async (searchOverride) => {
    const curId = ++loadIdRef.current;
    setLoading(true);
    setError('');
    const q = typeof searchOverride === 'string' ? searchOverride : search;
    try {
      const data = await getResellers(q, { status: 'all', partner_type: activeTab });
      if (curId !== loadIdRef.current) return;
      setRows(Array.isArray(data) ? data : []);
      setSheetMeta({ headers: [], title: '' });
    } catch (err) {
      if (curId !== loadIdRef.current) return;
      const message = err?.response?.data?.message || err?.message || 'Failed to load reseller data';
      setError(message);
      notify.error(message);
      setRows([]);
    } finally {
      if (curId === loadIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  // Debounced search (400ms)
  useEffect(() => {
    const t = setTimeout(() => load(search), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    if (!isSheetTab) return undefined;
    const timer = window.setInterval(() => {
      load();
    }, 30000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSheetTab, activeTab]);

  const filteredRows = useMemo(() => {
    const term = normalize(search).trim();
    let base = rows;
    if (!isSheetTab) {
      base = rows.filter((row) => normalizePartnerType(row?.partner_type) === activeTab);
    }
    if (term) {
      base = base.filter((row) => getRowText(row).includes(term));
    }
    // Active উপরে, suspended/inactive নিচে
    const rank = (s) => String(s || 'active').toLowerCase() === 'active' ? 0 : 1;
    return [...base].sort((a, b) => {
      const d = rank(a.status) - rank(b.status);
      if (d !== 0) return d;
      return (Number(b.id) || 0) - (Number(a.id) || 0);
    });
  }, [rows, isSheetTab, search, activeTab]);

  const visibleSheetColumns = useMemo(
    () => (isSheetTab ? getVisibleSheetColumns(sheetMeta.headers, filteredRows) : []),
    [isSheetTab, sheetMeta.headers, filteredRows],
  );

  return (
    <div className="container-fluid py-5 corporate-page">
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <div style={{ maxWidth: '1600px', margin: '0 auto' }}>
        <div className="d-flex flex-column flex-xl-row justify-content-between align-items-xl-center mb-5 gap-4">
          <div className="d-flex align-items-center gap-4">
            <div className="header-icon-container">
              <i className="fas fa-building" />
            </div>
            <div>
              <h2 className="fw-bolder text-dark m-0" style={{ letterSpacing: '-0.5px', fontSize: '2rem' }}>
                Partner Directory
              </h2>
              <div className="text-secondary mt-1 fw-medium" style={{ fontSize: '1rem' }}>
                Manage and oversee all partner profiles, bandwidth allocations, and network configurations.
              </div>
            </div>
          </div>

          <div className="d-flex flex-column flex-md-row gap-3 w-100 w-xl-auto align-items-md-center">
            <div className="position-relative flex-grow-1 bg-white rounded-pill shadow-sm" style={{ minWidth: '320px', border: '1px solid #e2e8f0' }}>
              <i className="fas fa-search position-absolute text-slate-400" style={{ top: '50%', left: '20px', transform: 'translateY(-50%)', color: '#94a3b8' }} />
              <input
                className="form-control search-input ps-5 py-3 rounded-pill border-0 fw-medium text-dark"
                placeholder="Search by name, code, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ backgroundColor: 'transparent', boxShadow: 'none', outline: 'none' }}
              />
            </div>
            <button 
              className="btn px-4 py-3 rounded-pill fw-bold d-flex align-items-center justify-content-center text-white" 
              onClick={() => load(search)} 
              disabled={loading}
              style={{ background: '#1e293b', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)', transition: 'all 0.2s ease', border: 'none' }}
            >
              <i className="fas fa-sync-alt me-2" style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              Refresh
            </button>
            <Link 
              className="btn px-4 py-3 rounded-pill fw-bold d-flex align-items-center justify-content-center text-white" 
              to={`/partner-onboarding-form?partner_type=${activeTab === 'mac_partner' ? 'mac' : activeTab === 'channel_partner' ? 'channel' : 'distribution'}`}
              style={{ background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)', border: 'none', transition: 'all 0.2s ease' }}
            >
              <i className="fas fa-user-plus me-2" />
              New Partner
            </Link>
          </div>
        </div>

        <div className="mb-5 overflow-auto pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="d-inline-flex bg-white p-2 rounded-4 shadow-sm border" style={{ borderColor: '#f1f5f9' }}>
            {Object.entries(PARTNER_TABS).map(([key, tab]) => (
              <button
                key={key}
                type="button"
                disabled={loading}
                className={`btn tab-btn border-0 mx-1 d-flex align-items-center ${activeTab === key ? 'active' : 'bg-transparent'}`}
                onClick={() => setActiveTab(key)}
              >
                <i className={`${tab.icon} me-2`} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="alert alert-danger rounded-4 py-3 px-4 shadow-sm fw-medium d-flex align-items-center gap-3 mb-4 border-0" style={{ backgroundColor: '#fef2f2', color: '#991b1b' }}>
            <i className="fas fa-exclamation-circle fs-5"></i>
            <span className="flex-grow-1">{error}</span>
            <button className="btn btn-sm btn-outline-danger rounded-pill px-3" onClick={() => load(search)}>Retry</button>
            <button className="btn btn-sm btn-light rounded-pill px-2" onClick={() => setError('')}><i className="fas fa-times"></i></button>
          </div>
        )}

        <div className="table-responsive px-2 pb-5">
          <table className="table corporate-table w-100">
            {!isSheetTab ? (
              <>
                <thead>
                  <tr>
                    <th>Reseller / Company</th>
                    {activeTab !== 'channel_partner' ? (
                      <>
                        <th>NTTN Link</th>
                        <th>IIG</th>
                        <th>BDIX</th>
                        <th>GGC</th>
                        <th>FNA</th>
                        <th>CDN</th>
                        <th>Other</th>
                      </>
                    ) : (
                      <th>Total Users</th>
                    )}
                    <th>Location</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(6)].map((_, i) => (
                      <tr key={`sk-${i}`}>
                        {[...Array(activeTab === 'channel_partner' ? 4 : 10)].map((__, c) => (
                          <td key={c}><span className="ui-skeleton ui-skeleton-line" /></td>
                        ))}
                      </tr>
                    ))
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={activeTab === 'channel_partner' ? 4 : 10}>
                        <div className="ui-empty">
                          <i className="fas fa-search ui-empty-icon"></i>
                          <span className="ui-empty-title">
                            {activeTab === 'mac_partner'
                              ? 'No Mac partner found'
                              : activeTab === 'channel_partner'
                                ? 'No Channel partner found'
                                : 'No Distribution partner found'}
                          </span>
                          <span className="ui-empty-sub">Try adjusting your search query or add a new partner.</span>
                          <div className="d-flex gap-2 justify-content-center mt-3">
                            {search && <button className="btn btn-sm btn-outline-secondary rounded-pill px-3" onClick={() => setSearch('')}><i className="fas fa-times me-1"></i>Clear search</button>}
                            <Link className="btn btn-sm btn-success rounded-pill px-3" to={`/partner-onboarding-form?partner_type=${activeTab === 'mac_partner' ? 'mac' : activeTab === 'channel_partner' ? 'channel' : 'distribution'}`}><i className="fas fa-user-plus me-1"></i>New Partner</Link>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : filteredRows.map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/reseller-profile/${r.id}`, { state: { from: '/reseller-list' } })}>
                      <td>
                        <div className="d-flex align-items-center gap-3">
                          <div className="avatar-circle">
                            {(r.name || r.company_name || r.reseller_code || 'P').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="fw-bold text-dark fs-6" style={{ letterSpacing: '-0.3px' }}>{r.name}</div>
                            <div className="text-secondary small fw-medium mt-1 d-flex align-items-center gap-2">
                              <span className="badge bg-slate-100 text-slate-600 border px-2 py-1" style={{ backgroundColor: '#f1f5f9', color: '#475569', borderColor: '#e2e8f0' }}>
                                #{r.reseller_code || r.id}
                              </span>
                              <span>{r.company_name}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      {activeTab !== 'channel_partner' ? (
                        <>
                          <td>
                            {r.nttn_link ? (
                              <a
                                href={r.nttn_link.startsWith('http') ? r.nttn_link : `https://${r.nttn_link}`}
                                target="_blank"
                                rel="noreferrer"
                                className="corporate-link"
                                title={r.nttn_link}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <i className="fas fa-external-link-alt"></i> 
                                <span className="d-inline-block text-truncate" style={{ maxWidth: '120px' }}>{r.nttn_link}</span>
                              </a>
                            ) : (
                              <span className="text-slate-300 fw-medium" style={{ color: '#cbd5e1' }}>- None -</span>
                            )}
                          </td>
                          <td><div className="corporate-badge">{bw(r.iig_bw)} <span style={{ fontSize: '0.65rem' }}>M</span></div></td>
                          <td><div className="corporate-badge">{bw(r.bdix_bw)} <span style={{ fontSize: '0.65rem' }}>M</span></div></td>
                          <td><div className="corporate-badge">{bw(r.ggc_bw)} <span style={{ fontSize: '0.65rem' }}>M</span></div></td>
                          <td><div className="corporate-badge">{bw(r.fna_bw)} <span style={{ fontSize: '0.65rem' }}>M</span></div></td>
                          <td><div className="corporate-badge">{bw(r.cdn_bw)} <span style={{ fontSize: '0.65rem' }}>M</span></div></td>
                          <td><div className="corporate-badge">{bw(r.bcdn_bw)} <span style={{ fontSize: '0.65rem' }}>M</span></div></td>
                        </>
                      ) : (
                        <td>
                          <div className="corporate-badge px-3 py-2" style={{ backgroundColor: '#eff6ff', borderColor: '#bfdbfe', color: '#1d4ed8' }}>
                            <i className="fas fa-users"></i> {r.channel_user_count || 0} <span>Users</span>
                          </div>
                        </td>
                      )}
                      <td>
                        {r.pop_location ? (
                          <span className="d-flex align-items-center gap-2 text-secondary fw-semibold">
                            <i className="fas fa-map-marker-alt text-danger opacity-75"></i>
                            {r.pop_location}
                          </span>
                        ) : <span className="text-slate-300 fw-medium" style={{ color: '#cbd5e1' }}>-</span>}
                      </td>
                      <td>
                        <span className={`status-badge ${String(r.status || 'active').toLowerCase() === 'active' ? 'status-active' : 'status-inactive'}`}>
                          <span className="status-dot"></span>
                          {String(r.status || 'active').toUpperCase()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            ) : (
              <>
                <thead>
                  <tr>
                    {visibleSheetColumns.map((column) => (
                      <th key={column}>{column}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(6)].map((_, i) => (
                      <tr key={`sk-${i}`}>
                        {[...Array(Math.max(visibleSheetColumns.length, 1))].map((__, c) => (
                          <td key={c}><span className="ui-skeleton ui-skeleton-line" /></td>
                        ))}
                      </tr>
                    ))
                  ) : filteredRows.length === 0 ? (
                    <tr>
                      <td colSpan={Math.max(visibleSheetColumns.length, 1)}>
                        <div className="ui-empty">
                          <i className="fas fa-table ui-empty-icon"></i>
                          <span className="ui-empty-title">No rows found in {tabConfig.label}</span>
                        </div>
                      </td>
                    </tr>
                  ) : filteredRows.map((row, index) => (
                    <tr key={`${activeTab}-${row.__rowNumber || index}`}>
                      {visibleSheetColumns.map((column) => (
                        <td key={column}>
                          <span className="fw-medium text-dark">{String(row?.[column] ?? '').trim() || <span className="text-slate-300">-</span>}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

export default ResellerList;
