import React, { useState, useEffect, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import BrandLogo from '../components/BrandLogo';
import { getAssetMasters } from '../services/assetService';
import { createPurchaseOrder } from '../services/procurementService';
import { getDhakaDateYmd, money, fmtDate } from '../utils/formatters';
import '../styles/CreatePO.css';

const DEFAULT_LINE_ITEM = {
  item_name: '',
  description: '',
  quantity: 1,
  unit_price: 0
};

const CreatePO = () => {
  const [loading, setLoading] = useState(false);
  const [vendors, setVendors] = useState([]);
  const [vendorSearch, setVendorSearch] = useState('');
  const [errors, setErrors] = useState({});

  const [formData, setFormData] = useState({
    vendor_id: '',
    order_date: getDhakaDateYmd(),
    expected_delivery_date: '',
    notes: '',
    items: [{ ...DEFAULT_LINE_ITEM }]
  });

  useEffect(() => {
    let isMounted = true;
    const loadVendors = async () => {
      try {
        const data = await getAssetMasters();
        if (isMounted) {
          setVendors(data.vendors || []);
        }
      } catch (err) {
        toast.error('Could not load vendor list');
      }
    };
    loadVendors();
    return () => {
      isMounted = false;
    };
  }, []);

  // Filter vendors based on name or phone
  const filteredVendors = useMemo(() => {
    const term = vendorSearch.trim().toLowerCase();
    if (!term) return vendors;
    return vendors.filter((v) =>
      `${v.name || ''} ${v.phone || ''} ${v.contact_person || ''}`.toLowerCase().includes(term)
    );
  }, [vendors, vendorSearch]);

  const selectedVendor = useMemo(
    () => vendors.find((v) => String(v.id) === String(formData.vendor_id)),
    [vendors, formData.vendor_id]
  );

  const getSubtotal = (item) => (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);

  const grandTotal = useMemo(
    () => formData.items.reduce((sum, item) => sum + getSubtotal(item), 0),
    [formData.items]
  );

  const totalQuantity = useMemo(
    () => formData.items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0),
    [formData.items]
  );

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  };

  const handleItemChange = (index, field, value) => {
    setFormData((prev) => {
      const items = [...prev.items];
      items[index] = { ...items[index], [field]: value };
      return { ...prev, items };
    });
    setErrors((prev) => ({ ...prev, [`item_${index}_${field}`]: undefined }));
  };

  const handleAddItem = () => {
    setFormData((prev) => ({
      ...prev,
      items: [...prev.items, { ...DEFAULT_LINE_ITEM }]
    }));
  };

  const handleRemoveItem = (index) => {
    if (formData.items.length <= 1) {
      toast.error('At least one item is required');
      return;
    }
    setFormData((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== index)
    }));
  };

  const validateForm = () => {
    const errs = {};
    if (!formData.vendor_id) {
      errs.vendor_id = 'Select a vendor';
    }
    if (!formData.order_date) {
      errs.order_date = 'Provide the order date';
    }

    formData.items.forEach((it, idx) => {
      if (!String(it.item_name || '').trim()) {
        errs[`item_${idx}_name`] = 'Item name is required';
      }
      if (!(Number(it.quantity) > 0)) {
        errs[`item_${idx}_qty`] = 'Quantity must be 1 or more';
      }
      if (Number(it.unit_price) < 0 || isNaN(Number(it.unit_price))) {
        errs[`item_${idx}_price`] = 'Price must be 0 or more';
      }
    });

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      toast.error('Please fix the errors highlighted in the form');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        vendor_id: Number(formData.vendor_id),
        order_date: formData.order_date,
        expected_delivery_date: formData.expected_delivery_date || null,
        notes: formData.notes?.trim() || null,
        items: formData.items.map((it) => ({
          item_name: String(it.item_name).trim(),
          description: String(it.description || '').trim(),
          quantity: Number(it.quantity),
          unit_price: Number(it.unit_price)
        }))
      };

      await createPurchaseOrder(payload);
      toast.success('Purchase order created successfully!');
      // Reset form to default blank slate
      setFormData({
        vendor_id: '',
        order_date: getDhakaDateYmd(),
        expected_delivery_date: '',
        notes: '',
        items: [{ ...DEFAULT_LINE_ITEM }]
      });
      setVendorSearch('');
      setErrors({});
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create purchase order');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="po-page-container">
      {/* Top Bar Header */}
      <div className="po-top-bar">
        <div className="po-top-bar-left">
          <div className="po-top-icon">
            <i className="fa-solid fa-file-invoice-dollar"></i>
          </div>
          <div className="po-title-block">
            <h1>Purchase Order Generator</h1>
            <div className="po-subtitle">
              <span>Speed Net Khulna</span>
              <span>•</span>
              <span>Procurement &amp; Inventory Management</span>
            </div>
          </div>
        </div>

        <div className="po-top-bar-actions">
          <button
            type="button"
            onClick={handlePrint}
            className="btn btn-outline-secondary d-inline-flex align-items-center gap-2"
          >
            <i className="fa-solid fa-print"></i>
            <span>Print Draft</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setFormData({
                vendor_id: '',
                order_date: getDhakaDateYmd(),
                expected_delivery_date: '',
                notes: '',
                items: [{ ...DEFAULT_LINE_ITEM }]
              });
              setVendorSearch('');
              setErrors({});
            }}
            className="btn btn-outline-danger d-inline-flex align-items-center gap-2"
          >
            <i className="fa-solid fa-rotate-left"></i>
            <span>Reset Form</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Summary Tiles */}
      <div className="po-stats-grid">
        <div className="po-stat-card">
          <div className="po-stat-icon-wrap po-stat-icon-blue">
            <i className="fa-solid fa-truck-ramp-box"></i>
          </div>
          <div className="po-stat-info">
            <div className="po-stat-label">Selected Vendor</div>
            <div className="po-stat-val text-truncate" style={{ maxWidth: '180px' }}>
              {selectedVendor?.name || 'None Selected'}
            </div>
          </div>
        </div>

        <div className="po-stat-card">
          <div className="po-stat-icon-wrap po-stat-icon-emerald">
            <i className="fa-solid fa-boxes-packing"></i>
          </div>
          <div className="po-stat-info">
            <div className="po-stat-label">Total Quantity</div>
            <div className="po-stat-val">
              {totalQuantity} <small style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>pcs ({formData.items.length} items)</small>
            </div>
          </div>
        </div>

        <div className="po-stat-card">
          <div className="po-stat-icon-wrap po-stat-icon-indigo">
            <i className="fa-solid fa-receipt"></i>
          </div>
          <div className="po-stat-info">
            <div className="po-stat-label">Estimated Grand Total</div>
            <div className="po-stat-val" style={{ color: 'var(--brand-strong)' }}>
              {money(grandTotal)}
            </div>
          </div>
        </div>

        <div className="po-stat-card">
          <div className="po-stat-icon-wrap po-stat-icon-amber">
            <i className="fa-regular fa-calendar-check"></i>
          </div>
          <div className="po-stat-info">
            <div className="po-stat-label">Order Date</div>
            <div className="po-stat-val">
              {fmtDate(formData.order_date) || '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Main Form & Live Sheet Workspace */}
      <div className="po-main-grid">
        {/* Left: Input Form */}
        <form onSubmit={handleSubmit} className="po-form-card">
          <div className="po-card-header">
            <h2>
              <i className="fa-solid fa-pen-to-square text-primary"></i>
              <span>Purchase Order Details</span>
            </h2>
            <span className="badge bg-primary-subtle text-primary border border-primary-subtle px-2 py-1">
              Official Entry
            </span>
          </div>

          <div className="po-card-body">
            {/* 1. Vendor & Schedule */}
            <div>
              <div className="po-section-heading">
                <i className="fa-solid fa-store"></i>
                <span>Vendor &amp; Delivery Schedule</span>
              </div>

              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <div className="po-field-group">
                    <label>
                      Vendor <span className="req">*</span>
                    </label>
                    <input
                      type="text"
                      className="po-input mb-1"
                      placeholder="Search vendor name or contact..."
                      value={vendorSearch}
                      onChange={(e) => setVendorSearch(e.target.value)}
                    />
                    <select
                      name="vendor_id"
                      value={formData.vendor_id}
                      onChange={handleInputChange}
                      className={`po-select ${errors.vendor_id ? 'has-error' : ''}`}
                    >
                      <option value="">-- Choose Vendor ({filteredVendors.length}) --</option>
                      {filteredVendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name} {v.phone ? `(${v.phone})` : ''}
                        </option>
                      ))}
                    </select>
                    {errors.vendor_id && <div className="po-error-msg">{errors.vendor_id}</div>}

                    {selectedVendor && (
                      <div className="p-2 mt-2 rounded bg-light border text-muted small">
                        <strong className="text-dark">{selectedVendor.name}</strong>
                        {selectedVendor.phone && <span> • 📞 {selectedVendor.phone}</span>}
                        {selectedVendor.address && <div>📍 {selectedVendor.address}</div>}
                      </div>
                    )}
                  </div>
                </div>

                <div className="col-12 col-md-6">
                  <div className="po-field-group mb-3">
                    <label>
                      Order Date <span className="req">*</span>
                    </label>
                    <input
                      type="date"
                      name="order_date"
                      value={formData.order_date}
                      onChange={handleInputChange}
                      className={`po-input ${errors.order_date ? 'has-error' : ''}`}
                    />
                    {errors.order_date && <div className="po-error-msg">{errors.order_date}</div>}
                  </div>

                  <div className="po-field-group">
                    <label>Expected Delivery Date</label>
                    <input
                      type="date"
                      name="expected_delivery_date"
                      value={formData.expected_delivery_date}
                      onChange={handleInputChange}
                      className="po-input"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Line Items */}
            <div>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <div className="po-section-heading mb-0">
                  <i className="fa-solid fa-list-ol"></i>
                  <span>Line Items ({formData.items.length})</span>
                </div>
                <button
                  type="button"
                  onClick={handleAddItem}
                  className="po-btn-add-item"
                >
                  <i className="fa-solid fa-plus"></i>
                  <span>Add Line Item</span>
                </button>
              </div>

              <div className="d-flex flex-column gap-3">
                {formData.items.map((item, idx) => {
                  const subtotal = getSubtotal(item);
                  return (
                    <div key={idx} className="po-item-row">
                      <div className="po-item-header">
                        <span className="po-item-badge">
                          <i className="fa-solid fa-tag"></i> Item #{idx + 1}
                        </span>
                        <div className="d-flex align-items-center gap-3">
                          <span className="po-item-subtotal">
                            Subtotal: <span className="text-primary">{money(subtotal)}</span>
                          </span>
                          {formData.items.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveItem(idx)}
                              className="po-del-btn"
                              title="Delete Item"
                            >
                              <i className="fa-solid fa-trash-can"></i>
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="row g-2">
                        <div className="col-12 col-md-6">
                          <div className="po-field-group">
                            <label>Item Name <span className="req">*</span></label>
                            <input
                              type="text"
                              placeholder="e.g. ONU Device / Cat6 Cable / Router"
                              value={item.item_name}
                              onChange={(e) => handleItemChange(idx, 'item_name', e.target.value)}
                              className={`po-input ${errors[`item_${idx}_name`] ? 'has-error' : ''}`}
                            />
                            {errors[`item_${idx}_name`] && (
                              <div className="po-error-msg">{errors[`item_${idx}_name`]}</div>
                            )}
                          </div>
                          <div className="po-field-group mt-2">
                            <input
                              type="text"
                              placeholder="Specification or model details (optional)"
                              value={item.description}
                              onChange={(e) => handleItemChange(idx, 'description', e.target.value)}
                              className="po-input text-muted"
                              style={{ fontSize: '0.82rem', padding: '0.4rem 0.75rem' }}
                            />
                          </div>
                        </div>

                        <div className="col-6 col-md-3">
                          <div className="po-field-group">
                            <label>Quantity <span className="req">*</span></label>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={item.quantity}
                              onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                              className={`po-input ${errors[`item_${idx}_qty`] ? 'has-error' : ''}`}
                            />
                            {errors[`item_${idx}_qty`] && (
                              <div className="po-error-msg">{errors[`item_${idx}_qty`]}</div>
                            )}
                          </div>
                        </div>

                        <div className="col-6 col-md-3">
                          <div className="po-field-group">
                            <label>Unit Price (Tk) <span className="req">*</span></label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.unit_price}
                              onChange={(e) => handleItemChange(idx, 'unit_price', e.target.value)}
                              className={`po-input text-end ${errors[`item_${idx}_price`] ? 'has-error' : ''}`}
                            />
                            {errors[`item_${idx}_price`] && (
                              <div className="po-error-msg">{errors[`item_${idx}_price`]}</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 3. Notes / Terms */}
            <div>
              <div className="po-section-heading">
                <i className="fa-solid fa-clipboard-check"></i>
                <span>Remarks &amp; Procurement Terms</span>
              </div>
              <textarea
                name="notes"
                rows={3}
                placeholder="Enter delivery instructions, billing conditions, or payment agreements..."
                value={formData.notes}
                onChange={handleInputChange}
                className="po-textarea"
              />
            </div>
          </div>

          {/* Form Footer */}
          <div className="po-form-footer">
            <div className="po-total-display">
              <div className="po-total-label">Total Payable</div>
              <div className="po-total-amount">{money(grandTotal)}</div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="po-submit-btn"
            >
              {loading ? (
                <>
                  <i className="fa-solid fa-spinner fa-spin"></i>
                  <span>Submitting...</span>
                </>
              ) : (
                <>
                  <i className="fa-solid fa-circle-check"></i>
                  <span>Create Purchase Order</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Right: Live A4 Official Document Preview */}
        <div className="po-preview-sticky">
          <div className="po-preview-top-hint">
            <span className="small text-uppercase fw-bold text-muted d-flex align-items-center gap-2">
              <i className="fa-regular fa-file-pdf text-primary"></i>
              Official Document Preview (A4)
            </span>
            <span className="badge bg-success-subtle text-success border border-success-subtle">
              Live Preview
            </span>
          </div>

          <div className="po-a4-sheet">
            {/* Watermark */}
            <div className="po-watermark">
              DRAFT PO
            </div>

            {/* Official Speed Net Header */}
            <div className="po-sheet-header">
              <div className="po-sheet-brand">
                <BrandLogo className="po-sheet-logo" alt="Speed Net Khulna" />
                <div>
                  <h3 className="po-company-name">Speed Net Khulna</h3>
                  <div className="po-company-tagline">Internet Service Provider (ISP)</div>
                </div>
              </div>

              <div className="po-sheet-doc-meta">
                <span className="po-doc-title-badge">Purchase Order</span>
                <div className="po-ref-code">
                  REF: PO-DRAFT-{formData.order_date.replace(/-/g, '')}
                </div>
              </div>
            </div>

            {/* Address Strip */}
            <div className="po-company-contact-strip">
              <span><strong>Head Office:</strong> 83/3, Gagan Babu Road, Khulna</span>
              <span>📞 +880 1910365577 | ✉️ billing@speednetkhulna.com</span>
            </div>

            {/* Vendor & Order Details */}
            <div className="po-meta-grid">
              <div>
                <div className="po-meta-box-title">Vendor / Supplier Details:</div>
                <div className="po-vendor-name-lead">
                  {selectedVendor?.name || '—'}
                </div>
                {selectedVendor?.phone && (
                  <div className="po-vendor-detail">Phone: {selectedVendor.phone}</div>
                )}
                {selectedVendor?.address && (
                  <div className="po-vendor-detail">Address: {selectedVendor.address}</div>
                )}
              </div>

              <div>
                <div className="po-meta-box-title">Order Information:</div>
                <div className="po-meta-row">
                  <span className="po-meta-label">Order Date:</span>
                  <span className="po-meta-val">{fmtDate(formData.order_date)}</span>
                </div>
                <div className="po-meta-row">
                  <span className="po-meta-label">Delivery Date:</span>
                  <span className="po-meta-val">
                    {formData.expected_delivery_date ? fmtDate(formData.expected_delivery_date) : 'Standard / Open'}
                  </span>
                </div>
                <div className="po-meta-row">
                  <span className="po-meta-label">Approval Status:</span>
                  <span className="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle">
                    Pending
                  </span>
                </div>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="po-sheet-table-wrap">
              <table className="po-sheet-table">
                <thead>
                  <tr>
                    <th style={{ width: '35px' }}>SL</th>
                    <th>Item Description</th>
                    <th className="text-center" style={{ width: '70px' }}>Qty</th>
                    <th className="text-end" style={{ width: '100px' }}>Rate (Tk)</th>
                    <th className="text-end" style={{ width: '110px' }}>Total (Tk)</th>
                  </tr>
                </thead>
                <tbody>
                  {formData.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="text-muted fw-bold">{idx + 1}</td>
                      <td>
                        <div className="fw-bold text-dark">{it.item_name || '—'}</div>
                        {it.description && (
                          <div className="text-muted" style={{ fontSize: '0.74rem' }}>{it.description}</div>
                        )}
                      </td>
                      <td className="text-center fw-semibold">{it.quantity}</td>
                      <td className="text-end text-muted">{Number(it.unit_price || 0).toLocaleString()}</td>
                      <td className="text-end fw-bold text-dark">
                        {getSubtotal(it).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan="4" className="text-end">Grand Total:</td>
                    <td className="text-end text-primary fw-bolder">
                      ৳{grandTotal.toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Notes Section */}
            {formData.notes && (
              <div className="po-sheet-notes">
                <strong>Terms &amp; Instructions:</strong>
                <div>{formData.notes}</div>
              </div>
            )}

            {/* Signatures */}
            <div className="po-signatures-grid">
              <div>
                <div className="po-sig-line">Prepared By (Procurement)</div>
              </div>
              <div>
                <div className="po-sig-line">Authorized Signatory</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreatePO;
