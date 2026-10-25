import React from "react";
import ModalWrap from "../ModalWrap";
import { money } from "../../../utils/formatters";

const CommissionPaymentModal = ({
  cpCommission,
  commPayForm,
  setCommPayForm,
  onSubmit,
  onClose,
}) => {
  return (
    <ModalWrap title="Pay Commission" onClose={onClose}>
      <form className="row g-3" onSubmit={onSubmit}>
        <div className="col-12">
          <div className="alert alert-info py-2 small mb-0">
            {commPayForm.commission_month ? (
              <>
                Month: <strong>{commPayForm.commission_month}</strong> · Due
                Commission:{" "}
                <strong>
                  {money(
                    commPayForm.closing_balance ||
                      cpCommission?.closing_balance ||
                      0,
                  )}
                </strong>
              </>
            ) : (
              <>No finalized commission month selected.</>
            )}
          </div>
        </div>
        <div className="col-md-4">
          <label className="form-label fw-bold">Amount (Tk)</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            className="form-control form-control-lg fw-bold text-success"
            value={commPayForm.amount}
            onChange={(e) =>
              setCommPayForm({ ...commPayForm, amount: e.target.value })
            }
            required
          />
        </div>
        <div className="col-md-4">
          <label className="form-label fw-bold">Date</label>
          <input
            type="date"
            className="form-control"
            value={commPayForm.payment_date}
            onChange={(e) =>
              setCommPayForm({ ...commPayForm, payment_date: e.target.value })
            }
            required
          />
        </div>
        <div className="col-md-4">
          <label className="form-label fw-bold">Payment Method</label>
          <select
            className="form-select"
            value={commPayForm.payment_method}
            onChange={(e) =>
              setCommPayForm({ ...commPayForm, payment_method: e.target.value })
            }
          >
            <option>Cash</option>
            <option>Bank</option>
            <option>bKash</option>
            <option>Nagad</option>
            <option>Rocket</option>
            <option>Other</option>
          </select>
        </div>
        <div className="col-md-6">
          <label className="form-label fw-bold">Reference No</label>
          <input
            className="form-control"
            value={commPayForm.reference_no}
            onChange={(e) =>
              setCommPayForm({ ...commPayForm, reference_no: e.target.value })
            }
          />
        </div>
        <div className="col-md-6">
          <label className="form-label fw-bold">Note</label>
          <input
            className="form-control"
            value={commPayForm.note}
            onChange={(e) =>
              setCommPayForm({ ...commPayForm, note: e.target.value })
            }
          />
        </div>
        <div className="col-12 text-end">
          <button
            type="button"
            className="btn btn-light rounded-pill me-2"
            onClick={onClose}
          >
            Cancel
          </button>
          <button className="btn btn-success fw-bold rounded-pill px-4">
            Confirm Payment
          </button>
        </div>
      </form>
    </ModalWrap>
  );
};

export default CommissionPaymentModal;
