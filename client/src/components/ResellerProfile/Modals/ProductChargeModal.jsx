import React from 'react';
import ModalWrap from '../ModalWrap';

const ProductChargeModal = ({
    saving,
    productChargeAmount,
    setProductChargeAmount,
    productChargeDate,
    setProductChargeDate,
    productChargeNote,
    setProductChargeNote,
    onSubmit,
    onClose
}) => {
    return (
        <ModalWrap title="Add Manual Product Charge" onClose={onClose}>
            <form className="row g-3" onSubmit={onSubmit}>
                <div className="col-md-6">
                    <label className="form-label fw-bold">Total Product Price (Tk)</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="form-control form-control-lg fw-bold text-danger"
                        value={productChargeAmount}
                        onChange={(e) => setProductChargeAmount(e.target.value)}
                        required
                        placeholder="e.g. 500.00"
                    />
                </div>
                <div className="col-md-6">
                    <label className="form-label fw-bold">Date</label>
                    <input
                        type="date"
                        className="form-control form-control-lg"
                        value={productChargeDate}
                        onChange={(e) => setProductChargeDate(e.target.value)}
                        required
                    />
                </div>
                <div className="col-12">
                    <label className="form-label fw-bold">Product Details / Note</label>
                    <textarea
                        className="form-control"
                        rows="3"
                        placeholder="e.g. 5 ONUs and ONU boxes supplied."
                        value={productChargeNote}
                        onChange={(e) => setProductChargeNote(e.target.value)}
                        required
                    />
                </div>
                <div className="col-12 text-end mt-4">
                    <button type="button" className="btn btn-light rounded-pill me-2 px-3" onClick={onClose} disabled={saving}>Cancel</button>
                    <button className="btn btn-danger text-white fw-bold rounded-pill px-4" disabled={saving}>{saving ? "Saving..." : "Save Charge"}</button>
                </div>
            </form>
        </ModalWrap>
    );
};

export default ProductChargeModal;
