import React from "react";
import { money } from "../../../utils/formatters";

// Helper to render a signed balance badge
const BalanceBadge = ({ value, zeroLabel = "Zero" }) => {
  if (value === 0 || value === null || value === undefined) {
    return <span className="text-muted small">{zeroLabel}</span>;
  }
  const abs = Math.abs(value);
  const isPositive = value > 0;
  return (
    <span className={`fw-bold d-inline-flex align-items-center gap-1 ${isPositive ? "text-success" : "text-danger"}`}>
      {isPositive ? "▲" : "▼"} {money(abs)}
      <span
        className="badge rounded-pill"
        style={{
          fontSize: "0.72rem",
          lineHeight: "1.4",
          padding: "2px 10px",
          whiteSpace: "nowrap",
          backgroundColor: isPositive ? "#dcfce7" : "#fee2e2",
          color: isPositive ? "#15803d" : "#b91c1c",
          border: `1px solid ${isPositive ? "#bbf7d0" : "#fecaca"}`,
        }}
      >
        {isPositive ? "Partner will receive" : "Company will receive"}
      </span>
    </span>
  );
};

// Full calculation breakdown for current month
const CommissionBreakdown = ({ summary }) => {
  if (!summary) return null;
  const gross         = Number(summary.gross_commission   || 0);
  const deferred      = Number(summary.total_deferred     || 0);
  const productDed    = Number(summary.product_deduction  || 0);
  const advances      = Number(summary.partner_advances   || 0);
  const adjustments   = Number(summary.adjustments        || 0);
  const deductions    = Number(summary.deductions         || 0);
  const net           = Number(summary.net_commission     || 0);
  const prevBal       = Number(summary.previous_balance   || 0);
  const totalPayable  = Number(summary.total_payable      || 0);
  const paid          = Number(summary.paid_to_partner    || 0);
  const closing       = Number(summary.closing_balance    || 0);
  const nonPaying     = Number(summary.non_paying_users   || 0);
  const partialPaying = Number(summary.partial_paying_users || 0);
  const profitPct     = Number(summary.profit_share_percentage || 0);
  const realized      = Number(summary.total_realized     || summary.total_collected || 0);

  const rows = [
    { label: "Collected Bills (Realized)",   value: realized,     sign: "neutral", bold: false },
    { label: `× ${profitPct}% Commission = Gross`, value: gross,    sign: "neutral", bold: false },
    deferred > 0 && { label: `(-) Due Bills (${nonPaying} pending${partialPaying > 0 ? `, ${partialPaying} partial` : ''})`, value: deferred, sign: "minus", bold: false },
    productDed > 0 && { label: "(-) Product Deduction",   value: productDed,  sign: "minus", bold: false },
    advances > 0 && { label: "(-) Partner Advance", value: advances,    sign: "minus", bold: false },
    adjustments !== 0 && { label: "(+) Adjustment", value: adjustments, sign: "plus",  bold: false },
    deductions !== 0 && { label: "(-) Deduction",   value: deductions, sign: "minus", bold: false },
    { label: "= Net Commission",             value: net,          sign: "result", bold: true },
    prevBal !== 0 && {
      label: prevBal > 0 ? "(+) Previous Dues (with company)" : "(-) Previous Debt (with partner)",
      value: Math.abs(prevBal),
      sign: prevBal > 0 ? "plus" : "minus",
      bold: false,
    },
    totalPayable !== net && { label: "= Total Payable",        value: totalPayable, sign: "result", bold: true },
    paid > 0 && { label: "(-) Paid",               value: paid,        sign: "minus", bold: false },
  ].filter(Boolean);

  const closingIsPositive = closing >= 0;

  return (
    <div className="card border-0 bg-light rounded-3 p-3 mb-3">
      <div className="d-flex align-items-center gap-2 mb-2">
        <i className="fas fa-calculator text-primary" />
        <span className="fw-semibold small text-dark">Commission Breakdown</span>
        <span className="badge bg-secondary bg-opacity-10 text-secondary border rounded-pill ms-auto px-2 py-1" style={{ fontSize: "0.65rem" }}>
          {summary.month}
        </span>
      </div>
      <table className="table table-sm mb-2" style={{ fontSize: "0.82rem" }}>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={r.sign === "result" ? "border-top fw-bold" : ""}>
              <td className="text-muted ps-0" style={{ width: "60%" }}>{r.label}</td>
              <td
                className={`text-end pe-0 fw-${r.bold ? "bold" : "normal"} ${
                  r.sign === "minus" ? "text-danger"
                  : r.sign === "plus"  ? "text-success"
                  : r.sign === "result" ? "text-dark"
                  : "text-secondary"
                }`}
              >
                {r.sign === "minus" ? "- " : r.sign === "plus" ? "+ " : ""}
                {money(r.value)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Final balance with clear direction */}
      <div
        className="rounded-2 p-2 d-flex align-items-center justify-content-between"
        style={{
          backgroundColor: closingIsPositive ? "#dcfce7" : "#fee2e2",
          border: `1px solid ${closingIsPositive ? "#bbf7d0" : "#fecaca"}`,
        }}
      >
        <span className={`fw-bold ${closingIsPositive ? "text-success" : "text-danger"}`}>
          <i className={`fas ${closingIsPositive ? "fa-arrow-circle-up" : "fa-arrow-circle-down"} me-1`} />
          {closingIsPositive ? "Partner Receivable" : "Partner Payable"}
        </span>
        <span className={`fs-6 fw-bold ${closingIsPositive ? "text-success" : "text-danger"}`}>
          {money(Math.abs(closing))}
        </span>
      </div>
    </div>
  );
};

const CommissionTab = ({
  cpMonth,
  cpCommission,
  cpHistory,
  onGenerateCommission,
  onCommissionPayment,
  onAdjustment,
  onFinalize,
  onUnfinalize,
  onDownloadReport,
}) => {
  const showMonthSummary =
    cpCommission && String(cpCommission.month || "") === String(cpMonth || "");

  return (
    <div className="p-2 p-sm-3">
      {/* Current month breakdown card */}
      {showMonthSummary && <CommissionBreakdown summary={cpCommission} />}

      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div className="d-flex gap-2 align-items-center">
          <h6 className="fw-bold m-0">Commission History</h6>
        </div>
        <div className="rp-toolbar-actions">
          <button
            type="button"
            className="btn btn-sm btn-outline-primary rounded-pill px-3 shadow-sm"
            onClick={onGenerateCommission}
          >
            <i className="fas fa-sync-alt me-1" />
            <span>Recalculate</span>
          </button>
        </div>
      </div>
      <div className="rp-table-wrap rp-table-wide d-none d-md-block">
        <table className="table table-hover align-middle mb-0 table-sm">
          <thead className="table-light">
            <tr>
              <th>Month</th>
              <th>Users</th>
              <th>Collection</th>
              <th>%</th>
              <th>Gross</th>
              <th>Due Bills</th>
              <th>Product</th>
              <th>Adj</th>
              <th>Ded</th>
              <th>Net</th>
              <th>Paid</th>
              <th>Balance</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cpHistory.length === 0 ? (
              <tr>
                <td colSpan="14" className="text-center text-muted py-4">
                  <i className="fas fa-inbox d-block mb-1" />
                  No commission history
                </td>
              </tr>
            ) : (
              cpHistory.map((h) => {
                const bal = Number(h.closing_balance || 0);
                const prevBal = Number(h.previous_balance || 0);
                return (
                  <tr key={h.id}>
                    <td className="fw-bold text-primary">{h.month}</td>
                    <td>
                      <div className="fw-bold">
                        {h.paying_users}/{h.total_users}
                      </div>
                      <div className="text-muted" style={{ fontSize: 10 }}>
                        Paid Users
                      </div>
                    </td>
                    <td>
                      <div className="fw-bold">{money(h.total_collection)}</div>
                    </td>
                    <td>
                      <span className="badge bg-light text-dark border">
                        {Number(h.profit_share_pct)}%
                      </span>
                    </td>
                    <td>{money(h.gross_commission)}</td>
                    {/* Deferred (unpaid bills) */}
                    <td className={Number(h.deferred_amount || 0) > 0 ? "text-warning fw-bold" : "text-muted"}>
                      {Number(h.deferred_amount || 0) > 0 ? (
                        <div>
                          <span className="me-1 text-danger">-</span>
                          {money(h.deferred_amount)}
                        </div>
                      ) : "-"}
                    </td>
                    <td
                      className={
                        Number(h.product_deduction || 0) !== 0 ? "text-danger" : ""
                      }
                    >
                      {Number(h.product_deduction || 0) !== 0 ? (
                        <div className="d-flex align-items-center">
                          <span className="me-1">-</span>
                          {money(h.product_deduction)}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td
                      className={Number(h.adjustments) !== 0 ? "text-info" : ""}
                    >
                      {Number(h.adjustments) !== 0 ? (
                        <div className="d-flex align-items-center">
                          <span className="me-1 text-success">+</span>
                          {money(h.adjustments)}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td
                      className={Number(h.deductions) !== 0 ? "text-danger" : ""}
                    >
                      {Number(h.deductions) !== 0 ? (
                        <div className="d-flex align-items-center">
                          <span className="me-1">-</span>
                          {money(h.deductions)}
                        </div>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="fw-bold text-dark">
                      {money(h.net_commission)}
                    </td>
                    <td className="text-success fw-bold">
                      {money(h.paid_amount)}
                    </td>
                    {/* Signed balance — shows direction */}
                    <td>
                      <BalanceBadge value={bal} />
                      {prevBal !== 0 && (
                        <div style={{ fontSize: "0.7rem" }} className={prevBal > 0 ? "text-success" : "text-danger"}>
                          {prevBal > 0 ? "↑" : "↓"} Prev: {money(Math.abs(prevBal))}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge rounded-pill ${h.status === "finalized" ? "bg-success" : "bg-warning"} bg-opacity-10 text-dark border px-2`}
                      >
                        {h.status === "finalized" ? "Finalized" : "Draft"}
                      </span>
                    </td>
                    <td>
                      <div className="btn-group shadow-sm rounded-pill overflow-hidden">
                        {h.status === "draft" && (
                          <>
                            <button
                              className="btn btn-white btn-sm border"
                              onClick={() => onAdjustment(h)}
                              title="Adjustment"
                            >
                              <i className="fas fa-sliders-h text-info" />
                            </button>
                            <button
                              className="btn btn-white btn-sm border"
                              onClick={() => onFinalize(h.id)}
                              title="Finalize"
                            >
                              <i className="fas fa-check text-success" />
                            </button>
                          </>
                        )}
                        {h.status === "finalized" && (
                          <>
                            <button
                              className="btn btn-white btn-sm border"
                              onClick={() => onUnfinalize(h.id)}
                              title="Unfinalize"
                            >
                              <i className="fas fa-undo text-warning" />
                            </button>
                            {bal > 0 && (
                              <button
                                className="btn btn-white btn-sm border"
                                onClick={() => onCommissionPayment(h)}
                                title="Pay commission for this month"
                              >
                                <i className="fas fa-money-bill text-success" />
                              </button>
                            )}
                            <button
                              className="btn btn-white btn-sm border"
                              onClick={() => onDownloadReport(h)}
                              title="Download Report"
                            >
                              <i className="fas fa-file-pdf text-danger" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="d-md-none rp-mobile-list">
        {cpHistory.length === 0 ? (
          <div className="text-center text-muted py-4">
            <i className="fas fa-inbox d-block mb-2" style={{ fontSize: '1.5rem' }} />
            No commission history
          </div>
        ) : (
          cpHistory.map((h) => {
            const bal = Number(h.closing_balance || 0);
            return (
              <div key={h.id} className="rp-mobile-card">
                <div className="rp-mobile-card-head">
                  <div>
                    <span className="fw-bold text-primary">{h.month}</span>
                    <span className={`badge rounded-pill ms-2 ${h.status === 'finalized' ? 'bg-success-subtle text-success-emphasis border border-success-subtle' : 'bg-warning-subtle text-warning-emphasis border border-warning-subtle'}`} style={{ fontSize: '0.65rem' }}>
                      {h.status === 'finalized' ? 'Finalized' : 'Draft'}
                    </span>
                  </div>
                  <div className="btn-group shadow-sm rounded-pill overflow-hidden" style={{ fontSize: '0.75rem' }}>
                    {h.status === 'draft' && (
                      <>
                        <button className="btn btn-white btn-sm border py-0" onClick={() => onAdjustment(h)} title="Adjustment"><i className="fas fa-sliders-h text-info" /></button>
                        <button className="btn btn-white btn-sm border py-0" onClick={() => onFinalize(h.id)} title="Finalize"><i className="fas fa-check text-success" /></button>
                      </>
                    )}
                    {h.status === 'finalized' && (
                      <>
                        <button className="btn btn-white btn-sm border py-0" onClick={() => onUnfinalize(h.id)} title="Unfinalize"><i className="fas fa-undo text-warning" /></button>
                        {bal > 0 && <button className="btn btn-white btn-sm border py-0" onClick={() => onCommissionPayment(h)} title="Payment"><i className="fas fa-money-bill text-success" /></button>}
                        <button className="btn btn-white btn-sm border py-0" onClick={() => onDownloadReport(h)} title="Report"><i className="fas fa-file-pdf text-danger" /></button>
                      </>
                    )}
                  </div>
                </div>
                <div className="rp-kv">
                  <div><span className="label">Collection</span><div className="fw-bold">{money(h.total_collection)}</div></div>
                  <div><span className="label">Gross</span><div>{money(h.gross_commission)}</div></div>
                  <div><span className="label">Due</span><div className={Number(h.deferred_amount || 0) > 0 ? 'text-danger fw-bold' : 'text-muted'}>{Number(h.deferred_amount || 0) > 0 ? `- ${money(h.deferred_amount)}` : '-'}</div></div>
                  <div><span className="label">Net</span><div className="fw-bold text-dark">{money(h.net_commission)}</div></div>
                  <div><span className="label">Paid</span><div className="text-success fw-bold">{money(h.paid_amount)}</div></div>
                  <div><span className="label">Balance</span><div><BalanceBadge value={bal} /></div></div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default CommissionTab;
