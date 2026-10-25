import React from "react";
import { money } from "../../../utils/formatters";

const CPCommissionTable = ({ summary, reseller, fmtMoney }) => {
  const fmt = fmtMoney || money;

  const totalDue      = Number(summary.total_due        || 0);
  const totalUsers    = Number(summary.total_users     || 0);
  const paying        = Number(summary.paying_users     || 0);
  const nonPaying     = Number(summary.non_paying_users || 0);
  const collected     = Number(summary.total_collected  || 0);
  const realized      = Number(summary.total_realized   || summary.total_collected || 0);
  const deferred      = Number(summary.total_deferred   || 0);
  const profitPct     = Number(summary.profit_share_percentage ?? reseller?.profit_share_percentage ?? 0);
  const gross         = Number(summary.gross_commission  || 0);
  const prodDed       = Number(summary.product_deduction || 0);
  const advances      = Number(summary.partner_advances  || 0);
  const adj           = Number(summary.adjustments       || 0);
  const ded           = Number(summary.deductions        || 0);
  const net           = Number(summary.net_commission    || 0);
  const prevBal       = Number(summary.previous_balance  || 0);
  const totalPayable  = Number(summary.total_payable     || 0);
  const paid          = Number(summary.paid_to_partner   || 0);
  const closing       = Number(summary.closing_balance   || 0);

  const closingPos = closing >= 0;

  const th = { padding: '8px 12px', fontWeight: 600, fontSize: '0.82rem', background: '#f1f5f9', borderBottom: '2px solid #e2e8f0' };
  const td = { padding: '9px 12px', borderBottom: '1px solid #f0f4f8', fontSize: '0.85rem', verticalAlign: 'middle' };
  const tdCount = { ...td, textAlign: 'center', color: '#64748b', fontFamily: 'monospace', width: 140 };
  const tdAmt = { ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, width: 140 };

  return (
    <div className="table-responsive">
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '52%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '26%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>DESCRIPTION</th>
            <th style={{ ...th, textAlign: 'center' }}>COUNT</th>
            <th style={{ ...th, textAlign: 'right' }}>AMOUNT</th>
          </tr>
        </thead>
        <tbody>

          {/* ① Total Billing Due */}
          <tr>
            <td style={td}>Total Billing Due</td>
            <td style={tdCount}>{totalUsers.toLocaleString('en-US')} users</td>
            <td style={tdAmt}>{fmt(totalDue)}</td>
          </tr>

          {/* ② Paid Collection */}
          <tr style={{ background: '#f0fdf4' }}>
            <td style={{ ...td, color: '#16a34a', fontWeight: 600 }}>Paid Collection</td>
            <td style={{ ...tdCount, color: '#16a34a', fontWeight: 600 }}>{paying.toLocaleString('en-US')} paying</td>
            <td style={{ ...tdAmt, color: '#16a34a' }}>{fmt(collected)}</td>
          </tr>

          {/* ③ Commission */}
          <tr style={{ background: '#eff6ff' }}>
            <td style={{ ...td, fontWeight: 700 }}>
              Commission (Collection {fmt(realized)} × {profitPct}%)
            </td>
            <td style={tdCount}>—</td>
            <td style={{ ...tdAmt, color: '#2563eb', fontSize: '1rem' }}>{fmt(gross)}</td>
          </tr>

          {/* ④ Deferred Amount */}
          {deferred > 0 && (
            <tr>
              <td style={{ ...td, color: '#dc2626', paddingLeft: 24 }}>
                (−) Deferred Amount
              </td>
              <td style={{ ...tdCount, color: '#dc2626' }}>{nonPaying.toLocaleString('en-US')} deferred</td>
              <td style={{ ...tdAmt, color: '#dc2626' }}>(-) {fmt(deferred)}</td>
            </tr>
          )}

          {/* ⑤ Product Deduction */}
          {prodDed > 0 && (
            <tr>
              <td style={{ ...td, color: '#dc2626', paddingLeft: 24 }}>(−) Product Charges</td>
              <td style={tdCount}>—</td>
              <td style={{ ...tdAmt, color: '#dc2626' }}>(-) {fmt(prodDed)}</td>
            </tr>
          )}

          {/* ⑥ Advance Adjustment */}
          {advances > 0 && (
            <tr>
              <td style={{ ...td, color: '#dc2626', paddingLeft: 24 }}>(−) Advance Adjustment</td>
              <td style={tdCount}>—</td>
              <td style={{ ...tdAmt, color: '#dc2626' }}>(-) {fmt(advances)}</td>
            </tr>
          )}

          {/* ⑦ Adjustment Bonus */}
          {adj > 0 && (
            <tr>
              <td style={{ ...td, color: '#16a34a', paddingLeft: 24 }}>
                (+) Adjustment Bonus{summary.adjustment_note ? `: ${summary.adjustment_note}` : ''}
              </td>
              <td style={tdCount}>—</td>
              <td style={{ ...tdAmt, color: '#16a34a' }}>(+) {fmt(adj)}</td>
            </tr>
          )}

          {/* ⑧ Manual Deduction */}
          {ded > 0 && (
            <tr>
              <td style={{ ...td, color: '#dc2626', paddingLeft: 24 }}>
                {summary.deduction_note?.startsWith('[পার্টনার বিল কালেকশন]')
                  ? '(−) Partner Direct Customer Collection'
                  : `(−) Deduction: ${summary.deduction_note || 'Manual Deduction'}`}
              </td>
              <td style={tdCount}>—</td>
              <td style={{ ...tdAmt, color: '#dc2626' }}>(-) {fmt(ded)}</td>
            </tr>
          )}

          {/* ⑨ Net Commission */}
          <tr style={{ background: '#f8fafc', borderTop: '2px solid #cbd5e1' }}>
            <td style={{ ...td, fontWeight: 700, borderTop: '2px solid #cbd5e1' }}>Net Commission</td>
            <td style={{ ...tdCount, borderTop: '2px solid #cbd5e1' }}>—</td>
            <td style={{ ...tdAmt, color: '#16a34a', fontSize: '0.95rem', borderTop: '2px solid #cbd5e1' }}>{fmt(net)}</td>
          </tr>

          {/* ⑩ Previous Balance */}
          {prevBal !== 0 && (
            <tr>
              <td style={{ ...td, paddingLeft: 24, color: prevBal > 0 ? '#dc2626' : '#16a34a' }}>
                {prevBal > 0 ? '(+) Previous Due (Carry Forward)' : '(−) Previous Credit Balance'}
              </td>
              <td style={tdCount}>—</td>
              <td style={{ ...tdAmt, color: prevBal > 0 ? '#dc2626' : '#16a34a' }}>
                {prevBal > 0 ? '+' : '-'} {fmt(Math.abs(prevBal))}
              </td>
            </tr>
          )}

          {/* ⑪ Total Payable */}
          <tr style={{ background: '#f1f5f9', borderTop: '2px solid #cbd5e1' }}>
            <td style={{ ...td, fontWeight: 700, fontSize: '0.95rem', borderTop: '2px solid #cbd5e1' }}>
              Total Payable
            </td>
            <td style={{ ...tdCount, borderTop: '2px solid #cbd5e1' }}>—</td>
            <td style={{ ...tdAmt, fontSize: '0.97rem', borderTop: '2px solid #cbd5e1' }}>{fmt(totalPayable)}</td>
          </tr>

          {/* ⑫ Paid */}
          {paid > 0 && (
            <tr>
              <td style={{ ...td, paddingLeft: 24, color: '#16a34a' }}>(−) Paid</td>
              <td style={tdCount}>—</td>
              <td style={{ ...tdAmt, color: '#16a34a' }}>(-) {fmt(paid)}</td>
            </tr>
          )}

          {/* ⑬ Closing Balance */}
          <tr style={{ background: closingPos ? '#f0fdf4' : '#fef2f2' }}>
            <td style={{ ...td, fontWeight: 700, fontSize: '1rem', color: closingPos ? '#15803d' : '#b91c1c', borderTop: '2px solid #cbd5e1' }}>
              <i className={`fas ${closingPos ? 'fa-arrow-circle-up' : 'fa-arrow-circle-down'} me-2`} />
              {closingPos ? 'Payable to Partner (Company Owes)' : 'Due from Partner (Partner Owes)'}
            </td>
            <td style={{ ...tdCount, borderTop: '2px solid #cbd5e1' }}>—</td>
            <td style={{ ...tdAmt, fontSize: '1.05rem', fontWeight: 700, color: closingPos ? '#15803d' : '#b91c1c', borderTop: '2px solid #cbd5e1' }}>
              {fmt(Math.abs(closing))}
            </td>
          </tr>

        </tbody>
      </table>
    </div>
  );
};

export default CPCommissionTable;
