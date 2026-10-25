import React, { useState, useEffect } from 'react';

const StockItemModal = ({ item, onClose, onSubmit, categories, offices, desks, vendors }) => {
  const [form, setForm] = useState({
    item_code: '',
    item_name: '',
    item_type: 'spare',
    category_id: '',
    vendor_id: '',
    office_id: '',
    desk_id: '',
    quantity_on_hand: 0,
    minimum_quantity: 0,
    unit_price: '',
    serial_number: '',
    status: 'available',
    notes: '',
  });

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (item) {
      setForm({
        item_code: item.item_code || '',
        item_name: item.item_name || '',
        item_type: item.item_type || 'spare',
        category_id: item.category_id || '',
        vendor_id: item.vendor_id || '',
        office_id: item.office_id || '',
        desk_id: item.desk_id || '',
        quantity_on_hand: item.quantity_on_hand || 0,
        minimum_quantity: item.minimum_quantity || 0,
        unit_price: item.unit_price || '',
        serial_number: item.serial_number || '',
        status: item.status || 'available',
        notes: item.notes || '',
      });
    } else {
      setForm({
        item_code: '',
        item_name: '',
        item_type: 'spare',
        category_id: '',
        vendor_id: '',
        office_id: '',
        desk_id: '',
        quantity_on_hand: 0,
        minimum_quantity: 0,
        unit_price: '',
        serial_number: '',
        status: 'available',
        notes: '',
      });
    }
  }, [item]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.item_name.trim()) return;
    onSubmit(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '700px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h5 className="mb-0">{item ? 'Edit Stock Item' : 'Add Stock Item'}</h5>
          <button type="button" className="btn-close" onClick={onClose} />
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="row g-3">
              <div className="col-md-4">
                <label className="form-label small text-muted">Item Code</label>
                <input type="text" className="form-control form-control-sm" value={form.item_code} onChange={e => handleChange('item_code', e.target.value)} placeholder="Auto-generated" />
              </div>
              <div className="col-md-8">
                <label className="form-label small text-muted">Item Name *</label>
                <input type="text" className="form-control form-control-sm" value={form.item_name} onChange={e => handleChange('item_name', e.target.value)} placeholder="USB-C Cable, Wireless Mouse..." required />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Type</label>
                <select className="form-select form-select-sm" value={form.item_type} onChange={e => handleChange('item_type', e.target.value)}>
                  <option value="spare">Spare Part</option>
                  <option value="consumable">Consumable</option>
                  <option value="accessory">Accessory</option>
                  <option value="tool">Tool</option>
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Category</label>
                <select className="form-select form-select-sm" value={form.category_id} onChange={e => handleChange('category_id', e.target.value)}>
                  <option value="">Select</option>
                  {categories?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Vendor</label>
                <select className="form-select form-select-sm" value={form.vendor_id} onChange={e => handleChange('vendor_id', e.target.value)}>
                  <option value="">Select</option>
                  {vendors?.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Office</label>
                <select className="form-select form-select-sm" value={form.office_id} onChange={e => handleChange('office_id', e.target.value)}>
                  <option value="">Select</option>
                  {offices?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Desk</label>
                <select className="form-select form-select-sm" value={form.desk_id} onChange={e => handleChange('desk_id', e.target.value)}>
                  <option value="">Select</option>
                  {desks?.map(d => <option key={d.id} value={d.id}>Desk {d.desk_no} - {d.office_name}</option>)}
                </select>
              </div>
              <div className="col-md-3">
                <label className="form-label small text-muted">Quantity on Hand</label>
                <input type="number" min="0" className="form-control form-control-sm" value={form.quantity_on_hand} onChange={e => handleChange('quantity_on_hand', Number(e.target.value))} />
              </div>
              <div className="col-md-3">
                <label className="form-label small text-muted">Minimum Quantity</label>
                <input type="number" min="0" className="form-control form-control-sm" value={form.minimum_quantity} onChange={e => handleChange('minimum_quantity', Number(e.target.value))} />
              </div>
              <div className="col-md-3">
                <label className="form-label small text-muted">Unit Price (৳)</label>
                <input type="number" step="0.01" min="0" className="form-control form-control-sm" value={form.unit_price} onChange={e => handleChange('unit_price', e.target.value)} placeholder="0.00" />
              </div>
              <div className="col-md-3">
                <label className="form-label small text-muted">Status</label>
                <select className="form-select form-select-sm" value={form.status} onChange={e => handleChange('status', e.target.value)}>
                  <option value="available">Available</option>
                  <option value="reserved">Reserved</option>
                  <option value="low_stock">Low Stock</option>
                  <option value="out_of_stock">Out of Stock</option>
                </select>
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Serial Number</label>
                <input type="text" className="form-control form-control-sm" value={form.serial_number} onChange={e => handleChange('serial_number', e.target.value)} />
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Notes</label>
                <textarea className="form-control form-control-sm" rows="2" value={form.notes} onChange={e => handleChange('notes', e.target.value)} placeholder="Additional notes..." />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">{item ? 'Save Changes' : 'Create Item'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default StockItemModal;