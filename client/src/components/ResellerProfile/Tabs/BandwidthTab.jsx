import React, { useMemo } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import { bw, formatDateTime } from '../../../utils/formatters';

const BandwidthTab = ({ reseller, can, rateChangeLogs, onRateChangeClick }) => {
    const activePackages = useMemo(() => {
        const arr = [
            { label: 'IIG', bw: reseller.iig_bw, rate: reseller.rate_iig, icon: 'fa-globe-americas', color: 'text-primary' },
            { label: 'BDIX', bw: reseller.bdix_bw, rate: reseller.rate_bdix, icon: 'fa-exchange-alt', color: 'text-success' },
            { label: 'GGC', bw: reseller.ggc_bw, rate: reseller.rate_ggc, icon: 'fa-google', color: 'text-warning' },
            { label: 'FNA', bw: reseller.fna_bw, rate: reseller.rate_fna, icon: 'fa-network-wired', color: 'text-info' },
            { label: 'CDN', bw: reseller.cdn_bw, rate: reseller.rate_cdn, icon: 'fa-server', color: 'text-danger' },
            { label: 'Other', bw: reseller.bcdn_bw, rate: reseller.rate_bcdn, icon: 'fa-hdd', color: 'text-secondary' },
            { label: 'NTTN', bw: reseller.nttn_capacity, rate: reseller.rate_nttn, icon: 'fa-broadcast-tower', color: 'text-dark', extra: reseller.nttn_type }
        ];
        return arr.filter((x) => Number(x.bw || 0) > 0);
    }, [reseller]);

    const bwBarData = useMemo(() => ({
        labels: ['IIG', 'BDIX', 'GGC', 'FNA', 'CDN', 'Other', 'NTTN'],
        datasets: [{
            label: 'Allocated (Mbps)',
            data: [
                Number(reseller.iig_bw || 0),
                Number(reseller.bdix_bw || 0),
                Number(reseller.ggc_bw || 0),
                Number(reseller.fna_bw || 0),
                Number(reseller.cdn_bw || 0),
                Number(reseller.bcdn_bw || 0),
                Number(reseller.nttn_capacity || 0)
            ],
            backgroundColor: ['#4318ff', '#05cd99', '#ffb547', '#0dcaf0', '#e31a1a', '#6c757d', '#212529'],
            borderRadius: 5,
            barPercentage: 0.6
        }]
    }), [reseller]);

    const bwPieData = useMemo(() => {
        const iig = Number(reseller.iig_bw || 0);
        const bdix = Number(reseller.bdix_bw || 0);
        const ggc = Number(reseller.ggc_bw || 0);
        const fna = Number(reseller.fna_bw || 0);
        const cdn = Number(reseller.cdn_bw || 0);
        const bcdn = Number(reseller.bcdn_bw || 0);
        const nttn = Number(reseller.nttn_capacity || 0);
        const used = iig + bdix + ggc + fna + cdn + bcdn;
        const free = Math.max(0, nttn - used);

        return {
            labels: ['IIG', 'BDIX', 'GGC', 'FNA', 'CDN', 'Other', 'Available'],
            datasets: [{
                data: [iig, bdix, ggc, fna, cdn, bcdn, free],
                backgroundColor: ['#4318ff', '#05cd99', '#ffb547', '#0dcaf0', '#e31a1a', '#6c757d', '#e9ecef'],
                borderWidth: 0
            }]
        };
    }, [reseller]);

    return (
        <div className="p-2 p-sm-3">
            <div className="card card-body border-0 shadow-sm mb-3 bg-light">
                <h6 className="fw-bold small text-muted text-uppercase mb-3">Allocation Overview</h6>
                <div className="row">
                    <div className="col-md-7 border-end" style={{ minHeight: 250 }}>
                        <Bar
                            data={bwBarData}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: { legend: { display: false } },
                                scales: {
                                    y: { beginAtZero: true, grid: { borderDash: [2, 2] } },
                                    x: { grid: { display: false } }
                                }
                            }}
                        />
                    </div>
                    <div className="col-md-5" style={{ minHeight: 250 }}>
                        <Doughnut
                            data={bwPieData}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                    legend: { position: 'right', labels: { boxWidth: 10, font: { size: 10 } } },
                                    title: { display: true, text: `NTTN Usage (${Number(reseller.nttn_capacity || 0)} Mbps)`, font: { size: 12 } }
                                }
                            }}
                        />
                    </div>
                </div>
            </div>

            {/* Active Packages + Rate Card */}
            <div className="d-flex justify-content-between align-items-center mb-2">
                <h6 className="fw-bold m-0 text-dark">Active Packages</h6>
                {can.can_edit_profile && can.can_view_financials && (
                    <button
                        type="button"
                        className="btn btn-sm btn-outline-warning rounded-pill px-3"
                        onClick={onRateChangeClick}
                    >
                        <i className="fas fa-tags me-1" />Change Bandwidth Rate
                    </button>
                )}
            </div>

            <div className="d-flex flex-column mb-3">
                {activePackages.length === 0 ? <div className="text-muted small"><i className="fas fa-box-open d-block mb-1" />No active package</div> : activePackages.map((item) => (
                    <div key={item.label} className="d-flex justify-content-between align-items-center border-bottom py-2">
                        <div className="d-flex align-items-center">
                            <i className={`fas ${item.icon} ${item.color} me-3`} style={{ width: 20 }} />
                            <span className="fw-bold small">{item.label}</span>
                            {item.extra ? <span className="badge bg-light text-dark border ms-2" style={{ fontSize: 9 }}>{item.extra}</span> : null}
                        </div>
                        <div className="text-end">
                            <div className="fw-bold text-dark small">{bw(item.bw)}</div>
                            {can.can_view_financials ? (
                                <div className="text-muted" style={{ fontSize: 10 }}>
                                    <i className="fas fa-tag me-1 text-warning" style={{ fontSize: 9 }} />
                                    {Number(item.rate || 0).toLocaleString('en-BD')} Tk/Month
                                </div>
                            ) : null}
                        </div>
                    </div>
                ))}
            </div>

            {/* Rate Change History */}
            {can.can_view_financials && rateChangeLogs.length > 0 && (
                <div className="mt-3">
                    <h6 className="fw-bold small text-muted text-uppercase mb-2">
                        <i className="fas fa-history me-1" />Rate Change History
                    </h6>
                    <div className="table-responsive" style={{ maxHeight: 220 }}>
                        <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: 12 }}>
                            <thead className="table-light">
                                <tr>
                                    <th>Effective Date</th>
                                    <th>IIG</th><th>BDIX</th><th>GGC</th><th>FNA</th><th>CDN</th><th>Other</th><th>NTTN</th>
                                    <th>Changed By</th>
                                    <th>Note</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rateChangeLogs.map((log) => {
                                    const rateTypes = [
                                        { key: 'iig', label: 'IIG' },
                                        { key: 'bdix', label: 'BDIX' },
                                        { key: 'ggc', label: 'GGC' },
                                        { key: 'fna', label: 'FNA' },
                                        { key: 'cdn', label: 'CDN' },
                                        { key: 'bcdn', label: 'Other' },
                                        { key: 'nttn', label: 'NTTN' },
                                    ];
                                    return (
                                        <tr key={log.id}>
                                            <td className="fw-bold text-nowrap">
                                                {new Date(log.effective_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                <div style={{ fontSize: 10 }} className="text-muted">
                                                    {formatDateTime(log.created_at)}
                                                </div>
                                            </td>
                                            {rateTypes.map(({ key }) => {
                                                const cur = Number(log[`rate_${key}`] || 0);
                                                const prev = Number(log[`prev_rate_${key}`] || 0);
                                                const changed = cur !== prev;
                                                return (
                                                    <td key={key} className={changed ? 'fw-bold' : 'text-muted'}>
                                                        {cur > 0 ? cur.toLocaleString('en-BD') : <span className="text-muted">-</span>}
                                                        {changed && prev > 0 && (
                                                            <div style={{ fontSize: 9 }} className={cur > prev ? 'text-danger' : 'text-success'}>
                                                                {cur > prev ? '▲' : '▼'} {prev.toLocaleString('en-BD')}
                                                            </div>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                            <td className="text-nowrap">
                                                <span className="badge bg-light text-dark border" style={{ fontSize: 10 }}>
                                                    {log.changed_by || 'System'}
                                                </span>
                                            </td>
                                            <td className="text-muted" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {log.note || '-'}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BandwidthTab;
