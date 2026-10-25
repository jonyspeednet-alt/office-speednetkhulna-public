import React from 'react';
import ModalWrap from '../ModalWrap';

const PaymentModal = ({
    saving,
    paymentAmount,
    setPaymentAmount,
    paymentDate,
    setPaymentDate,
    paymentMethod,
    setPaymentMethod,
    paymentNote,
    setPaymentNote,
    onSubmit,
    onClose
}) => {
    return (
        <ModalWrap title="Add Payment" onClose={onClose}>
            <form className="row g-3" onSubmit={onSubmit}>
                <div className="col-md-4">
                    <label className="form-label fw-bold">Amount (Tk)</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        className="form-control form-control-lg fw-bold text-success"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        required
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-bold">Date</label>
                    <input
                        type="date"
                        className="form-control"
                        value={paymentDate}
                        onChange={(e) => setPaymentDate(e.target.value)}
                        required
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-bold">Payment Method</label>
                    <select className="form-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                        <option>Cash</option>
                        <option>Bank</option>
                        <option>bKash</option>
                        <option>Nagad</option>
                        <option>Rocket</option>
                        <option>Other</option>
                    </select>
                </div>
                <div className="col-12">
                    <label className="form-label fw-bold">Note</label>
                    <textarea
                        className="form-control"
                        rows="2"
                        value={paymentNote}
                        onChange={(e) => setPaymentNote(e.target.value)}
                    />
                </div>
                <div className="col-12 text-end">
                    <button type="button" className="btn btn-light rounded-pill me-2" onClick={onClose} disabled={saving}>Close</button>
                    <button className="btn btn-warning fw-bold rounded-pill px-4" disabled={saving}>{saving ? "Saving..." : "Confirm Payment"}</button>
                </div>
            </form>
        </ModalWrap>
    );
};

export default PaymentModal;
