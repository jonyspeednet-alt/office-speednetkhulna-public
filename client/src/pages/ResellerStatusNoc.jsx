import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getResellerStatusNoc } from '../services/resellerService';

const bw = (val) => `${Number(val || 0)} Mbps`;

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

const ResellerStatusNoc = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusView, setStatusView] = useState('active');
  const [activeTab, setActiveTab] = useState('distribution_partner');

  const filteredRows = useMemo(() => {
    return rows.filter(r => (r.partner_type || 'distribution_partner') === activeTab);
  }, [rows, activeTab]);

  const tabCounts = useMemo(() => {
    const counts = {};
    Object.keys(PARTNER_TABS).forEach(key => {
      counts[key] = rows.filter(r => (r.partner_type || 'distribution_partner') === key).length;
    });
    return counts;
  }, [rows]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await getResellerStatusNoc({ status: statusView });
        setRows(Array.isArray(data) ? data : []);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [statusView]);

  return (
    <div className="container-fluid py-3 reseller-page">
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h2 className="fw-bold m-0"><i className="fas fa-network-wired text-primary me-2" />Reseller Status (NOC)</h2>
          <p className="text-muted mt-1 mb-0">Current bandwidth & connectivity status of resellers</p>
        </div>
        <Link to="/dashboard" className="btn btn-outline-primary rounded-pill px-4">Dashboard</Link>
      </div>

      <div className="card border-0 shadow-sm rounded-4">
        <div className="card-header bg-white border-0 py-3">
          <h5 className="fw-bold m-0"><i className="fas fa-list text-primary me-2" />Reseller Bandwidth Status</h5>
        </div>

        <div className="px-3 pt-3 pb-2 d-flex flex-sm-row flex-column gap-3">
          <div className="d-flex gap-2 flex-wrap align-items-center">
            <span className="text-muted small fw-bold me-1">Status:</span>
            <button
              type="button"
              className={`btn btn-sm ${statusView === 'active' ? 'btn-dark' : 'btn-outline-dark'}`}
              onClick={() => setStatusView('active')}
            >
              <i className="fas fa-circle text-success me-1" style={{ fontSize: 8 }} /> Active
            </button>
            <button
              type="button"
              className={`btn btn-sm ${statusView === 'inactive' ? 'btn-danger' : 'btn-outline-danger'}`}
              onClick={() => setStatusView('inactive')}
            >
              <i className="fas fa-circle text-danger me-1" style={{ fontSize: 8 }} /> Inactive
            </button>
          </div>
          <style>{TAB_STYLE}</style>
          <div className="overflow-auto pb-1">
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
        </div>

        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead style={{ backgroundColor: '#f8f9fa' }}>
              <tr>
                <th>Reseller</th>
                <th>Contact</th>
                <th>IIG</th>
                <th>BDIX</th>
                <th>GGC</th>
                <th>FNA</th>
                <th>CDN</th>
                <th>Other</th>
                <th>NTTN</th>
                <th>Location</th>
                <th className="text-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="11" className="text-center py-5 text-muted">Loading...</td></tr>
              ) : filteredRows.length === 0 ? (
                <tr><td colSpan="11" className="text-center py-5 text-muted">{statusView === 'inactive' ? 'No inactive resellers found' : 'No resellers in this section'}</td></tr>
              ) : filteredRows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <div className="fw-bold text-dark">{r.name}</div>
                    <small className="text-muted">{r.company_name || ''}</small>
                  </td>
                  <td><small className="text-dark fw-bold"><i className="fas fa-phone-alt text-primary me-1" /> {r.phone || '-'}</small></td>
                  <td><span className="badge bg-primary bg-opacity-10 text-primary" style={{ fontSize: 12, minWidth: 80 }}>{bw(r.iig_bw)}</span></td>
                  <td><span className="badge bg-success bg-opacity-10 text-success" style={{ fontSize: 12, minWidth: 80 }}>{bw(r.bdix_bw)}</span></td>
                  <td><span className="badge bg-warning bg-opacity-10 text-warning" style={{ fontSize: 12, minWidth: 80 }}>{bw(r.ggc_bw)}</span></td>
                  <td><span className="badge bg-info bg-opacity-10 text-info" style={{ fontSize: 12, minWidth: 80 }}>{bw(r.fna_bw)}</span></td>
                  <td><span className="badge bg-danger bg-opacity-10 text-danger" style={{ fontSize: 12, minWidth: 80 }}>{bw(r.cdn_bw)}</span></td>
                  <td><span className="badge bg-secondary bg-opacity-10 text-secondary" style={{ fontSize: 12, minWidth: 80 }}>{bw(r.bcdn_bw)}</span></td>
                  <td><span className="badge bg-dark bg-opacity-10 text-dark" style={{ fontSize: 12, minWidth: 80 }}>{bw(r.nttn_capacity)}</span></td>
                  <td><small className="text-muted"><i className="fas fa-map-marker-alt me-1" /> {r.pop_location || '-'}</small></td>
                  <td className="text-end">
                    <Link to={`/reseller-profile/${r.id}`} target="_blank" className="btn btn-sm rounded-pill px-3" style={{ background: '#eef2ff', color: '#4318ff' }}>
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

export default ResellerStatusNoc;
