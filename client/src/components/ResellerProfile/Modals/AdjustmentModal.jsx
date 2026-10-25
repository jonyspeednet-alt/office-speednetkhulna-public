import React from 'react';
import ModalWrap from '../ModalWrap';

const AdjustmentModal = ({ adjForm, setAdjForm, onSubmit, onClose }) => {
    return (
        <ModalWrap title="Commission Adjustment / Deduction" onClose={onClose}>
            <form className="row g-3" onSubmit={onSubmit}>
                <div className="col-md-6">
                    <label className="form-label fw-bold">Type</label>
                    <select
                        className="form-select"
                        value={adjForm.type}
                        onChange={(e) => setAdjForm({ ...adjForm, type: e.target.value })}
                    >
                        <option value="adjustment">Adjustment (Bonus)</option>
                        <option value="deduction">General Deduction (Other)</option>
                        <option value="partner_collected">Direct Bill Collected by Partner (Deduction)</option>
                    </select>
                </div>
                <div className="col-md-6">
                    <label className="form-label fw-bold">Amount (Tk)</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="form-control"
                        value={adjForm.amount}
                        onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })}
                        required
                    />
                </div>
                <div className="col-12">
                    <label className="form-label fw-bold">Reason / Note</label>
                    <textarea
                        className="form-control"
                        rows="2"
                        value={adjForm.note}
                        onChange={(e) => setAdjForm({ ...adjForm, note: e.target.value })}
                    />
                </div>
                <div className="col-12 text-end">
                    <button type="button" className="btn btn-light rounded-pill me-2" onClick={onClose}>Cancel</button>
                    <button className="btn btn-info text-white fw-bold rounded-pill px-4">Save</button>
                </div>
            </form>
        </ModalWrap>
    );
};

export default AdjustmentModal;
