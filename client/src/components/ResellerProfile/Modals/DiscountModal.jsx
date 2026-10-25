import React from 'react';
import ModalWrap from '../ModalWrap';

const DiscountModal = ({
    saving,
    discountAmount,
    setDiscountAmount,
    discountDate,
    setDiscountDate,
    discountNote,
    setDiscountNote,
    onSubmit,
    onClose
}) => {
    return (
        <ModalWrap title="Add Discount" onClose={onClose}>
            <form className="row g-3" onSubmit={onSubmit}>
                <div className="col-md-4">
                    <label className="form-label fw-bold">Discount Amount (Tk)</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="form-control form-control-lg fw-bold text-info"
                        value={discountAmount}
                        onChange={(e) => setDiscountAmount(e.target.value)}
                        required
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-bold">Date</label>
                    <input
                        type="date"
                        className="form-control"
                        value={discountDate}
                        onChange={(e) => setDiscountDate(e.target.value)}
                        required
                    />
                </div>
                <div className="col-12">
                    <label className="form-label fw-bold">Reason / Note</label>
                    <textarea
                        className="form-control"
                        rows="2"
                        value={discountNote}
                        onChange={(e) => setDiscountNote(e.target.value)}
                        required
                    />
                </div>
                <div className="col-12 text-end">
                    <button type="button" className="btn btn-light rounded-pill me-2" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="btn btn-info text-white fw-bold rounded-pill px-4" disabled={saving}>{saving ? "Saving..." : "Save Discount"}</button>
                </div>
            </form>
        </ModalWrap>
    );
};

export default DiscountModal;
