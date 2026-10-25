import React, { useState, useEffect } from 'react';
import { getPartnerLifetimeReport } from '../../../services/resellerService';

const money = (v) => Number(v || 0).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const LifetimeReportTab = ({ resellerId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    if (!resellerId) return;
    setLoading(true);
    setError(null);
    getPartnerLifetimeReport(resellerId)
      .then((res) => { setData(res); setLoading(false); })
      .catch((err) => { setError(err?.response?.data?.message || 'Failed to load report'); setLoading(false); });
  }, [resellerId]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="rp-loading-page"><div className="spinner-border text-primary" /></div></div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{error}</div>;
  if (!data) return null;

  const { profile, current_bandwidth, bw_summary, bw_change_log, billing_summary, billing_history, rates } = data;
  const totalCurrentBw = Object.values(current_bandwidth).reduce((s, v) => s + v, 0);

  const SectionNav = () => (
    <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
      {[
        { key: 'overview', label: 'Overview', icon: 'fa-chart-pie' },
        { key: 'bandwidth', label: 'Bandwidth Changes', icon: 'fa-network-wired' },
        { key: 'billing', label: 'Billing History', icon: 'fa-file-invoice-dollar' },
      ].map((s) => (
        <button key={s.key} onClick={() => setActiveSection(s.key)}
          style={{
            padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
            background: activeSection === s.key ? '#4318ff' : '#f1f5f9',
            color: activeSection === s.key ? '#fff' : '#64748b',
            transition: 'all 0.2s',
          }}>
          <i className={`fas ${s.icon}`} style={{ marginRight: 6 }} />{s.label}
        </button>
      ))}
    </div>
  );

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Header */}
      <div style={{ marginBottom: 20, paddingBottom: 12, borderBottom: '2px solid #e2e8f0' }}>
        <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#1e293b' }}>
          <i className="fas fa-chart-column" style={{ marginRight: 8, color: '#4318ff' }} />
          Lifetime Report — {profile.name || profile.company}
        </h4>
        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4 }}>
          {profile.partner_type?.replace(/_/g, ' ')} • Since {profile.joining_date ? new Date(profile.joining_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'N/A'}
        </div>
      </div>

      <SectionNav />

      {/* ========== OVERVIEW ========== */}
      {activeSection === 'overview' && (
        <>
          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
            {[
              { label: 'Current BW', value: `${totalCurrentBw} Mbps`, icon: 'fa-network-wired', color: '#4318ff', bg: '#f0f4ff' },
              { label: 'Total Increase', value: `${bw_summary.reduce((s, b) => s + b.increase, 0)} Mbps`, icon: 'fa-arrow-up', color: '#059669', bg: '#f0fdf4' },
              { label: 'Total Decrease', value: `${bw_summary.reduce((s, b) => s + b.decrease, 0)} Mbps`, icon: 'fa-arrow-down', color: '#dc2626', bg: '#fef2f2' },
              { label: 'Total Billed', value: `৳${money(billing_summary.total_billed)}`, icon: 'fa-file-invoice', color: '#7c3aed', bg: '#f5f3ff' },
              { label: 'Total Paid', value: `৳${money(billing_summary.total_paid)}`, icon: 'fa-hand-holding-dollar', color: '#059669', bg: '#f0fdf4' },
              { label: 'Current Due', value: `৳${money(billing_summary.total_due)}`, icon: 'fa-exclamation-circle', color: billing_summary.total_due > 0 ? '#dc2626' : '#059669', bg: billing_summary.total_due > 0 ? '#fef2f2' : '#f0fdf4' },
            ].map((c) => (
              <div key={c.label} style={{ background: c.bg, borderRadius: 12, padding: '14px 16px', border: `1px solid ${c.color}15` }}>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <i className={`fas ${c.icon}`} style={{ marginRight: 6, color: c.color }} />{c.label}
                </div>
                <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#1e293b', marginTop: 4 }}>{c.value}</div>
              </div>
            ))}
          </div>

          {/* BW Summary per Type */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden', marginBottom: 20 }}>
            <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <h6 style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>
                <i className="fas fa-layer-group" style={{ marginRight: 8, color: '#4318ff' }} />Bandwidth Summary by Type
              </h6>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={thStyle}>Type</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Current (Mbps)</th>
                    <th style={{ ...thStyle, textAlign: 'right', color: '#059669' }}>Total Increase</th>
                    <th style={{ ...thStyle, textAlign: 'right', color: '#dc2626' }}>Total Decrease</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Net Change</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Rate (Tk/Mbps)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Monthly Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {bw_summary.filter((b) => b.current > 0 || b.increase > 0 || b.decrease > 0).map((b) => (
                    <tr key={b.type} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}><span style={{ fontWeight: 700 }}>{b.type}</span></td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{b.current}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: '#059669', fontWeight: 600 }}>+{b.increase}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: '#dc2626', fontWeight: 600 }}>-{b.decrease}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: b.net_change >= 0 ? '#059669' : '#dc2626' }}>
                        {b.net_change >= 0 ? '+' : ''}{b.net_change}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', color: '#64748b' }}>{rates[b.type.toLowerCase()] || 0}</td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>৳{money(b.current * (rates[b.type.toLowerCase()] || 0))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td style={tdStyle}>Total</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{totalCurrentBw}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#059669' }}>+{bw_summary.reduce((s, b) => s + b.increase, 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#dc2626' }}>-{bw_summary.reduce((s, b) => s + b.decrease, 0)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{bw_summary.reduce((s, b) => s + b.net_change, 0)}</td>
                    <td style={tdStyle}></td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>৳{money(bw_summary.reduce((s, b) => s + b.current * (rates[b.type.toLowerCase()] || 0), 0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Billing Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 20 }}>
            <div style={{ background: '#f5f3ff', borderRadius: 12, padding: '14px 16px', border: '1px solid #7c3aed15' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>MONTHS BILLED</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#1e293b', marginTop: 4 }}>{billing_summary.months_count}</div>
            </div>
            <div style={{ background: '#fef2f2', borderRadius: 12, padding: '14px 16px', border: '1px solid #dc262615' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>TOTAL ADJUSTMENT</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#dc2626', marginTop: 4 }}>৳{money(billing_summary.total_adjustment)}</div>
            </div>
            <div style={{ background: '#f0fdf4', borderRadius: 12, padding: '14px 16px', border: '1px solid #05966915' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>TOTAL DISCOUNT</div>
              <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#059669', marginTop: 4 }}>৳{money(billing_summary.total_discount)}</div>
            </div>
          </div>
        </>
      )}

      {/* ========== BANDWIDTH CHANGES ========== */}
      {activeSection === 'bandwidth' && (
        <>
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h6 style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>
                <i className="fas fa-exchange-alt" style={{ marginRight: 8, color: '#4318ff' }} />All Bandwidth Changes ({bw_change_log.length})
              </h6>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={thStyle}>#</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Change</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Amount (Mbps)</th>
                  </tr>
                </thead>
                <tbody>
                  {bw_change_log.length === 0 ? (
                    <tr><td colSpan="5" style={{ ...tdStyle, textAlign: 'center', padding: 30, color: '#94a3b8' }}>No bandwidth changes recorded</td></tr>
                  ) : [...bw_change_log].reverse().map((r, i) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={tdStyle}>{bw_change_log.length - i}</td>
                      <td style={tdStyle}>{r.impl_date ? new Date(r.impl_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</td>
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700,
                          background: '#f0f4ff', color: '#4318ff',
                        }}>{(r.bw_type || '').toUpperCase()}</span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700,
                          background: r.change_type === 'increase' ? '#f0fdf4' : '#fef2f2',
                          color: r.change_type === 'increase' ? '#059669' : '#dc2626',
                        }}>
                          <i className={`fas fa-arrow-${r.change_type === 'increase' ? 'up' : 'down'}`} style={{ marginRight: 4 }} />
                          {r.change_type}
                        </span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: r.change_type === 'increase' ? '#059669' : '#dc2626' }}>
                        {r.change_type === 'increase' ? '+' : '-'}{r.amount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ========== BILLING HISTORY ========== */}
      {activeSection === 'billing' && (
        <>
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              <h6 style={{ margin: 0, fontSize: '0.82rem', fontWeight: 700, color: '#1e293b' }}>
                <i className="fas fa-file-invoice-dollar" style={{ marginRight: 8, color: '#7c3aed' }} />Monthly Billing History ({billing_history.length} months)
              </h6>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    <th style={thStyle}>Month</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Billed (৳)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Adjustment (৳)</th>
                    <th style={{ ...thStyle, textAlign: 'right', color: '#059669' }}>Paid (৳)</th>
                    <th style={{ ...thStyle, textAlign: 'right', color: '#059669' }}>Discount (৳)</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Due (৳)</th>
                  </tr>
                </thead>
                <tbody>
                  {billing_history.length === 0 ? (
                    <tr><td colSpan="6" style={{ ...tdStyle, textAlign: 'center', padding: 30, color: '#94a3b8' }}>No billing history</td></tr>
                  ) : [...billing_history].reverse().map((row) => {
                    const [y, m] = row.month.split('-');
                    const monthLabel = new Date(y, m - 1).toLocaleString('en', { month: 'short', year: 'numeric' });
                    return (
                      <tr key={row.month} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ ...tdStyle, fontWeight: 600 }}>{monthLabel}</td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>৳{money(row.billed)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: row.adjustment !== 0 ? '#dc2626' : '#94a3b8' }}>
                          {row.adjustment !== 0 ? `৳${money(row.adjustment)}` : '-'}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#059669', fontWeight: 600 }}>৳{money(row.paid)}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', color: '#059669' }}>{row.discount > 0 ? `৳${money(row.discount)}` : '-'}</td>
                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, color: row.due > 0 ? '#dc2626' : '#059669' }}>৳{money(row.due)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                    <td style={tdStyle}>Total</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>৳{money(billing_summary.total_billed)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#dc2626' }}>৳{money(billing_summary.total_adjustment)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#059669' }}>৳{money(billing_summary.total_paid)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: '#059669' }}>৳{money(billing_summary.total_discount)}</td>
                    <td style={{ ...tdStyle, textAlign: 'right', color: billing_summary.total_due > 0 ? '#dc2626' : '#059669' }}>৳{money(billing_summary.total_due)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const thStyle = { padding: '10px 12px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: 0.5 };
const tdStyle = { padding: '10px 12px', color: '#1e293b' };

export default LifetimeReportTab;
