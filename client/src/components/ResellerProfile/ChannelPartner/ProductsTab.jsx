import React, { useMemo, useState, useEffect, useRef } from "react";
import { money } from "../../../utils/formatters";
import ModalWrap from "../ModalWrap";

const ProductsTab = ({
  cpUsers,
  cpProductSummary,
  cpProductCatalog,
  onEditUserProducts,
  onImportCatalog,
  importingCatalog,
  lastImportResult,
  onClearImportResult,
  showManualProductCharge,
  setShowManualProductCharge,
  manualProductChargeForm,
  setManualProductChargeForm,
  manualProductChargeLoading,
  handleSaveManualProductCharge,
}) => {
  const [search, setSearch] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) setSelectedFile(file);
  };

  useEffect(() => {
    if (!lastImportResult) return;
    const t = setTimeout(onClearImportResult, 10000);
    return () => clearTimeout(t);
  }, [lastImportResult, onClearImportResult]);
  
  const isOverridden = manualProductChargeForm?.amount !== "" && manualProductChargeForm?.amount !== null;

  const userTotals = useMemo(() => {
    const map = {};
    (cpProductSummary?.by_user || []).forEach((row) => {
      map[row.user_id] = row;
    });
    return map;
  }, [cpProductSummary]);

  const filteredUsers = cpUsers.filter(
    (u) =>
      !search ||
      u.user_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.user_id_code?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <section className="p-2 p-sm-3">
      <section className="row g-2 g-md-3 mb-3">
        <section className="col-12 col-md-4">
          <section className="card p-3 border-0 bg-primary bg-opacity-10 position-relative">
            <div className="d-flex justify-content-between align-items-center mb-1">
              <small className="text-muted text-uppercase">Total Product Deduction</small>
              <button
                className="btn btn-sm btn-link text-primary p-0 text-decoration-none shadow-none"
                onClick={() => setShowManualProductCharge(true)}
              >
                <i className="fa-solid fa-pen-to-square me-1" />
                Edit
              </button>
            </div>
            <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
              {money(cpProductSummary?.total_product_deduction)}
              {isOverridden && (
                <span className="badge bg-warning text-dark border fw-normal" style={{ fontSize: '0.65rem' }}>
                  Manual Override
                </span>
              )}
            </h4>
            <small className="text-muted mt-1">Will be deducted from partner commission</small>
          </section>
        </section>
        <section className="col-12 col-md-8">
          <section className="card p-3 h-100">
            <small className="text-muted d-block mb-2">Top Products (this month)</small>
            {(cpProductSummary?.by_product || []).length === 0 ? (
              manualProductChargeForm?.note && manualProductChargeForm.note.startsWith("Excel Import:") ? (
                <section className="d-flex flex-wrap gap-2">
                  {manualProductChargeForm.note
                    .replace("Excel Import: ", "")
                    .split(",")
                    .map((item, idx) => (
                      <span key={idx} className="badge bg-light text-dark border fw-normal">
                        {item.trim()}
                      </span>
                    ))}
                </section>
              ) : (
                <span className="text-muted small">No products assigned yet</span>
              )
            ) : (
              <section className="d-flex flex-wrap gap-2">
                {cpProductSummary.by_product.slice(0, 6).map((p) => (
                  <span
                    key={p.id}
                    className="badge bg-light text-dark border"
                    title={p.product_code}
                  >
                    {p.name}: {money(p.total_amount)}
                  </span>
                ))}
              </section>
            )}
          </section>
        </section>
      </section>

      <section className="rp-toolbar mb-3">
        <section className="d-flex flex-wrap gap-2 align-items-center flex-grow-1">
          <input
            type="search"
            className="form-control form-control-sm"
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 220 }}
          />
        </section>
        <section className="rp-toolbar-actions d-flex flex-wrap gap-2 align-items-center">
          <button
            type="button"
            className="btn btn-sm btn-success text-white rounded-pill px-3"
            onClick={() =>
              import("../../../utils/excelGenerator").then((m) =>
                m.downloadProductImportSample(),
              )
            }
          >
            <i className="fas fa-download me-1" />
            Sample
          </button>

          {/* Visible file input for catalog import */}
          <div className="d-flex align-items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              style={{ display: 'none' }}
              onChange={handleFileChange}
              disabled={importingCatalog}
              id="catalog-import-file-input"
            />
            <label
              htmlFor="catalog-import-file-input"
              className={`btn btn-sm btn-outline-secondary rounded-pill px-3 mb-0 ${importingCatalog ? 'disabled' : ''}`}
              style={{ cursor: importingCatalog ? 'not-allowed' : 'pointer' }}
            >
              <i className="fas fa-folder-open me-1" />
              {selectedFile ? (
                <span className="text-success fw-bold" title={selectedFile.name}>
                  {selectedFile.name.length > 15 ? selectedFile.name.slice(0, 12) + '...' : selectedFile.name}
                </span>
              ) : 'Choose file'}
            </label>
            <button
              type="button"
              className="btn btn-sm btn-outline-success rounded-pill px-3"
              onClick={() => {
                if (!selectedFile) {
                  fileInputRef.current?.click();
                } else {
                  onImportCatalog(selectedFile);
                  setTimeout(() => {
                    setSelectedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }, 400);
                }
              }}
              disabled={importingCatalog}
            >
              <i className="fas fa-file-excel me-1" />
              {importingCatalog ? (
                <><span className="spinner-border spinner-border-sm me-1" role="status" />Importing...</>
              ) : selectedFile ? 'Import' : 'Import Catalog'}
            </button>
          </div>
        </section>
      </section>

      <section className="d-flex align-items-center gap-2 mb-2 px-1">
        {Array.isArray(cpProductCatalog) && cpProductCatalog.length > 0 ? (
          <span className="badge bg-secondary bg-opacity-10 text-secondary border fw-normal">
            <i className="fas fa-box me-1" />
            Catalog: {cpProductCatalog.length} products
          </span>
        ) : (
          <span className="badge bg-warning bg-opacity-10 text-warning border fw-normal">
            <i className="fas fa-exclamation-triangle me-1" />
            No products in catalog
          </span>
        )}
        {importingCatalog && (
          <small className="text-muted">
            <span className="spinner-border spinner-border-sm me-1" role="status" />
            Importing...
          </small>
        )}
      </section>

      {lastImportResult && (
        <section className="alert alert-success py-2 small mb-3 d-flex align-items-center justify-content-between">
          <span>
            <i className="fas fa-check-circle me-1" />
            {lastImportResult.type === "partner_total" ? (
              `Product charge imported! Total product deduction: ${money(lastImportResult.amount)} ৳ (Catalog: ${lastImportResult.created} new, ${lastImportResult.updated} updated)`
            ) : (
              <>
                Catalog import successful! {lastImportResult.created} new, {lastImportResult.updated} updated
                {lastImportResult.skipped > 0 && `, ${lastImportResult.skipped} skipped`}
                {lastImportResult.created > 0 && (
                  <span className="ms-3">— now click the &quot;<strong>Product</strong>&quot; button on a user to assign</span>
                )}
              </>
            )}
          </span>
          <button
            type="button"
            className="btn-close btn-close-sm shadow-none"
            onClick={onClearImportResult}
            aria-label="Close"
          />
        </section>
      )}

      <section className="rp-table-wrap">
        <table className="table table-hover table-sm align-middle mb-0">
          <thead className="table-light">
            <tr>
              <th>User</th>
              <th>ID</th>
              <th className="d-none d-md-table-cell">Products</th>
              <th>Total Charge</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filteredUsers.length === 0 ? (
              <tr>
                <td colSpan="5" className="text-center text-muted py-4">
                  No users
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => {
                const t = userTotals[u.id];
                return (
                  <tr key={u.id}>
                    <td className="fw-bold">{u.user_name}</td>
                    <td>
                      <span className="badge bg-light text-dark border">
                        {u.user_id_code || "-"}
                      </span>
                    </td>
                    <td className="d-none d-md-table-cell">
                      {Number(t?.product_count || 0).toLocaleString("en-US")}
                    </td>
                    <td className="fw-bold text-danger">
                      {money(t?.total_amount || 0)}
                    </td>
                    <td className="text-end">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary rounded-pill"
                        onClick={() => onEditUserProducts(u)}
                      >
                        <i className="fas fa-box me-1" />
                        Product
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </section>
      {/* Manual Product Charge Modal */}
      {showManualProductCharge && (
        <ModalWrap title="Manual Product Charge" onClose={() => setShowManualProductCharge(false)} size="sm">
          <form onSubmit={handleSaveManualProductCharge}>
            <div className="mb-3">
              <label className="form-label text-muted small fw-medium">Total Product Charge (Tk)</label>
              <input type="number" step="0.01" className="form-control shadow-none" placeholder="e.g. 2500" value={manualProductChargeForm.amount} onChange={(e) => setManualProductChargeForm({ ...manualProductChargeForm, amount: e.target.value })} />
              <small className="text-muted d-block mt-1">{isOverridden ? 'Leave empty to return to auto-calculation.' : 'Entering an amount will override the total from user products.'}</small>
            </div>
            <div className="mb-3">
              <label className="form-label text-muted small fw-medium">Note (optional)</label>
              <input type="text" className="form-control shadow-none" placeholder="e.g. extra cable charge..." value={manualProductChargeForm.note} onChange={(e) => setManualProductChargeForm({ ...manualProductChargeForm, note: e.target.value })} />
            </div>
            <div className="d-flex justify-content-end gap-2">
              <button type="button" className="btn btn-light border rounded-pill px-4" onClick={() => setShowManualProductCharge(false)} disabled={manualProductChargeLoading}>Cancel</button>
              <button type="submit" className="btn btn-primary rounded-pill px-4 fw-bold" disabled={manualProductChargeLoading}>
                {manualProductChargeLoading ? <><span className="spinner-border spinner-border-sm me-1" />Saving...</> : 'Save'}
              </button>
            </div>
          </form>
        </ModalWrap>
      )}
    </section>
  );
};

export default ProductsTab;
