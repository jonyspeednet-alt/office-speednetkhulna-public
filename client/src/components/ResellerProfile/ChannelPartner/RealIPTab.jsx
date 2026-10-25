import React from 'react';
import { money } from '../../../utils/formatters';

const DetailRow = ({ label, children }) => (
    <div className="rp-detail-row">
        <span className="text-muted">{label}</span>
        <span className="fw-semibold text-end text-break">{children}</span>
    </div>
);

const RealIPTab = ({ reseller, can }) => {
    const realIpCount = Number(reseller.real_ip_count || 0);
    const realIpPrice = Number(reseller.real_ip_price || 0);
    const realIpMonthly = realIpCount * realIpPrice;

    return (
        <div className="p-2 p-sm-3">
            <div className="d-flex align-items-center gap-2 mb-3">
                <div
                    className="d-flex align-items-center justify-content-center rounded-3"
                    style={{ width: 42, height: 42, background: 'linear-gradient(135deg, #6366f1 0%, #818cf8 100%)' }}
                >
                    <i className="fas fa-network-wired text-white" />
                </div>
                <div>
                    <h6 className="fw-bold m-0">Real IP Profile Details</h6>
                    <span className="text-muted small">Real IP configuration and billing info</span>
                </div>
            </div>

            {realIpCount === 0 ? (
                <div className="text-center text-muted py-5">
                    <i className="fas fa-network-wired d-block mb-2" style={{ fontSize: '2rem', opacity: 0.3 }} />
                    <p className="mb-0">No Real IP configured</p>
                </div>
            ) : (
                <>
                    {/* Summary cards */}
                    <div className="row g-2 mb-3">
                        <div className="col-4">
                            <div className="card border-0 shadow-sm text-center p-2 rounded-3" style={{ background: 'linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)' }}>
                                <div className="text-muted small">Quantity</div>
                                <div className="fw-bold text-primary fs-5">{realIpCount.toLocaleString('en-US')}</div>
                            </div>
                        </div>
                        <div className="col-4">
                            <div className="card border-0 shadow-sm text-center p-2 rounded-3" style={{ background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)' }}>
                                <div className="text-muted small">Unit Price</div>
                                <div className="fw-bold text-success fs-5">{can.can_view_financials ? money(realIpPrice) : '-'}</div>
                            </div>
                        </div>
                        <div className="col-4">
                            <div className="card border-0 shadow-sm text-center p-2 rounded-3" style={{ background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)' }}>
                                <div className="text-muted small">Monthly Total</div>
                                <div className="fw-bold text-warning fs-5">{can.can_view_financials ? money(realIpMonthly) : '-'}</div>
                            </div>
                        </div>
                    </div>

                    {/* Detail table */}
                    <div className="card border-0 bg-light rounded-3 p-3">
                        <div className="rp-details-grid rp-details-2col">
                            <DetailRow label="Real IP Quantity">{realIpCount.toLocaleString('en-US')}</DetailRow>
                            <DetailRow label="Unit Price (Monthly)">{can.can_view_financials ? money(realIpPrice) : '-'}</DetailRow>
                            <DetailRow label="Monthly Total">{can.can_view_financials ? money(realIpMonthly) : '-'}</DetailRow>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default RealIPTab;
