import React, { useEffect, useState, useMemo } from "react";
import ModalWrap from "../ModalWrap";
import { money } from "../../../utils/formatters";

const UserProductsModal = ({
  user,
  month,
  catalog,
  initialUsage,
  onSave,
  onClose,
  saving,
}) => {
  const [qtyByProduct, setQtyByProduct] = useState({});
  const [search, setSearch] = useState("");

  useEffect(() => {
    const map = {};
    (initialUsage || []).forEach((u) => {
      map[u.product_id] = Number(u.quantity || 0);
    });
    setQtyByProduct(map);
    setSearch("");
  }, [initialUsage, user?.id]);

  const lineTotal = useMemo(() => {
    return (catalog || []).reduce((sum, p) => {
      const qty = Number(qtyByProduct[p.id] || 0);
      if (qty <= 0) return sum;
      return sum + qty * Number(p.unit_price || 0);
    }, 0);
  }, [catalog, qtyByProduct]);

  const filteredCatalog = useMemo(() => {
    if (!search) return catalog || [];
    const q = search.toLowerCase();
    return (catalog || []).filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.product_code?.toLowerCase().includes(q),
    );
  }, [catalog, search]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const items = (catalog || [])
      .map((p) => ({
        product_id: p.id,
        quantity: Number(qtyByProduct[p.id] || 0),
      }))
      .filter((i) => i.quantity > 0);
    onSave({ month, items });
  };

  const hasCatalog = (catalog || []).length > 0;
  const isFiltered = filteredCatalog.length !== (catalog || []).length;

  return (
    <ModalWrap
      title={`Products — ${user?.user_name || ""} (${month})`}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="d-flex flex-column" style={{ maxHeight: "80vh" }}>
        <section className="alert alert-info py-2 small mb-2">
          Total Product Charge: <strong>{money(lineTotal)}</strong> — this amount
          will be deducted from the partner&apos;s monthly commission.
        </section>
        {!hasCatalog ? (
          <section className="alert alert-warning py-2 small mb-0">
            No product catalog. First import Excel from the Products tab.
          </section>
        ) : (
          <>
            <section className="mb-2">
              <input
                type="search"
                className="form-control form-control-sm"
                placeholder="Search products..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </section>
            <section className="table-responsive" style={{ maxHeight: 360, overflowY: "auto" }}>
              <table className="table table-sm align-middle mb-0">
                <thead className="table-light" style={{ position: "sticky", top: 0, zIndex: 1 }}>
                  <tr>
                    <th>Product</th>
                    <th>Price</th>
                    <th style={{ width: 100 }}>Qty</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCatalog.length === 0 ? (
                    <tr>
                      <td colSpan="4" className="text-center text-muted py-3">
                        {isFiltered ? "No matching products" : "No products"}
                      </td>
                    </tr>
                  ) : (
                    filteredCatalog.map((p) => {
                      const qty = Number(qtyByProduct[p.id] || 0);
                      return (
                        <tr key={p.id}>
                          <td>
                            <section className="fw-semibold">{p.name}</section>
                            <small className="text-muted">{p.product_code}</small>
                          </td>
                          <td>{money(p.unit_price)}</td>
                          <td>
                            <input
                              type="number"
                              min="0"
                              step="1"
                              className="form-control form-control-sm"
                              value={qty || ""}
                              onChange={(e) =>
                                setQtyByProduct({
                                  ...qtyByProduct,
                                  [p.id]: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="fw-bold">
                            {money(qty * Number(p.unit_price || 0))}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}
        <section className="d-flex align-items-center justify-content-between mt-3 pt-3 border-top bg-white py-2">
          <span className="fw-bold">
            Total: <span className="text-primary">{money(lineTotal)}</span>
          </span>
          <section>
            <button
              type="button"
              className="btn btn-light border rounded-pill me-2"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary rounded-pill px-4"
              disabled={saving || !hasCatalog}
            >
              {saving ? "Saving..." : "Save"}
            </button>
          </section>
        </section>
      </form>
    </ModalWrap>
  );
};

export default UserProductsModal;
