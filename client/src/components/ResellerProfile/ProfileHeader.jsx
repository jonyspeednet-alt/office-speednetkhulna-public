import React from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { partnerTypeLabel } from '../../utils/formatters';

const ProfileHeader = ({ reseller, can, isChannel, onPaymentClick, onDiscountClick, onCommissionPayClick }) => {
    const navigate = useNavigate();
    const location = useLocation();

    // Warm the Invoice lazy chunk (JS + CSS) on hover/focus so SPA navigation
    // to /invoice never paints the toolbar before its CSS arrives (FOUC fix).
    const prefetchInvoice = () => {
        import('../../pages/Invoice').catch(() => {});
    };

    const handleBack = () => {
        if (location.state?.from === '/reseller-list' && window.history.length > 1 && location.key !== 'default') {
            navigate(-1);
        } else if (window.history.length > 1 && location.key !== 'default') {
            navigate(-1);
        } else {
            navigate('/reseller-list');
        }
    };

    return (
        <div className="d-flex flex-column flex-sm-row justify-content-between align-items-stretch align-items-sm-center mb-3 rp-profile-header pb-3 border-bottom">
            <div className="d-flex align-items-center gap-3 rp-title-block min-w-0">
                <button type="button" onClick={handleBack} className="btn btn-light border shadow-sm rounded-circle flex-shrink-0 d-flex align-items-center justify-content-center" style={{ width: 40, height: 40 }} aria-label="Back to reseller list">
                    <i className="fas fa-arrow-left text-secondary" />
                </button>
                <div className="min-w-0">
                    <h4 className="fw-bold m-0 text-truncate text-dark">{reseller.name}</h4>
                    <div className="d-flex flex-wrap align-items-center gap-2 mt-1.5">
                        <span className="badge bg-secondary-subtle text-secondary border border-secondary-subtle rounded-pill px-2.5 py-1 font-monospace small" style={{ fontSize: '0.75rem' }}>
                            {reseller.reseller_code}
                        </span>
                        <span className="badge bg-primary-subtle text-primary border border-primary-subtle rounded-pill px-2.5 py-1" style={{ fontSize: '0.75rem' }}>
                            {partnerTypeLabel(reseller.partner_type)}
                        </span>
                    </div>
                </div>
            </div>
            <div className="d-flex flex-wrap gap-2 rp-actions mt-2 mt-sm-0">
                {isChannel && can.can_view_financials && onCommissionPayClick && (
                    <button type="button" className="btn btn-sm btn-success rounded-pill px-3 shadow-sm fw-semibold" onClick={onCommissionPayClick}>
                        <i className="fas fa-money-bill me-1.5 d-none d-sm-inline" />
                        <span>Commission Payment</span>
                    </button>
                )}

                {!isChannel && can.can_add_payment && (
                    <button type="button" className="btn btn-sm btn-warning text-dark rounded-pill px-3 shadow-sm fw-semibold" onClick={onPaymentClick}>
                        <i className="fas fa-hand-holding-usd me-1.5 d-none d-sm-inline" />
                        <span>Payment</span>
                    </button>
                )}
                {!isChannel && can.can_add_discount && (
                    <button type="button" className="btn btn-sm btn-info text-white rounded-pill px-3 shadow-sm fw-semibold" onClick={onDiscountClick}>
                        <i className="fas fa-percent me-1.5 d-none d-sm-inline" />
                        <span>Discount</span>
                    </button>
                )}
                {((!isChannel && can.can_view_invoice) || (isChannel && can.can_view_financials)) && (
                    <Link to={`/invoice?resellerId=${reseller.id}`} className="btn btn-sm btn-primary rounded-pill px-3 shadow-sm fw-semibold" onMouseEnter={prefetchInvoice} onFocus={prefetchInvoice}>
                        <i className="fas fa-file-invoice me-1.5 d-none d-sm-inline" />
                        <span>Invoice</span>
                    </Link>
                )}
            </div>
        </div>
    );
};

export default ProfileHeader;
