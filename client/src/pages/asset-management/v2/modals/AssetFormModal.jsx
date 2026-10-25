import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';

const CATEGORY_PREFIXES = {
  'pc': 'PC',
  'monitor': 'MON',
  'ups': 'UPS',
  'router': 'RTR',
  'switch': 'SW',
  'printer': 'PRN',
  'accessory': 'ACC',
};

const MAX_LENGTHS = {
  asset_tag: 80,
  asset_name: 180,
  brand: 120,
  model: 160,
  serial_number: 160,
  warranty_type: 60,
};

const SearchableSelect = ({ options, value, onChange, placeholder, labelKey, valueKey, idKey }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef(null);
  const inputRef = useRef(null);

  const selected = useMemo(() => options.find(o => String(o[valueKey]) === String(value)), [options, value, valueKey]);
  const display = selected ? selected[labelKey] : '';

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter(o => String(o[labelKey]).toLowerCase().includes(q));
  }, [options, search, labelKey]);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="searchable-select" ref={ref}>
      <input
        ref={inputRef}
        type="text"
        className="form-control form-control-sm"
        value={open ? search : display}
        onFocus={() => { setOpen(true); setSearch(''); }}
        onChange={e => { setSearch(e.target.value); setOpen(true); }}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (
        <div className="searchable-select-dropdown">
          {filtered.length === 0 && (
            <div className="searchable-select-option text-muted">No matches</div>
          )}
          {filtered.map(o => (
            <div
              key={o[idKey || valueKey]}
              className={`searchable-select-option ${String(o[valueKey]) === String(value) ? 'active' : ''}`}
              onMouseDown={() => { onChange(o[valueKey]); setOpen(false); }}
            >
              {o[labelKey]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const AssetFormModal = ({ asset, onClose, onSubmit, offices, categories, vendors, users, desks, submitting }) => {
  const [form, setForm] = useState({
    asset_tag: '',
    asset_name: '',
    category_id: '',
    vendor_id: '',
    office_id: '',
    desk_id: '',
    assigned_user_id: '',
    brand: '',
    model: '',
    serial_number: '',
    purchase_date: '',
    purchase_price: '',
    warranty_start_date: '',
    warranty_end_date: '',
    warranty_type: '',
    status: 'in_stock',
    condition: 'good',
    notes: '',
  });

  const initialFormRef = useRef(null);
  const [filteredDesks, setFilteredDesks] = useState([]);
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [keepOpen, setKeepOpen] = useState(false);
  const [assignedFromDesk, setAssignedFromDesk] = useState(false);
  const modalRef = useRef(null);
  const firstFieldRef = useRef(null);

  if (!initialFormRef.current) {
    initialFormRef.current = { ...form };
  }

  const isDirty = useMemo(() => {
    if (!initialFormRef.current) return false;
    return Object.keys(form).some(k => String(form[k] || '') !== String(initialFormRef.current[k] || ''));
  }, [form]);

  const handleClose = useCallback(() => {
    if (isDirty && !window.confirm('You have unsaved changes. Are you sure you want to close?')) return;
    onClose();
  }, [isDirty, onClose]);

  const handleOverlayClick = useCallback((e) => {
    if (e.target === e.currentTarget) handleClose();
  }, [handleClose]);

  useEffect(() => {
    if (asset) {
      const vals = {
        asset_tag: asset.asset_tag || '',
        asset_name: asset.asset_name || '',
        category_id: asset.category_id || '',
        vendor_id: asset.vendor_id || '',
        office_id: asset.office_id || '',
        desk_id: asset.desk_id || '',
        assigned_user_id: asset.assigned_user_id || '',
        brand: asset.brand || '',
        model: asset.model || '',
        serial_number: asset.serial_number || '',
        purchase_date: asset.purchase_date || '',
        purchase_price: asset.purchase_price || '',
        warranty_start_date: asset.warranty_start_date || '',
        warranty_end_date: asset.warranty_end_date || '',
        warranty_type: asset.warranty_type || '',
        status: asset.status || 'in_stock',
        condition: asset.condition || 'good',
        notes: asset.notes || '',
      };
      setForm(vals);
      initialFormRef.current = { ...vals };
    } else {
      const vals = {
        asset_tag: '',
        asset_name: '',
        category_id: '',
        vendor_id: '',
        office_id: '',
        desk_id: '',
        assigned_user_id: '',
        brand: '',
        model: '',
        serial_number: '',
        purchase_date: '',
        purchase_price: '',
        warranty_start_date: '',
        warranty_end_date: '',
        warranty_type: '',
        status: 'in_stock',
        condition: 'good',
        notes: '',
      };
      setForm(vals);
      initialFormRef.current = { ...vals };
    }
    setErrors({});
    setTouched({});
  }, [asset]);

  useEffect(() => {
    if (form.office_id) {
      const filtered = (desks || []).filter(d => String(d.office_id) === String(form.office_id));
      setFilteredDesks(filtered);
    } else {
      setFilteredDesks([]);
    }
  }, [form.office_id, desks]);

  const handleChange = (field, value) => {
    setTouched(prev => ({ ...prev, [field]: true }));

    if (field === 'office_id') {
      setForm(prev => ({ ...prev, [field]: value, desk_id: '' }));
      setAssignedFromDesk(false);
      return;
    }

    if (field === 'desk_id') {
      const selectedDesk = (desks || []).find(d => String(d.id) === String(value));
      const occupantId = selectedDesk?.assigned_user_id || '';
      setForm(prev => ({
        ...prev,
        desk_id: value,
        assigned_user_id: occupantId || prev.assigned_user_id,
      }));
      setAssignedFromDesk(Boolean(occupantId));
      return;
    }

    if (field === 'assigned_user_id' && assignedFromDesk) {
      setAssignedFromDesk(false);
    }

    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
    }
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleClose]);

  useEffect(() => {
    if (firstFieldRef.current) {
      firstFieldRef.current.focus();
    }
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  const validate = useCallback(() => {
    const errs = {};

    if (!form.asset_tag.trim()) {
      errs.asset_tag = 'Asset tag is required';
    } else if (form.asset_tag.length > MAX_LENGTHS.asset_tag) {
      errs.asset_tag = `Max ${MAX_LENGTHS.asset_tag} characters`;
    }

    if (!form.asset_name.trim()) {
      errs.asset_name = 'Asset name is required';
    } else if (form.asset_name.length > MAX_LENGTHS.asset_name) {
      errs.asset_name = `Max ${MAX_LENGTHS.asset_name} characters`;
    }

    if (form.brand && form.brand.length > MAX_LENGTHS.brand) {
      errs.brand = `Max ${MAX_LENGTHS.brand} characters`;
    }
    if (form.model && form.model.length > MAX_LENGTHS.model) {
      errs.model = `Max ${MAX_LENGTHS.model} characters`;
    }
    if (form.serial_number && form.serial_number.length > MAX_LENGTHS.serial_number) {
      errs.serial_number = `Max ${MAX_LENGTHS.serial_number} characters`;
    }
    if (form.warranty_type && form.warranty_type.length > MAX_LENGTHS.warranty_type) {
      errs.warranty_type = `Max ${MAX_LENGTHS.warranty_type} characters`;
    }

    if (form.purchase_price && Number(form.purchase_price) < 0) {
      errs.purchase_price = 'Price cannot be negative';
    }

    if (form.warranty_start_date && form.warranty_end_date) {
      if (new Date(form.warranty_end_date) < new Date(form.warranty_start_date)) {
        errs.warranty_end_date = 'Warranty end must be after start date';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [form]);

  const generateTag = () => {
    const catId = form.category_id;
    let prefix = 'AST';
    if (catId) {
      const cat = (categories || []).find(c => String(c.id) === String(catId));
      if (cat) {
        const slug = (cat.slug || cat.name || '').toLowerCase();
        prefix = CATEGORY_PREFIXES[slug] || slug.slice(0, 3).toUpperCase();
      }
    }
    const ts = Date.now().toString(36).toUpperCase();
    const tag = `${prefix}-${ts}`;
    handleChange('asset_tag', tag);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const allKeys = Object.keys(form);
    setTouched(allKeys.reduce((acc, k) => ({ ...acc, [k]: true }), {}));
    if (!validate()) return;
    try {
      await onSubmit(form, keepOpen);
      if (keepOpen && !asset) {
        const empty = {
          asset_tag: '', asset_name: '', category_id: '', vendor_id: '',
          office_id: '', desk_id: '', assigned_user_id: '',
          brand: '', model: '', serial_number: '',
          purchase_date: '', purchase_price: '',
          warranty_start_date: '', warranty_end_date: '', warranty_type: '',
          status: 'in_stock', condition: 'good', notes: '',
        };
        setForm(empty);
        initialFormRef.current = { ...empty };
        setErrors({});
        setTouched({});
        if (firstFieldRef.current) firstFieldRef.current.focus();
      }
    } catch (err) {
      const message = err?.response?.data?.message || err?.message || 'Failed to save asset';
      setErrors(prev => ({ ...prev, _general: message }));
    }
  };

  const showError = (field) => touched[field] && errors[field];

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div
        ref={modalRef}
        className="modal-dialog"
        style={{ maxWidth: '900px' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="modal-header">
          <h5 className="mb-0">{asset ? `Edit Asset: ${asset.asset_tag}` : 'Add New Asset'}</h5>
          <button type="button" className="btn-close" onClick={handleClose} disabled={submitting} />
        </div>
        <form onSubmit={handleSubmit} noValidate>
          <div className="modal-body">
            {errors._general && (
<div className="alert alert-danger py-2 small mb-3">{errors._general}</div>
            )}

            <div className="section-divider">
              <div className="section-title">Basic Information</div>
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label small text-muted">Asset Tag *</label>
                  <div className="input-group input-group-sm">
                    <input
                      ref={firstFieldRef}
                      type="text"
                      className={`form-control form-control-sm ${showError('asset_tag') ? 'is-invalid' : ''}`}
                      value={form.asset_tag}
                      onChange={e => handleChange('asset_tag', e.target.value)}
                      placeholder="SN-LAPTOP-001"
                      maxLength={MAX_LENGTHS.asset_tag}
                      required
                      disabled={submitting}
                    />
                    {!asset && (
                      <button type="button" className="btn btn-outline-secondary" onClick={generateTag} disabled={submitting} title="Generate tag">
                        <i className="fa-solid fa-wand-magic-sparkles" />
                      </button>
                    )}
                  </div>
                  {showError('asset_tag') && <div className="invalid-feedback d-block">{errors.asset_tag}</div>}
                </div>
                <div className="col-md-8">
                  <label className="form-label small text-muted">Asset Name *</label>
                  <input
                    type="text"
                    className={`form-control form-control-sm ${showError('asset_name') ? 'is-invalid' : ''}`}
                    value={form.asset_name}
                    onChange={e => handleChange('asset_name', e.target.value)}
                    placeholder="Dell XPS 15 Laptop"
                    maxLength={MAX_LENGTHS.asset_name}
                    required
                    disabled={submitting}
                  />
                  {showError('asset_name') && <div className="invalid-feedback d-block">{errors.asset_name}</div>}
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Category</label>
                  <select className="form-select form-select-sm" value={form.category_id} onChange={e => handleChange('category_id', e.target.value)} disabled={submitting}>
                    <option value="">Select</option>
                    {categories?.map(c => {
                      const parent = c.parent_id ? categories.find(p => String(p.id) === String(c.parent_id)) : null;
                      const label = parent ? `${parent.name} › ${c.name}` : c.name;
                      return <option key={c.id} value={c.id}>{label}</option>;
                    })}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Vendor</label>
                  <select className="form-select form-select-sm" value={form.vendor_id} onChange={e => handleChange('vendor_id', e.target.value)} disabled={submitting}>
                    <option value="">Select</option>
                    {vendors?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Status</label>
                  <select className="form-select form-select-sm" value={form.status} onChange={e => handleChange('status', e.target.value)} disabled={submitting}>
                    <option value="in_stock">In Stock</option>
                    <option value="active">Active</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="repair">Under Repair</option>
                    <option value="broken">Broken</option>
                    <option value="replaced">Replaced</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="section-divider">
              <div className="section-title">Location & Assignment</div>
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label small text-muted">Office</label>
                  <select className="form-select form-select-sm" value={form.office_id} onChange={e => handleChange('office_id', e.target.value)} disabled={submitting}>
                    <option value="">Select</option>
                    {offices?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Desk</label>
                  <select className="form-select form-select-sm" value={form.desk_id} onChange={e => handleChange('desk_id', e.target.value)} disabled={submitting}>
                    <option value="">Select</option>
                    {filteredDesks.map(d => {
                      const occupant = d.assigned_user_name || d.desk_label || '';
                      return (
                        <option key={d.id} value={d.id}>
                          Desk {d.desk_no}{occupant ? ` — ${occupant}` : ''}
                          {d.floor_label ? ` (${d.floor_label})` : ''}
                        </option>
                      );
                    })}
                  </select>
                  {form.office_id && filteredDesks.length === 0 && (
                    <div className="small text-muted mt-1">No desks in this office</div>
                  )}
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Assigned To</label>
                  <SearchableSelect
                    options={users || []}
                    value={form.assigned_user_id}
                    onChange={v => handleChange('assigned_user_id', v)}
                    placeholder="Search user..."
                    labelKey="full_name"
                    valueKey="id"
                    idKey="id"
                  />
                </div>
              </div>
            </div>

            <div className="section-divider">
              <div className="section-title">Hardware Details</div>
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label small text-muted">Brand</label>
                  <input
                    type="text"
                    className={`form-control form-control-sm ${showError('brand') ? 'is-invalid' : ''}`}
                    value={form.brand}
                    onChange={e => handleChange('brand', e.target.value)}
                    placeholder="Dell"
                    maxLength={MAX_LENGTHS.brand}
                    disabled={submitting}
                  />
                  {showError('brand') && <div className="invalid-feedback d-block">{errors.brand}</div>}
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Model</label>
                  <input
                    type="text"
                    className={`form-control form-control-sm ${showError('model') ? 'is-invalid' : ''}`}
                    value={form.model}
                    onChange={e => handleChange('model', e.target.value)}
                    placeholder="XPS 15 9520"
                    maxLength={MAX_LENGTHS.model}
                    disabled={submitting}
                  />
                  {showError('model') && <div className="invalid-feedback d-block">{errors.model}</div>}
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Serial Number</label>
                  <input
                    type="text"
                    className={`form-control form-control-sm ${showError('serial_number') ? 'is-invalid' : ''}`}
                    value={form.serial_number}
                    onChange={e => handleChange('serial_number', e.target.value)}
                    placeholder="SN123456789"
                    maxLength={MAX_LENGTHS.serial_number}
                    disabled={submitting}
                  />
                  {showError('serial_number') && <div className="invalid-feedback d-block">{errors.serial_number}</div>}
                </div>
              </div>
            </div>

            <div className="section-divider">
              <div className="section-title">Purchase & Warranty</div>
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label small text-muted">Purchase Date</label>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={form.purchase_date}
                    onChange={e => handleChange('purchase_date', e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Purchase Price (৳)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className={`form-control form-control-sm ${showError('purchase_price') ? 'is-invalid' : ''}`}
                    value={form.purchase_price}
                    onChange={e => handleChange('purchase_price', e.target.value)}
                    placeholder="135000"
                    disabled={submitting}
                  />
                  {showError('purchase_price') && <div className="invalid-feedback d-block">{errors.purchase_price}</div>}
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Warranty Type</label>
                  <input
                    type="text"
                    className={`form-control form-control-sm ${showError('warranty_type') ? 'is-invalid' : ''}`}
                    value={form.warranty_type}
                    onChange={e => handleChange('warranty_type', e.target.value)}
                    placeholder="Manufacturer (3 Years)"
                    maxLength={MAX_LENGTHS.warranty_type}
                    disabled={submitting}
                  />
                  {showError('warranty_type') && <div className="invalid-feedback d-block">{errors.warranty_type}</div>}
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Warranty Start</label>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={form.warranty_start_date}
                    onChange={e => handleChange('warranty_start_date', e.target.value)}
                    disabled={submitting}
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Warranty End</label>
                  <input
                    type="date"
                    className={`form-control form-control-sm ${showError('warranty_end_date') ? 'is-invalid' : ''}`}
                    value={form.warranty_end_date}
                    onChange={e => handleChange('warranty_end_date', e.target.value)}
                    disabled={submitting}
                  />
                  {showError('warranty_end_date') && <div className="invalid-feedback d-block">{errors.warranty_end_date}</div>}
                </div>
                <div className="col-md-4">
                  <label className="form-label small text-muted">Condition</label>
                  <select className="form-select form-select-sm" value={form.condition} onChange={e => handleChange('condition', e.target.value)} disabled={submitting}>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="section-divider">
              <div className="section-title">Notes</div>
              <div className="row g-3">
                <div className="col-12">
                  <textarea
                    className="form-control form-control-sm"
                    rows="3"
                    value={form.notes}
                    onChange={e => handleChange('notes', e.target.value)}
                    placeholder="Additional notes..."
                    disabled={submitting}
                  />
                  <div className="small text-muted text-end mt-1">{form.notes.length} characters</div>
                </div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            {!asset && (
              <div className="form-check me-auto">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="keepOpen"
                  checked={keepOpen}
                  onChange={e => setKeepOpen(e.target.checked)}
                  disabled={submitting}
                />
                <label className="form-check-label small" htmlFor="keepOpen">Save &amp; Add Another</label>
              </div>
            )}
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleClose} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={submitting}>
              {submitting && <span className="spinner-border spinner-border-sm me-1" />}
              {asset ? 'Save Changes' : 'Create Asset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AssetFormModal;
