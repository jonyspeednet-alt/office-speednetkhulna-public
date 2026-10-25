import React, { useState } from "react";
import { money } from "../../../utils/formatters";

const CollectionTab = ({
  cpUserPayments,
  onInitPayments,
  onRecordPayment,
  onBulkFullPaid,
  onImportClick,
  onMaximSync,
  maximSyncing,
  maximStatus,
  maximSuffix,
  onSaveMaximSuffix,
  maximHealth,
  maximHealthLoading,
}) => {
  const [editingSuffix, setEditingSuffix] = useState(false);
  const [suffixDraft, setSuffixDraft] = useState(maximSuffix || "");
  const lastLog = maximStatus?.log || null;
  const lastSyncText = lastLog
    ? `${lastLog.status === "completed" ? "Success" : lastLog.status} · ${lastLog.rows_payments || 0} payments / ${lastLog.rows_customers || 0} customers`
    : "Not synced yet";
  const getPending = (p) =>
    Number(p.deferred_amount ?? Math.max(0, Number(p.amount_due || 0) - Number(p.amount_paid || 0)));
  const totalCollection = cpUserPayments.reduce(
    (s, p) => s + Number(p.realized_amount ?? (p.amount_paid || 0)),
    0,
  );
  const totalDue = cpUserPayments.reduce(
    (s, p) => s + Number(p.amount_due || 0),
    0,
  );
  const totalPending = cpUserPayments.reduce((s, p) => s + getPending(p), 0);
  const pendingUsers = cpUserPayments.filter((p) => getPending(p) > 0).length;
  const partialUsers = cpUserPayments.filter((p) => Number(p.amount_paid || 0) > 0 && getPending(p) > 0).length;
  const collectionRate = Math.round((totalCollection / (totalDue || 1)) * 100);

  return (
    <div className="p-2 p-sm-3">
      <div className="row g-2 g-md-3 mb-3 mb-md-4 mt-1">
        <div className="col-6 col-lg-3">
          <div
            className="card border-0 shadow-sm rounded-4 h-100 overflow-hidden position-relative rp-gradient-purple"
          >
            <div className="card-body p-3 text-white">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="rp-gradient-icon">
                  <i className="fas fa-users" />
                </div>
                <span className="small opacity-75">Total Users</span>
              </div>
              <h4 className="fw-bold mb-0">{cpUserPayments.length} users</h4>
              <div className="small opacity-75 mt-1">Active users</div>
            </div>
          </div>
        </div>
        <div className="col-6 col-lg-3">
          <div
            className="card border-0 shadow-sm rounded-4 h-100 overflow-hidden rp-gradient-green"
          >
            <div className="card-body p-3 text-white">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="rp-gradient-icon">
                  <i className="fas fa-money-bill-wave" />
                </div>
                <span className="small opacity-75">Total Collection</span>
              </div>
              <h4 className="fw-bold mb-0">{money(totalCollection)}</h4>
              <div
                className="progress mt-2"
                style={{ height: 4, backgroundColor: "rgba(255,255,255,0.2)" }}
              >
                <div
                  className="progress-bar bg-white"
                  style={{
                    width: `${Math.min(100, (totalCollection / (totalDue || 1)) * 100)}%`,
                  }}
                ></div>
              </div>
            </div>
          </div>
        </div>
        <div className="col-6 col-lg-3">
          <div
            className="card border-0 shadow-sm rounded-4 h-100 overflow-hidden rp-gradient-amber"
          >
            <div className="card-body p-3 text-white">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="rp-gradient-icon">
                  <i className="fas fa-hand-holding-usd" />
                </div>
                <span className="small opacity-75">Due Bills</span>
              </div>
              <h4 className="fw-bold mb-0">{money(totalPending)}</h4>
              <div className="small opacity-75 mt-1">
                {pendingUsers} pending{partialUsers > 0 ? ` (${partialUsers} partial)` : ''}
              </div>
            </div>
          </div>
        </div>
        <div className="col-6 col-lg-3">
          <div
            className="card border-0 shadow-sm rounded-4 h-100 overflow-hidden rp-gradient-dark"
          >
            <div className="card-body p-3 text-white">
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="rp-gradient-icon">
                  <i className="fas fa-chart-line" />
                </div>
                <span className="small opacity-75">Collection Rate</span>
              </div>
              <h4 className="fw-bold mb-0">{collectionRate}%</h4>
              <div className="small opacity-75 mt-1">Performance</div>
            </div>
          </div>
        </div>
      </div>

      <div className="d-flex align-items-center gap-2 mb-2 small">
        <span className="text-muted">Maxim suffix:</span>
        {editingSuffix ? (
          <>
            <input
              type="text"
              className="form-control form-control-sm"
              style={{ maxWidth: 220 }}
              placeholder="@speednetmasum"
              value={suffixDraft}
              onChange={(e) => setSuffixDraft(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-sm btn-success"
              onClick={async () => {
                await onSaveMaximSuffix(suffixDraft.trim());
                setEditingSuffix(false);
              }}
            >
              Save
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => { setEditingSuffix(false); setSuffixDraft(maximSuffix || ""); }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <span className="badge bg-light text-dark border">{maximSuffix || "Not set"}</span>
            <button
              type="button"
              className="btn btn-sm btn-link p-0"
              onClick={() => { setSuffixDraft(maximSuffix || ""); setEditingSuffix(true); }}
            >
              {maximSuffix ? "Change" : "Set"}
            </button>
          </>
        )}
      </div>

      <div className="card border-0 shadow-sm rounded-4 mb-3">
        <div className="card-body p-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <span className="fw-bold small">
              <i className="fas fa-heartbeat me-1 text-danger" /> Maxim মিল (প্রতি মাস)
            </span>
            {maximHealthLoading && (
              <span className="spinner-border spinner-border-sm text-secondary" />
            )}
          </div>
          {!maximHealth || maximHealth.length === 0 ? (
            <div className="text-muted small">এখনো কোনো মাসের তথ্য নেই — Maxim Sync চালান।</div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th>মাস</th>
                    <th className="text-end">Portal paid</th>
                    <th className="text-end">Maxim cash</th>
                    <th className="text-end">বাকি (portal)</th>
                    <th className="text-center">মিল</th>
                  </tr>
                </thead>
                <tbody>
                  {maximHealth.map((h) => (
                    <tr key={h.month}>
                      <td className="fw-bold">{h.month}</td>
                      <td className="text-end">{money(h.portal?.paid ?? 0)}</td>
                      <td className="text-end">{money(h.maxim?.cash ?? 0)}</td>
                      <td className="text-end">{money(h.portal?.pending ?? 0)}</td>
                      <td className="text-center">
                        {h.match === null ? (
                          <span className="badge bg-light text-dark border" title="একপাশে তথ্য নেই">—</span>
                        ) : h.match ? (
                          <span className="badge bg-success bg-opacity-10 text-dark border">✓ মিলেছে</span>
                        ) : (
                          <span className="badge bg-warning bg-opacity-10 text-dark border" title={`পার্থক্য ${money(Math.abs(Number(h.portal?.paid ?? 0) - Number(h.maxim?.cash ?? 0)))}`}>⚠ অমিল</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="rp-toolbar mb-3">
        <div className="rp-toolbar-actions flex-grow-1 justify-content-md-end justify-content-start">
          <button
            className="btn btn-sm btn-outline-dark rounded-pill px-3 shadow-sm"
            onClick={() => onMaximSync && onMaximSync()}
            disabled={!!maximSyncing}
            title="Fetch this month's payments + customer snapshot from Maxim"
          >
            <i className={`fas ${maximSyncing ? "fa-spinner fa-spin" : "fa-cloud-download-alt"} me-1`} />
            {maximSyncing ? "Syncing…" : "Maxim Sync"}
          </button>
          <span className="badge bg-light text-dark border align-self-center" title="Last Maxim sync">
            <i className="fas fa-history me-1" />{lastSyncText}
          </span>
          <button
            className="btn btn-sm btn-outline-success rounded-pill px-3 shadow-sm"
            onClick={() =>
              import("../../../utils/excelGenerator").then((m) =>
                m.downloadUserImportSample(),
              )
            }
          >
            <i className="fas fa-download me-1" /><span className="d-none d-sm-inline"> Sample</span> Excel
          </button>
          <button
            className="btn btn-sm btn-info text-white rounded-pill px-3 shadow-sm"
            onClick={onImportClick}
          >
            <i className="fas fa-file-excel me-1" /> Excel Import
          </button>
          <button
            className="btn btn-sm btn-primary rounded-pill px-3 shadow-sm"
            onClick={onInitPayments}
          >
            <i className="fas fa-sync me-1" /> Initialize
          </button>
        </div>
      </div>

      <div className="rp-mobile-list d-md-none mb-3">
        {cpUserPayments.length === 0 ? (
          <div className="text-center text-muted py-4 small"><i className="fas fa-inbox d-block mb-2" style={{ fontSize: '1.5rem' }} />Initialize or import Excel</div>
        ) : (
          cpUserPayments.map((p) => {
            const pending = getPending(p);
            return (
              <article key={p.id} className="rp-mobile-card">
                <div className="rp-mobile-card-head">
                  <div>
                    <div className="fw-bold">{p.user_name}</div>
                    <small className="text-muted">{p.user_id_code || '-'} · {p.package_name || '-'}</small>
                  </div>
                  <span className={`badge ${pending <= 0 ? 'bg-success' : Number(p.amount_paid) > 0 ? 'bg-info' : 'bg-warning'} bg-opacity-10 text-dark border`}>
                    {pending <= 0 ? 'Paid' : Number(p.amount_paid) > 0 ? 'Partial' : 'Unpaid'}
                  </span>
                </div>
                <div className="rp-kv mt-2">
                  <div><span className="label">Bill</span><br />{money(p.amount_due)}</div>
                  <div><span className="label">Due</span><br /><span className={pending > 0 ? 'text-danger fw-bold' : 'text-success'}>{money(pending)}</span></div>
                </div>
                <div className="d-flex gap-2 align-items-center mt-2">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="form-control form-control-sm"
                    defaultValue={Number(p.amount_paid || 0)}
                    onBlur={(e) => {
                      const val = Number(e.target.value || 0);
                      if (val !== Number(p.amount_paid || 0)) onRecordPayment(p.user_id, val);
                    }}
                    aria-label="Receive amount"
                  />
                  {pending > 0 && (
                    <button type="button" className="btn btn-sm btn-outline-success text-nowrap" onClick={() => onRecordPayment(p.user_id, Number(p.amount_due))}>
                      Full Pay
                    </button>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>

      <div className="rp-table-wrap d-none d-md-block">
        <table className="table table-hover align-middle mb-0 table-sm">
          <thead className="table-light">
            <tr>
              <th>User</th>
              <th>ID</th>
              <th>Package</th>
              <th>Total Bill</th>
              <th>Receive Amount</th>
              <th>Not Paid</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {cpUserPayments.length === 0 ? (
              <tr>
                <td colSpan="8" className="text-center text-muted py-4">
                  <i className="fas fa-inbox d-block mb-1" />
                  No records for this month. Click &quot;Initialize&quot;.
                </td>
              </tr>
            ) : (
              cpUserPayments.map((p) => (
                <tr key={p.id}>
                  <td className="fw-bold">{p.user_name}</td>
                  <td>
                    <span className="badge bg-light text-dark border">
                      {p.user_id_code || "-"}
                    </span>
                  </td>
                  <td>{p.package_name || "-"}</td>
                  <td>{money(p.amount_due)}</td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="form-control form-control-sm"
                      style={{ width: 110 }}
                      defaultValue={Number(p.amount_paid || 0)}
                      onBlur={(e) => {
                        const val = Number(e.target.value || 0);
                        if (val !== Number(p.amount_paid || 0)) {
                          onRecordPayment(p.user_id, val);
                        }
                      }}
                    />
                  </td>
                  <td
                    className={
                      getPending(p) > 0 ? "text-danger fw-bold" : "text-success"
                    }
                  >
                    {money(getPending(p))}
                  </td>
                  <td>
                    <span
                      className={`badge ${getPending(p) <= 0 ? "bg-success" : Number(p.amount_paid) > 0 ? "bg-info" : "bg-warning"} bg-opacity-10 text-dark border`}
                    >
                      {getPending(p) <= 0
                        ? "Paid"
                        : Number(p.amount_paid) > 0
                          ? "Partial"
                          : "Unpaid"}
                    </span>
                  </td>
                  <td>
                    {getPending(p) > 0 && (
                      <button
                        className="btn btn-xs btn-outline-success"
                        onClick={() =>
                          onRecordPayment(p.user_id, Number(p.amount_due))
                        }
                      >
                        Full Pay
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {cpUserPayments.length > 0 && (
        <div className="mt-3 text-center text-md-end">
          <button type="button" className="btn btn-sm btn-success w-100 w-md-auto" onClick={onBulkFullPaid}>
            <i className="fas fa-check-double me-1" />
            Mark All Full Paid
          </button>
        </div>
      )}
    </div>
  );
};

export default CollectionTab;
