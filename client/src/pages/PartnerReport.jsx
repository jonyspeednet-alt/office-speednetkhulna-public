import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bar, Line, Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler } from 'chart.js';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { getPartnerReport, getPartnerTrends, getPartnerDetailReport } from '../services/resellerService';
import '../styles/PartnerReport.css';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, ArcElement, Tooltip, Legend, Filler);

const PARTNER_TYPES = {
  all: { label: 'All', icon: 'fa-globe' },
  distribution_partner: { label: 'Distribution', icon: 'fa-network-wired' },
  channel_partner: { label: 'Channel', icon: 'fa-handshake' },
  mac_partner: { label: 'MAC', icon: 'fa-desktop' },
};

const BW_COLORS = {
  iig: '#4318ff',
  bdix: '#05cd99',
  ggc: '#ffb547',
  fna: '#0dcaf0',
  cdn: '#e31a1a',
  bcdn: '#6c757d',
  nttn: '#212529',
};

const money = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const PartnerReport = () => {
  const navigate = useNavigate();
  const snapshotRef = useRef(null);
  const [reportData, setReportData] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [partnerType, setPartnerType] = useState('all');
  const [search, setSearch] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'projected', dir: 'desc' });
  const [selectedPartnerId, setSelectedPartnerId] = useState(null);
  const [detailData, setDetailData] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const params = partnerType !== 'all' ? { partner_type: partnerType } : {};
        const [report, trends] = await Promise.all([
          getPartnerReport(params),
          getPartnerTrends({ months: 12, ...params }),
        ]);
        setReportData(report);
        setTrendData(trends);
      } catch (err) {
        const msg = err?.response?.data?.message || err?.message || 'Failed to load data';
        console.error('Failed to load partner report:', err);
        setError(msg);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [partnerType]);

  const loadPartnerDetail = async (partnerId) => {
    setSelectedPartnerId(partnerId);
    setDetailLoading(true);
    setDetailError('');
    setDetailData(null);
    try {
      const data = await getPartnerDetailReport(partnerId, { months: 12 });
      setDetailData(data);
    } catch (err) {
      setDetailError(err?.response?.data?.message || 'Partner data load failed');
    } finally {
      setDetailLoading(false);
    }
  };

  const closeDetail = () => {
    setSelectedPartnerId(null);
    setDetailData(null);
    setDetailError('');
  };

  const summary = reportData?.summary;
  const partners = useMemo(() => reportData?.partners || [], [reportData?.partners]);
  const trends = useMemo(() => trendData?.trends || [], [trendData?.trends]);
  const bwByType = useMemo(() => trendData?.bandwidth_by_type || [], [trendData?.bandwidth_by_type]);

  const filteredPartners = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = q ? partners.filter((p) => `${p.name} ${p.company}`.toLowerCase().includes(q)) : [...partners];
    const { key, dir } = sortConfig;
    list.sort((a, b) => {
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      return dir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [partners, search, sortConfig]);

  const handleSort = (key) => {
    setSortConfig((prev) => ({ key, dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc' }));
  };

  // Chart: Bandwidth Allocation
  const bwChartData = useMemo(() => {
    const labels = [];
    const datasets = [];
    const typeLabels = { distribution_partner: 'Distribution', channel_partner: 'Channel', mac_partner: 'MAC' };
    const bwKeys = ['iig', 'bdix', 'ggc', 'fna', 'cdn', 'bcdn'];
    const bwLabels = ['IIG', 'BDIX', 'GGC', 'FNA', 'CDN', 'Other'];

    const filtered = bwByType.length > 0 ? bwByType : [{ partner_type: 'all', iig: summary?.bandwidth?.iig || 0, bdix: summary?.bandwidth?.bdix || 0, ggc: summary?.bandwidth?.ggc || 0, fna: summary?.bandwidth?.fna || 0, cdn: summary?.bandwidth?.cdn || 0, bcdn: summary?.bandwidth?.bcdn || 0 }];

    filtered.forEach((bt) => {
      labels.push(typeLabels[bt.partner_type] || bt.partner_type);
    });

    bwKeys.forEach((k, i) => {
      datasets.push({
        label: bwLabels[i],
        data: filtered.map((bt) => Number(bt[k] || 0)),
        backgroundColor: BW_COLORS[k],
        borderRadius: 4,
        barPercentage: 0.7,
      });
    });

    return { labels, datasets };
  }, [bwByType, summary]);

  // Chart: 12-Month Revenue Trend
  const revenueTrendData = useMemo(() => {
    const labels = trends.map((t) => {
      const [y, m] = t.month.split('-');
      return new Date(y, m - 1).toLocaleString('en', { month: 'short', year: '2-digit' });
    });
    return {
      labels,
      datasets: [
        {
          label: 'Projected',
          data: trends.map((t) => t.projected),
          borderColor: '#7c3aed',
          backgroundColor: 'rgba(124,58,237,0.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        },
        {
          label: 'Paid',
          data: trends.map((t) => t.paid),
          borderColor: '#059669',
          backgroundColor: 'rgba(5,150,105,0.08)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        },
        {
          label: 'Due',
          data: trends.map((t) => t.due),
          borderColor: '#dc2626',
          backgroundColor: 'rgba(220,38,38,0.06)',
          fill: true,
          tension: 0.4,
          pointRadius: 3,
          borderWidth: 2,
        },
      ],
    };
  }, [trends]);

  // Chart: Partner Type Distribution
  const partnerTypeDoughnut = useMemo(() => {
    const counts = summary?.partner_type_counts || {};
    return {
      labels: ['Distribution', 'Channel', 'MAC'],
      datasets: [{
        data: [counts.distribution_partner || 0, counts.channel_partner || 0, counts.mac_partner || 0],
        backgroundColor: ['#2563eb', '#059669', '#7c3aed'],
        borderWidth: 0,
      }],
    };
  }, [summary]);

  // Chart: Top 10 by Revenue
  const top10Data = useMemo(() => {
    const top = partners.slice(0, 10);
    return {
      labels: top.map((p) => p.name || 'Unknown'),
      datasets: [{
        label: 'Monthly Bill (৳)',
        data: top.map((p) => p.projected),
        backgroundColor: '#7c3aed',
        borderRadius: 4,
        barPercentage: 0.6,
      }],
    };
  }, [partners]);

  const chartOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { borderDash: [2, 2] } }, x: { grid: { display: false } } } };
  const lineOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } }, scales: { y: { beginAtZero: true, grid: { borderDash: [2, 2] } }, x: { grid: { display: false } } } };
  const doughnutOptions = { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 10, font: { size: 11 } } } } };
  const hbarOptions = { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { borderDash: [2, 2] } }, y: { grid: { display: false } } } };

  const exportToExcel = () => {
    const wsData = [
      ['Partner Name', 'Company', 'Type', 'Total BW (Mbps)', 'IIG', 'BDIX', 'GGC', 'FNA', 'CDN', 'Other', 'NTTN', 'Monthly Bill (৳)', 'Paid (৳)', 'Due (৳)'],
      ...filteredPartners.map((p) => [
        p.name, p.company,
        p.partner_type === 'channel_partner' ? 'Channel' : p.partner_type === 'mac_partner' ? 'MAC' : 'Distribution',
        p.total_bw, p.iig_bw, p.bdix_bw, p.ggc_bw, p.fna_bw, p.cdn_bw, p.bcdn_bw, p.nttn_capacity,
        p.projected, p.paid, p.due,
      ]),
      [],
      ['', '', '', '', '', '', '', '', '', '', 'TOTAL', summary?.total_projected, summary?.total_paid, summary?.total_due],
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Partner Report');
    XLSX.writeFile(wb, `Partner_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const downloadSnapshot = async () => {
    if (!snapshotRef.current) return;
    try {
      const canvas = await html2canvas(snapshotRef.current, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      const link = document.createElement('a');
      link.download = `Partner_Report_${new Date().toISOString().slice(0, 10)}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Snapshot failed:', err);
    }
  };

  if (loading) {
    return (
      <div className="partner-report-page">
        <div className="pr-loading"><div className="pr-spinner" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="partner-report-page">
        <div className="pr-header">
          <div className="pr-header-brand">
            <div className="pr-title-icon"><i className="fas fa-chart-pie" /></div>
            <div>
              <h2>Partner Analytics Dashboard</h2>
              <p>Bandwidth, billing & collection report</p>
            </div>
          </div>
        </div>
        <div className="pr-empty" style={{ background: '#fff', borderRadius: 14, padding: '60px 20px', marginTop: 24 }}>
          <i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b' }} />
          <h4 style={{ color: '#1e293b', marginTop: 12 }}>Failed to load data</h4>
          <p style={{ color: '#64748b', marginTop: 8 }}>{error}</p>
          <button className="pr-btn pr-btn-primary" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
            <i className="fas fa-refresh me-1" /> Try again
          </button>
        </div>
      </div>
    );
  }

  const dueLevel = (due) => {
    if (!due || due <= 0) return 'zero';
    if (due < 50000) return 'low';
    return 'high';
  };

  const collectionClass = (rate) => rate >= 80 ? 'good' : rate >= 50 ? 'warning' : 'danger';

  return (
    <div className="partner-report-page">
      <div ref={snapshotRef}>
        {/* Header */}
        <div className="pr-header">
          <div className="pr-header-brand">
            <div className="pr-title-icon"><i className="fas fa-chart-pie" /></div>
            <div>
              <h2>Partner Analytics Dashboard</h2>
              <p>Bandwidth, billing & collection report — overview of all partners</p>
            </div>
          </div>
          <div className="pr-header-actions">
            <button type="button" className="pr-btn pr-btn-outline" onClick={() => window.print()}>
              <i className="fas fa-print" /> Print
            </button>
            <button type="button" className="pr-btn pr-btn-outline" onClick={exportToExcel}>
              <i className="fas fa-file-excel" /> Excel
            </button>
            <button type="button" className="pr-btn pr-btn-primary" onClick={downloadSnapshot}>
              <i className="fas fa-download" /> Snapshot
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="pr-filter-bar">
          <input
            type="text"
            className="pr-search-input"
            placeholder="Search partners..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="pr-type-filters">
            {Object.entries(PARTNER_TYPES).map(([key, val]) => (
              <button key={key} type="button" className={`pr-type-btn ${partnerType === key ? 'active' : ''}`} onClick={() => setPartnerType(key)}>
                <i className={`fas ${val.icon} me-1`} />{val.label}
              </button>
            ))}
          </div>
        </div>

        {/* Summary Cards */}
        {summary && (
          <div className="pr-summary-grid">
            <div className="pr-stat-card violet">
              <div className="pr-stat-icon violet"><i className="fas fa-users" /></div>
              <div className="pr-stat-value">{summary.total_partners}</div>
              <div className="pr-stat-label">Total Active Partners</div>
              <div className="pr-stat-sub">
                {summary.partner_type_counts.distribution_partner || 0} Dist / {summary.partner_type_counts.channel_partner || 0} Channel / {summary.partner_type_counts.mac_partner || 0} MAC
              </div>
            </div>
            <div className="pr-stat-card blue">
              <div className="pr-stat-icon blue"><i className="fas fa-network-wired" /></div>
              <div className="pr-stat-value">{money(summary.bandwidth?.total)} <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Mbps</span></div>
              <div className="pr-stat-label">Total Bandwidth Allocated</div>
              <div className="pr-stat-sub">NTTN: {money(summary.bandwidth?.nttn)} Mbps</div>
            </div>
            <div className="pr-stat-card green">
              <div className="pr-stat-icon green"><i className="fas fa-coins" /></div>
              <div className="pr-stat-value">৳{money(summary.total_projected)}</div>
              <div className="pr-stat-label">Monthly Revenue (Projected)</div>
              <div className="pr-stat-sub">Product charges included</div>
            </div>
            <div className="pr-stat-card cyan">
              <div className="pr-stat-icon cyan"><i className="fas fa-hand-holding-dollar" /></div>
              <div className="pr-stat-value">৳{money(summary.total_paid)}</div>
              <div className="pr-stat-label">Total Collection</div>
              <div className="pr-stat-sub">
                {summary.collection_rate}% collection rate
                <div className="pr-collection-bar">
                  <div className={`pr-collection-fill ${collectionClass(summary.collection_rate)}`} style={{ width: `${Math.min(summary.collection_rate, 100)}%` }} />
                </div>
              </div>
            </div>
            <div className="pr-stat-card red">
              <div className="pr-stat-icon red"><i className="fas fa-triangle-exclamation" /></div>
              <div className="pr-stat-value">৳{money(summary.total_due)}</div>
              <div className="pr-stat-label">Total Outstanding Due</div>
              <div className="pr-stat-sub">Discount: ৳{money(summary.total_discount)}</div>
            </div>
          </div>
        )}

        {/* Bandwidth Cards */}
        {summary && (
          <div className="pr-bw-grid">
            <div className="pr-bw-card iig"><div className="bw-label">IIG</div><div className="bw-value">{money(summary.bandwidth?.iig)}</div><div className="bw-unit">Mbps</div></div>
            <div className="pr-bw-card bdix"><div className="bw-label">BDIX</div><div className="bw-value">{money(summary.bandwidth?.bdix)}</div><div className="bw-unit">Mbps</div></div>
            <div className="pr-bw-card ggc"><div className="bw-label">GGC</div><div className="bw-value">{money(summary.bandwidth?.ggc)}</div><div className="bw-unit">Mbps</div></div>
            <div className="pr-bw-card fna"><div className="bw-label">FNA</div><div className="bw-value">{money(summary.bandwidth?.fna)}</div><div className="bw-unit">Mbps</div></div>
            <div className="pr-bw-card cdn"><div className="bw-label">CDN</div><div className="bw-value">{money(summary.bandwidth?.cdn)}</div><div className="bw-unit">Mbps</div></div>
            <div className="pr-bw-card other"><div className="bw-label">Other</div><div className="bw-value">{money(summary.bandwidth?.bcdn)}</div><div className="bw-unit">Mbps</div></div>
            <div className="pr-bw-card nttn"><div className="bw-label">NTTN</div><div className="bw-value">{money(summary.bandwidth?.nttn)}</div><div className="bw-unit">Mbps</div></div>
          </div>
        )}

        {/* Charts */}
        <div className="pr-charts-grid">
          <div className="pr-chart-card">
            <h5><i className="fas fa-chart-bar" /> Bandwidth by Partner Type</h5>
            <div className="pr-chart-container">
              <Bar data={bwChartData} options={chartOptions} />
            </div>
          </div>
          <div className="pr-chart-card">
            <h5><i className="fas fa-chart-pie" /> Partner Distribution</h5>
            <div className="pr-chart-container">
              <Doughnut data={partnerTypeDoughnut} options={doughnutOptions} />
            </div>
          </div>
          <div className="pr-chart-card full-width">
            <h5><i className="fas fa-chart-line" /> 12-Month Revenue Trend</h5>
            <div className="pr-chart-container">
              <Line data={revenueTrendData} options={lineOptions} />
            </div>
          </div>
          <div className="pr-chart-card full-width">
            <h5><i className="fas fa-ranking-star" /> Top 10 Partners by Revenue</h5>
            <div className="pr-chart-container">
              <Bar data={top10Data} options={hbarOptions} />
            </div>
          </div>
        </div>

        {/* Partner Table */}
        <div className="pr-table-card">
          <div className="pr-table-header">
            <h5><i className="fas fa-table" /> Partner-wise Detail</h5>
            <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>{filteredPartners.length} partners</span>
          </div>
          <div className="pr-table-scroll">
            <table className="pr-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('name')}>Partner {sortConfig.key === 'name' && <i className={`fas fa-sort-${sortConfig.dir === 'asc' ? 'up' : 'down'} sort-icon`} />}</th>
                  <th onClick={() => handleSort('partner_type')}>Type {sortConfig.key === 'partner_type' && <i className={`fas fa-sort-${sortConfig.dir === 'asc' ? 'up' : 'down'} sort-icon`} />}</th>
                  <th onClick={() => handleSort('total_bw')}>Total BW {sortConfig.key === 'total_bw' && <i className={`fas fa-sort-${sortConfig.dir === 'asc' ? 'up' : 'down'} sort-icon`} />}</th>
                  <th onClick={() => handleSort('projected')}>Bill (৳) {sortConfig.key === 'projected' && <i className={`fas fa-sort-${sortConfig.dir === 'asc' ? 'up' : 'down'} sort-icon`} />}</th>
                  <th onClick={() => handleSort('paid')}>Paid (৳) {sortConfig.key === 'paid' && <i className={`fas fa-sort-${sortConfig.dir === 'asc' ? 'up' : 'down'} sort-icon`} />}</th>
                  <th onClick={() => handleSort('due')}>Due (৳) {sortConfig.key === 'due' && <i className={`fas fa-sort-${sortConfig.dir === 'asc' ? 'up' : 'down'} sort-icon`} />}</th>
                </tr>
              </thead>
              <tbody>
                {filteredPartners.length === 0 ? (
                  <tr><td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>No partners found</td></tr>
                ) : filteredPartners.map((p) => (
                  <tr key={p.id} onClick={() => loadPartnerDetail(p.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="pr-partner-name">{p.name}</div>
                      {p.company && <div className="pr-partner-company">{p.company}</div>}
                    </td>
                    <td>
                      <span className={`pr-partner-type-badge ${p.partner_type === 'channel_partner' ? 'pr-type-channel' : p.partner_type === 'mac_partner' ? 'pr-type-mac' : 'pr-type-dist'}`}>
                        {p.partner_type === 'channel_partner' ? 'Channel' : p.partner_type === 'mac_partner' ? 'MAC' : 'Distribution'}
                      </span>
                    </td>
                    <td>{money(p.total_bw)} Mbps</td>
                    <td className="pr-money">৳{money(p.projected)}</td>
                    <td className="pr-money positive">৳{money(p.paid)}</td>
                    <td>
                      <span className={`pr-due-badge pr-due-${dueLevel(p.due)}`}>৳{money(p.due)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredPartners.length > 0 && (
            <div className="pr-table-footer">
              <span>Total: <strong>{filteredPartners.length}</strong> partners</span>
              <span>
                Bill: <strong>৳{money(filteredPartners.reduce((s, p) => s + p.projected, 0))}</strong> | Paid: <strong style={{ color: '#059669' }}>৳{money(filteredPartners.reduce((s, p) => s + p.paid, 0))}</strong> | Due: <strong style={{ color: '#dc2626' }}>৳{money(filteredPartners.reduce((s, p) => s + p.due, 0))}</strong>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Detail Panel Overlay */}
      {selectedPartnerId && (
        <div className="pr-detail-overlay" onClick={closeDetail}>
          <div className="pr-detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="pr-detail-header">
              <div className="d-flex align-items-center gap-3">
                <button className="pr-btn pr-btn-outline" onClick={closeDetail} style={{ padding: '6px 12px' }}>
                  <i className="fas fa-arrow-left" />
                </button>
                <div>
                  <h3 style={{ margin: 0, fontWeight: 800 }}>
                    {detailData?.profile?.name || 'Loading...'}
                  </h3>
                  {detailData?.profile && (
                    <div className="d-flex gap-2 mt-1" style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      <span>{detailData.profile.company}</span>
                      <span>|</span>
                      <span className={`pr-partner-type-badge ${detailData.profile.partner_type === 'channel_partner' ? 'pr-type-channel' : detailData.profile.partner_type === 'mac_partner' ? 'pr-type-mac' : 'pr-type-dist'}`}>
                        {detailData.profile.partner_type === 'channel_partner' ? 'Channel' : detailData.profile.partner_type === 'mac_partner' ? 'MAC' : 'Distribution'}
                      </span>
                      <span>|</span>
                      <span>{detailData.profile.contact_no}</span>
                      <span>|</span>
                      <span>{detailData.profile.pop_location}</span>
                    </div>
                  )}
                </div>
              </div>
              <button className="pr-btn pr-btn-outline" onClick={() => navigate(`/reseller-profile/${selectedPartnerId}`)} title="Full Profile">
                <i className="fas fa-external-link-alt" /> Full Profile
              </button>
            </div>

            {detailLoading && <div className="pr-loading" style={{ minHeight: 300 }}><div className="pr-spinner" /></div>}
            {detailError && <div style={{ padding: 40, textAlign: 'center', color: '#dc2626' }}>{detailError}</div>}

            {detailData && !detailLoading && (
              <div className="pr-detail-body" id="partner-report-printable">
                {/* Partner Header for Print */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: '#1e293b' }}>
                      {detailData.profile.name || detailData.profile.company}
                    </h4>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>
                      {detailData.profile.partner_type?.replace(/_/g, ' ')} • {detailData.profile.status} • {detailData.profile.connection_type || ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="pr-btn pr-btn-outline" onClick={() => window.print()} title="Print / Save PDF">
                      <i className="fas fa-print" /> Print / PDF
                    </button>
                    <button className="pr-btn pr-btn-outline" onClick={() => {
                      const el = document.getElementById('partner-report-printable');
                      if (!el) return;
                      const panel = el.closest('.pr-detail-panel');
                      const origOverflow = panel ? panel.style.overflow : '';
                      const origHeight = panel ? panel.style.height : '';
                      if (panel) { panel.style.overflow = 'visible'; panel.style.height = 'auto'; }
                      el.style.width = '100%';
                      html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollY: 0, windowWidth: el.scrollWidth, windowHeight: el.scrollHeight }).then((canvas) => {
                        if (panel) { panel.style.overflow = origOverflow; panel.style.height = origHeight; }
                        const link = document.createElement('a');
                        link.download = `partner-report-${detailData.profile.name || 'report'}.png`;
                        link.href = canvas.toDataURL('image/png');
                        link.click();
                      }).catch(() => {
                        if (panel) { panel.style.overflow = origOverflow; panel.style.height = origHeight; }
                      });
                    }} title="Save as Image">
                      <i className="fas fa-image" /> Save Image
                    </button>
                  </div>
                </div>

                {/* 12-Month Raw Data: Bandwidth + Billing */}
                {detailData.monthly_history && detailData.monthly_history.length > 0 && (
                  <div className="pr-table-card">
                    <div className="pr-table-header">
                      <h5><i className="fas fa-table" /> 12-Month Bandwidth & Billing Overview</h5>
                    </div>
                    <div className="pr-table-scroll" style={{ overflowX: 'auto' }}>
                      <table className="pr-table" style={{ minWidth: 1050, fontSize: '0.78rem' }}>
                        <thead>
                          <tr>
                            <th rowSpan="2" style={{ position: 'sticky', left: 0, background: '#f8fafc', zIndex: 2 }}>Month</th>
                            <th colSpan="7" style={{ textAlign: 'center', background: '#f0f4ff', borderBottom: '2px solid #4318ff' }}>Bandwidth Allocation (Mbps)</th>
                            <th rowSpan="2" style={{ background: '#f0f4ff', borderBottom: '2px solid #4318ff' }}>BW Total</th>
                            <th colSpan="2" style={{ textAlign: 'center', background: '#f0fdf4', borderBottom: '2px solid #059669' }}>Billing (৳)</th>
                          </tr>
                          <tr>
                            <th style={{ color: '#4318ff' }}>IIG</th>
                            <th style={{ color: '#05cd99' }}>BDIX</th>
                            <th style={{ color: '#ffb547' }}>GGC</th>
                            <th style={{ color: '#0dcaf0' }}>FNA</th>
                            <th style={{ color: '#e31a1a' }}>CDN</th>
                            <th style={{ color: '#6c757d' }}>Other</th>
                            <th style={{ color: '#000' }}>NTTN</th>
                            <th style={{ color: '#7c3aed' }}>Projected</th>
                            <th style={{ color: '#059669' }}>Paid</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailData.monthly_history.slice().reverse().map((row) => {
                            const [y, m] = row.month.split('-');
                            const monthLabel = new Date(y, m - 1).toLocaleString('en', { month: 'short', year: 'numeric' });
                            return (
                              <tr key={row.month}>
                                <td style={{ fontWeight: 600, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>{monthLabel}</td>
                                <td style={{ textAlign: 'right' }}>{row.iig}</td>
                                <td style={{ textAlign: 'right' }}>{row.bdix}</td>
                                <td style={{ textAlign: 'right' }}>{row.ggc}</td>
                                <td style={{ textAlign: 'right' }}>{row.fna}</td>
                                <td style={{ textAlign: 'right' }}>{row.cdn}</td>
                                <td style={{ textAlign: 'right' }}>{row.bcdn}</td>
                                <td style={{ textAlign: 'right' }}>{row.nttn}</td>
                                <td style={{ textAlign: 'right', fontWeight: 700 }}>{row.bw_total}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: '#7c3aed' }}>৳{Number(row.projected).toLocaleString()}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: '#059669' }}>৳{Number(row.paid).toLocaleString()}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                            <td style={{ position: 'sticky', left: 0, background: '#f8fafc', zIndex: 1 }}>Total</td>
                            <td style={{ textAlign: 'right' }}>{detailData.monthly_history.reduce((s, r) => s + r.iig, 0)}</td>
                            <td style={{ textAlign: 'right' }}>{detailData.monthly_history.reduce((s, r) => s + r.bdix, 0)}</td>
                            <td style={{ textAlign: 'right' }}>{detailData.monthly_history.reduce((s, r) => s + r.ggc, 0)}</td>
                            <td style={{ textAlign: 'right' }}>{detailData.monthly_history.reduce((s, r) => s + r.fna, 0)}</td>
                            <td style={{ textAlign: 'right' }}>{detailData.monthly_history.reduce((s, r) => s + r.cdn, 0)}</td>
                            <td style={{ textAlign: 'right' }}>{detailData.monthly_history.reduce((s, r) => s + r.bcdn, 0)}</td>
                            <td style={{ textAlign: 'right' }}>{detailData.monthly_history.reduce((s, r) => s + r.nttn, 0)}</td>
                            <td style={{ textAlign: 'right' }}>{detailData.monthly_history.reduce((s, r) => s + r.bw_total, 0)}</td>
                            <td style={{ textAlign: 'right', color: '#7c3aed' }}>৳{detailData.monthly_history.reduce((s, r) => s + Number(r.projected), 0).toLocaleString()}</td>
                            <td style={{ textAlign: 'right', color: '#059669' }}>৳{detailData.monthly_history.reduce((s, r) => s + Number(r.paid), 0).toLocaleString()}</td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PartnerReport;
