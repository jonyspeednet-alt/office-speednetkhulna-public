import React from 'react';
import { fmtDate, money, partnerTypeLabel } from '../../utils/formatters';

const DetailRow = ({ label, children }) => (
    <div className="rp-detail-row">
        <span className="text-muted">{label}</span>
        <span className="fw-semibold text-end text-break">{children}</span>
    </div>
);

const ProfileDetails = ({ reseller, partners = [], can, onEditClick }) => {
    const isChannel = reseller.partner_type === 'channel_partner';
    const isMac = reseller.partner_type === 'mac_partner';
    const hasMultiplePartners = partners.length > 1;

    return (
        <div className="p-2 p-sm-3">
            <div className="d-flex justify-content-between align-items-center mb-3">
                <div className="d-flex align-items-center gap-2">
                    <div
                        className="d-flex align-items-center justify-content-center rounded-3"
                        style={{ width: 42, height: 42, background: 'linear-gradient(135deg, #4318ff 0%, #7c58ff 100%)' }}
                    >
                        <i className="fas fa-id-card text-white" />
                    </div>
                    <div>
                        <h6 className="fw-bold m-0">Profile Details</h6>
                        <span className="text-muted small">Basic information and settings</span>
                    </div>
                </div>
                {can.can_edit_profile && (
                    <button type="button" className="btn btn-sm btn-outline-primary rounded-pill px-3" onClick={onEditClick}>
                        <i className="fas fa-edit me-1" /> Edit
                    </button>
                )}
            </div>

            {/* Partners section - shown when multiple partners exist */}
            {hasMultiplePartners && (
                <div className="card border-0 bg-light rounded-3 p-3 mb-3">
                    <h6 className="fw-bold small text-muted text-uppercase mb-2">
                        <i className="fas fa-users me-1" /> Partner List
                    </h6>
                    <div className="table-responsive">
                        <table className="table table-sm mb-0" style={{ fontSize: '0.85rem' }}>
                            <thead>
                                <tr className="text-muted" style={{ borderBottom: '1px solid #e5e7eb' }}>
                                    <th style={{ fontWeight: 600, padding: '6px 8px' }}>#</th>
                                    <th style={{ fontWeight: 600, padding: '6px 8px' }}>Name</th>
                                    <th style={{ fontWeight: 600, padding: '6px 8px' }}>Contact No</th>
                                </tr>
                            </thead>
                            <tbody>
                                {partners.map((p, i) => (
                                    <tr key={p.id || i}>
                                        <td style={{ padding: '6px 8px', color: '#9ca3af' }}>{i + 1}</td>
                                        <td style={{ padding: '6px 8px', fontWeight: 600 }}>{p.partner_name || '-'}</td>
                                        <td style={{ padding: '6px 8px' }}>
                                            {p.contact_no ? (
                                                <a href={`tel:${p.contact_no}`} style={{ textDecoration: 'none', color: '#2563eb' }}>
                                                    <i className="fas fa-phone me-1" style={{ fontSize: '0.75rem' }} />
                                                    {p.contact_no}
                                                </a>
                                            ) : '-'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="row g-3">
                <div className="col-12 col-md-6">
                    <div className="card border-0 bg-light rounded-3 p-3 h-100">
                        <h6 className="fw-bold small text-muted text-uppercase mb-2">
                            <i className="fas fa-building me-1" /> General Info
                        </h6>
                        <div className="rp-details-grid">
                            <DetailRow label="Company">{reseller.company_name || '-'}</DetailRow>
                            <DetailRow label="Phone">{reseller.phone || '-'}</DetailRow>
                            <DetailRow label="User ID">{reseller.reseller_code || '-'}</DetailRow>
                            <DetailRow label="Partner Type">{partnerTypeLabel(reseller.partner_type)}</DetailRow>
                            <DetailRow label="Status">
                                <span className={`badge rounded-pill ${reseller.status === 'active' ? 'bg-success-subtle text-success-emphasis border border-success-subtle' : 'bg-danger-subtle text-danger-emphasis border border-danger-subtle'}`}>
                                    {reseller.status}
                                </span>
                            </DetailRow>
                        </div>
                    </div>
                </div>
                <div className="col-12 col-md-6">
                    <div className="card border-0 bg-light rounded-3 p-3 h-100">
                        <h6 className="fw-bold small text-muted text-uppercase mb-2">
                            <i className="fas fa-map-marker-alt me-1" /> Address & Connection
                        </h6>
                        <div className="rp-details-grid">
                            {!isChannel && (
                                <DetailRow label="Connection">
                                    {reseller.nttn_type || '-'}
                                    {reseller.connection_type ? `, ${reseller.connection_type}` : ''}
                                </DetailRow>
                            )}
                            {isChannel && (
                                <>
                                    <DetailRow label="Total Users">{Number(reseller.channel_user_count || 0).toLocaleString('en-US')}</DetailRow>
                                    <DetailRow label="Active Users">
                                        {Number((reseller.channel_active_user_count ?? reseller.channel_user_count) || 0).toLocaleString('en-US')}
                                    </DetailRow>
                                </>
                            )}
                            {!isChannel && (
                                <DetailRow label="NTTN Link">
                                    {reseller.nttn_link ? (
                                        <a href={reseller.nttn_link} target="_blank" rel="noreferrer" className="text-decoration-none small">
                                            Link
                                        </a>
                                    ) : '-'}
                                </DetailRow>
                            )}
                            <DetailRow label="Joining Date">{fmtDate(reseller.joining_date)}</DetailRow>
                            <DetailRow label="Location">{reseller.pop_location || '-'}</DetailRow>
                            {(reseller.latitude && reseller.longitude) && (
                                <DetailRow label="Map">
                                    <a
                                        href={`https://www.google.com/maps?q=${reseller.latitude},${reseller.longitude}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="btn btn-xs btn-outline-primary py-0 px-2 rounded-pill"
                                    >
                                        View
                                    </a>
                                </DetailRow>
                            )}
                            {(isChannel || isMac) && (
                                <DetailRow label="Profit Share">
                                    <span className="badge bg-success bg-opacity-10 text-success border border-success border-opacity-25">
                                        {Number(reseller.profit_share_percentage || 0)}%
                                    </span>
                                </DetailRow>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            {/* Financial extras */}
            {(Number(reseller.security_deposit || 0) > 0 || (can.can_view_financials && Number(reseller.otc_charge || 0) > 0)) && (
                <div className="card border-0 bg-light rounded-3 p-3 mt-3">
                    <h6 className="fw-bold small text-muted text-uppercase mb-2">
                        <i className="fas fa-coins me-1" /> Financial Info
                    </h6>
                    <div className="rp-details-grid rp-details-2col">
                        {Number(reseller.security_deposit || 0) > 0 && (
                            <DetailRow label="Security Deposit">{money(reseller.security_deposit)}</DetailRow>
                        )}
                        {can.can_view_financials && Number(reseller.otc_charge || 0) > 0 && (
                            <DetailRow label="OTC Charge">{money(reseller.otc_charge)}</DetailRow>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProfileDetails;
