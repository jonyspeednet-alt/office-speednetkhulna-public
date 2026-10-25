import React from 'react';
import ModalWrap from '../ModalWrap';

const RateChangeModal = ({ reseller, rateChangeForm, setRateChangeForm, rateChangeSaving, onSubmit, onClose }) => {
    if (!rateChangeForm) return null;

    const bwTypes = [
        { key: 'iig', label: 'IIG', icon: 'fa-globe-americas', color: 'text-primary', bwKey: 'iig_bw' },
        { key: 'bdix', label: 'BDIX', icon: 'fa-exchange-alt', color: 'text-success', bwKey: 'bdix_bw' },
        { key: 'ggc', label: 'GGC', icon: 'fa-google', color: 'text-warning', bwKey: 'ggc_bw' },
        { key: 'fna', label: 'FNA', icon: 'fa-network-wired', color: 'text-info', bwKey: 'fna_bw' },
        { key: 'cdn', label: 'CDN', icon: 'fa-server', color: 'text-danger', bwKey: 'cdn_bw' },
        { key: 'bcdn', label: 'Other', icon: 'fa-hdd', color: 'text-secondary', bwKey: 'bcdn_bw' },
        { key: 'nttn', label: 'NTTN', icon: 'fa-broadcast-tower', color: 'text-dark', bwKey: 'nttn_capacity' },
    ];

    const changes = bwTypes.filter(({ key }) => {
        const oldRate = Number(reseller[`rate_${key}`] || 0);
        const newRate = Number(rateChangeForm[`rate_${key}`] || 0);
        return oldRate !== newRate && Number(reseller[key === 'nttn' ? 'nttn_capacity' : `${key}_bw`] || 0) > 0;
    });

    const oldTotal = bwTypes.reduce((s, { key }) => {
        const bwKey = key === 'nttn' ? 'nttn_capacity' : `${key}_bw`;
        return s + Number(reseller[bwKey] || 0) * Number(reseller[`rate_${key}`] || 0);
    }, 0);

    const newTotal = bwTypes.reduce((s, { key }) => {
        const bwKey = key === 'nttn' ? 'nttn_capacity' : `${key}_bw`;
        return s + Number(reseller[bwKey] || 0) * Number(rateChangeForm[`rate_${key}`] || 0);
    }, 0);

    const diff = newTotal - oldTotal;

    return (
        <ModalWrap title="Change Bandwidth Rate" onClose={onClose}>
            <form className="row g-3" onSubmit={onSubmit}>
                {/* Effective Date & Note */}
                <div className="col-12">
                    <div className="alert alert-warning border-0 py-2 small mb-0">
                        <i className="fas fa-info-circle me-1" />
                        The new rate will take effect from this date. The current month&apos;s projected bill will be recalculated.
                    </div>
                </div>
                <div className="col-md-5">
                    <label className="form-label fw-bold">Effective Date <span className="text-danger">*</span></label>
                    <input
                        type="date"
                        className="form-control"
                        value={rateChangeForm.effective_date}
                        onChange={(e) => setRateChangeForm({ ...rateChangeForm, effective_date: e.target.value })}
                        required
                    />
                    <div className="form-text">Entering today&apos;s date applies it immediately.</div>
                </div>
                <div className="col-md-7">
                    <label className="form-label fw-bold">Reason / Note</label>
                    <input
                        type="text"
                        className="form-control"
                        placeholder="e.g. rate change per new agreement"
                        value={rateChangeForm.note}
                        onChange={(e) => setRateChangeForm({ ...rateChangeForm, note: e.target.value })}
                    />
                </div>

                {/* Rate Fields */}
                <div className="col-12">
                    <h6 className="fw-bold text-primary border-bottom pb-2 mb-3">
                        <i className="fas fa-tags me-1" />New Rate (Tk/Month)
                    </h6>
                    <div className="row g-2">
                        {bwTypes.map(({ key, label, icon, color }) => {
                            const rateKey = `rate_${key}`;
                            const bwKey = key === 'nttn' ? 'nttn_capacity' : `${key}_bw`;
                            const bwVal = Number(reseller[bwKey] || 0);
                            return (
                                <div key={key} className="col-md-3 col-6">
                                    <div className={`card border-0 shadow-sm p-2 h-100 ${bwVal === 0 ? 'opacity-50' : ''}`}>
                                        <div className="d-flex align-items-center mb-1">
                                            <i className={`fas ${icon} ${color} me-2`} style={{ fontSize: 13 }} />
                                            <span className="fw-bold small">{label}</span>
                                            {bwVal > 0 && <span className="badge bg-light text-dark border ms-auto" style={{ fontSize: 9 }}>{bwVal} Mbps</span>}
                                        </div>
                                        <input
                                            type="number"
                                            step="0.01"
                                            min="0"
                                            className="form-control form-control-sm"
                                            value={rateChangeForm[rateKey]}
                                            onChange={(e) => setRateChangeForm({ ...rateChangeForm, [rateKey]: e.target.value })}
                                            disabled={bwVal === 0}
                                            placeholder="0"
                                        />
                                        <div className="text-muted mt-1" style={{ fontSize: 10 }}>Tk/Month</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Impact Preview */}
                {changes.length > 0 && (
                    <div className="col-12">
                        <div className={`alert border-0 py-2 ${diff > 0 ? 'alert-danger' : diff < 0 ? 'alert-success' : 'alert-secondary'}`}>
                            <div className="d-flex justify-content-between align-items-center">
                                <div>
                                    <strong><i className="fas fa-calculator me-1" />Bill Impact Preview</strong>
                                    <div className="small mt-1">
                                        {changes.map(({ key, label }) => {
                                            const bwKey = key === 'nttn' ? 'nttn_capacity' : `${key}_bw`;
                                            const bw = Number(reseller[bwKey] || 0);
                                            const oldR = Number(reseller[`rate_${key}`] || 0);
                                            const newR = Number(rateChangeForm[`rate_${key}`] || 0);
                                            const d = (newR - oldR) * bw;
                                            return (
                                                <span key={key} className="me-3">
                                                    <strong>{label}:</strong> {oldR.toLocaleString()} → {newR.toLocaleString()} Tk
                                                    <span className={d > 0 ? 'text-danger ms-1' : 'text-success ms-1'}>
                                                        ({d > 0 ? '+' : ''}{d.toLocaleString()} Tk/mo)
                                                    </span>
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="text-end ms-3">
                                    <div className="small text-muted">Monthly Bill Change</div>
                                    <div className={`fw-bold fs-6 ${diff > 0 ? 'text-danger' : 'text-success'}`}>
                                        {diff > 0 ? '+' : ''}{diff.toLocaleString('en-BD', { minimumFractionDigits: 2 })} Tk
                                    </div>
                                    <div className="small text-muted">{oldTotal.toLocaleString()} → {newTotal.toLocaleString()} Tk</div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                <div className="col-12 text-end border-top pt-3">
                    <button type="button" className="btn btn-light rounded-pill me-2" onClick={onClose}>Cancel</button>
                    <button className="btn btn-warning fw-bold rounded-pill px-4" disabled={rateChangeSaving}>
                        {rateChangeSaving ? (
                            <><span className="spinner-border spinner-border-sm me-1" />Saving...</>
                        ) : (
                            <><i className="fas fa-save me-1" />Save Rate Change</>
                        )}
                    </button>
                </div>
            </form>
        </ModalWrap>
    );
};

export default RateChangeModal;
