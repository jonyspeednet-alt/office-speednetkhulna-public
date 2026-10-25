import React from 'react';
import { inputClass } from '../constants';
import { formatDateTime } from '../../../utils/formatters';

const AssetEditModal = ({
  creatingAsset,
  editingAsset,
  editingStockItem,
  closeEdit,
  submitAssetCreate,
  submitAssetEdit,
  submitStockEdit,
  assetEditForm,
  setAssetEditForm,
  stockEditForm,
  setStockEditForm,
  masters,
  assetComponents,
  componentMovements,
  componentForm,
  setComponentForm,
  componentReplaceForm,
  setComponentReplaceForm,
  componentBusy,
  componentStatus,
  submitAssetComponent,
  submitComponentReplace
}) => {
  const isAsset = Boolean(editingAsset || creatingAsset);
  const title = isAsset
    ? (creatingAsset ? 'Add New Asset' : `Edit Asset ${editingAsset?.asset_tag || ''}`)
    : `Edit Stock Item ${editingStockItem?.item_code || ''}`;
  const onClose = closeEdit;
  const onSubmit = isAsset ? (creatingAsset ? submitAssetCreate : submitAssetEdit) : submitStockEdit;
  const formState = isAsset ? assetEditForm : stockEditForm;
  const setFormState = isAsset ? setAssetEditForm : setStockEditForm;
  const submitLabel = isAsset ? (creatingAsset ? 'Create Asset' : 'Save Asset') : 'Save Stock Item';

  return (
    <div className="asset-modal-overlay position-fixed top-0 start-0 w-100 h-100" style={{ zIndex: 1080, background: 'rgba(15, 23, 42, 0.55)' }}>
      <div
        className="container h-100 d-flex align-items-center justify-content-center py-4"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div className="asset-modal-shell bg-white shadow-lg w-100" style={{ maxWidth: 860, maxHeight: '92vh', overflowY: 'auto' }}>
          <div className="d-flex justify-content-between align-items-center border-bottom px-4 py-3">
            <div>
              <div className="fw-bold fs-5">{title}</div>
              <div className="text-muted small">Update the record and save without leaving the module.</div>
            </div>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>Close</button>
          </div>
          <form onSubmit={onSubmit} className="p-4">
            {isAsset ? (
              <div className="row g-3">
                <div className="col-12"><div className="fw-bold text-primary pb-2 border-bottom">Basic Information</div></div>
                <div className="col-md-4"><label className="form-label small text-muted">Asset Tag</label><input className={inputClass} placeholder="SN-LAPTOP-001" value={formState.asset_tag} onChange={(e) => setFormState((prev) => ({ ...prev, asset_tag: e.target.value }))} /></div>
                <div className="col-md-8"><label className="form-label small text-muted">Asset Name</label><input className={inputClass} placeholder="Dell XPS 15 Laptop" value={formState.asset_name} onChange={(e) => setFormState((prev) => ({ ...prev, asset_name: e.target.value }))} /></div>
                <div className="col-md-4"><label className="form-label small text-muted">Category</label>
                  <select className={inputClass} value={formState.category_id} onChange={(e) => setFormState((prev) => ({ ...prev, category_id: e.target.value }))}>
                    <option value="">Select Category</option>
                    {masters.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4"><label className="form-label small text-muted">Vendor</label>
                  <select className={inputClass} value={formState.vendor_id} onChange={(e) => setFormState((prev) => ({ ...prev, vendor_id: e.target.value }))}>
                    <option value="">Select Vendor</option>
                    {masters.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4"><label className="form-label small text-muted">Status</label>
                  <select className={inputClass} value={formState.status} onChange={(e) => setFormState((prev) => ({ ...prev, status: e.target.value }))}>
                    <option value="in_stock">In Stock</option>
                    <option value="active">Active</option>
                    <option value="maintenance">Maintenance</option>
                    <option value="repair">Under Repair</option>
                    <option value="broken">Broken</option>
                    <option value="replaced">Replaced</option>
                  </select>
                </div>
                <div className="col-12"><div className="fw-bold text-primary py-2 border-bottom">Location & Assignment</div></div>
                <div className="col-md-4"><label className="form-label small text-muted">Office</label>
                  <select className={inputClass} value={formState.office_id} onChange={(e) => setFormState((prev) => ({ ...prev, office_id: e.target.value, desk_id: '' }))}>
                    <option value="">Select Office</option>
                    {masters.offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4"><label className="form-label small text-muted">Desk</label>
                  <select className={inputClass} value={formState.desk_id} onChange={(e) => setFormState((prev) => ({ ...prev, desk_id: e.target.value }))}>
                    <option value="">Select Desk</option>
                    {masters.desks
                      .filter((desk) => !formState.office_id || String(desk.office_id) === String(formState.office_id))
                      .map((desk) => <option key={desk.id} value={desk.id}>
                        {desk.desk_no}{desk.floor_label ? ` (${desk.floor_label})` : ''} - {desk.office_code}
                        {desk.desk_label ? ` → ${desk.desk_label}` : desk.assigned_user_name ? ` → ${desk.assigned_user_name.split(' ')[0]}` : ''}
                      </option>)}
                  </select>
                </div>
                <div className="col-md-4"><label className="form-label small text-muted">Assigned To</label>
                  <select className={inputClass} value={formState.assigned_user_id} onChange={(e) => setFormState((prev) => ({ ...prev, assigned_user_id: e.target.value }))}>
                    <option value="">Select User</option>
                    {masters.users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.full_name}{user.designation ? ` - ${user.designation}` : ''}{user.department ? ` (${user.department})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-12"><div className="fw-bold text-primary py-2 border-bottom">Hardware Details</div></div>
                <div className="col-md-4"><label className="form-label small text-muted">Brand</label><input className={inputClass} placeholder="Dell" value={formState.brand} onChange={(e) => setFormState((prev) => ({ ...prev, brand: e.target.value }))} /></div>
                <div className="col-md-4"><label className="form-label small text-muted">Model</label><input className={inputClass} placeholder="XPS 15 9520" value={formState.model} onChange={(e) => setFormState((prev) => ({ ...prev, model: e.target.value }))} /></div>
                <div className="col-md-4"><label className="form-label small text-muted">Serial Number</label><input className={inputClass} placeholder="SN123456789" value={formState.serial_number} onChange={(e) => setFormState((prev) => ({ ...prev, serial_number: e.target.value }))} /></div>
                <div className="col-12"><div className="fw-bold text-primary py-2 border-bottom">Purchase & Warranty</div></div>
                <div className="col-md-4"><label className="form-label small text-muted">Purchase Date</label><input className={inputClass} type="date" value={formState.purchase_date} onChange={(e) => setFormState((prev) => ({ ...prev, purchase_date: e.target.value }))} /></div>
                <div className="col-md-4"><label className="form-label small text-muted">Purchase Price (Tk)</label><input className={inputClass} type="number" step="0.01" placeholder="135000" value={formState.purchase_price} onChange={(e) => setFormState((prev) => ({ ...prev, purchase_price: e.target.value }))} /></div>
                <div className="col-md-4"><label className="form-label small text-muted">Warranty Type</label><input className={inputClass} placeholder="Manufacturer (3 Years)" value={formState.warranty_type} onChange={(e) => setFormState((prev) => ({ ...prev, warranty_type: e.target.value }))} /></div>
                <div className="col-md-4"><label className="form-label small text-muted">Warranty Start</label><input className={inputClass} type="date" value={formState.warranty_start_date} onChange={(e) => setFormState((prev) => ({ ...prev, warranty_start_date: e.target.value }))} /></div>
                <div className="col-md-4"><label className="form-label small text-muted">Warranty End</label><input className={inputClass} type="date" value={formState.warranty_end_date} onChange={(e) => setFormState((prev) => ({ ...prev, warranty_end_date: e.target.value }))} /></div>
                <div className="col-md-4"><label className="form-label small text-muted">Condition</label>
                  <select className={inputClass} value={formState.condition} onChange={(e) => setFormState((prev) => ({ ...prev, condition: e.target.value }))}>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                  </select>
                </div>
                <div className="col-12"><label className="form-label small text-muted">Notes</label><textarea className={inputClass} rows="3" placeholder="Additional notes about this asset..." value={formState.notes} onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))} /></div>
                {!creatingAsset && editingAsset && (
                  <div className="col-12">
                    <div className="asset-component-shell">
                      <div className="asset-component-header">
                        <div>
                          <div className="fw-bold">PC Components & Replace Log</div>
                          <div className="small text-muted">Track each replaceable part for this asset.</div>
                        </div>
                        <span className="badge bg-primary-subtle text-primary-emphasis">{assetComponents.filter((item) => item.status === 'active').length} active</span>
                      </div>

                      <div className="row g-2 mt-1">
                        <div className="col-md-3"><input className={inputClass} placeholder="Type (RAM, SSD, PSU)" value={componentForm.component_type} onChange={(e) => setComponentForm((prev) => ({ ...prev, component_type: e.target.value }))} /></div>
                        <div className="col-md-3"><input className={inputClass} placeholder="Component name" value={componentForm.component_name} onChange={(e) => setComponentForm((prev) => ({ ...prev, component_name: e.target.value }))} /></div>
                        <div className="col-md-2"><input className={inputClass} placeholder="Brand" value={componentForm.brand} onChange={(e) => setComponentForm((prev) => ({ ...prev, brand: e.target.value }))} /></div>
                        <div className="col-md-2"><input className={inputClass} placeholder="Model" value={componentForm.model} onChange={(e) => setComponentForm((prev) => ({ ...prev, model: e.target.value }))} /></div>
                        <div className="col-md-2"><input className={inputClass} placeholder="Serial" value={componentForm.serial_number} onChange={(e) => setComponentForm((prev) => ({ ...prev, serial_number: e.target.value }))} /></div>
                        <div className="col-md-8"><input className={inputClass} placeholder="Specification" value={componentForm.specification} onChange={(e) => setComponentForm((prev) => ({ ...prev, specification: e.target.value }))} /></div>
                        <div className="col-md-4 d-grid"><button type="button" className="btn btn-outline-primary" disabled={componentBusy} onClick={submitAssetComponent}>{componentBusy ? 'Saving...' : 'Add Component'}</button></div>
                      </div>

                      <div className="row g-2 mt-1">
                        <div className="col-md-4">
                          <select
                            className={inputClass}
                            value={componentReplaceForm.component_id}
                            onChange={(e) => {
                              const selectedId = e.target.value;
                              const target = assetComponents.find((item) => String(item.id) === String(selectedId));
                              setComponentReplaceForm((prev) => ({
                                ...prev,
                                component_id: selectedId,
                                component_type: target?.component_type || '',
                                component_name: target?.component_name || '',
                                brand: target?.brand || '',
                                model: target?.model || '',
                                specification: target?.specification || ''
                              }));
                            }}
                          >
                            <option value="">Select active component to replace</option>
                            {assetComponents
                              .filter((item) => item.status === 'active')
                              .map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.component_type} - {item.component_name} ({item.serial_number || 'no-serial'})
                                </option>
                              ))}
                          </select>
                        </div>
                        <div className="col-md-2"><input className={inputClass} placeholder="New Serial" value={componentReplaceForm.serial_number} onChange={(e) => setComponentReplaceForm((prev) => ({ ...prev, serial_number: e.target.value }))} /></div>
                        <div className="col-md-2"><input className={inputClass} placeholder="Brand" value={componentReplaceForm.brand} onChange={(e) => setComponentReplaceForm((prev) => ({ ...prev, brand: e.target.value }))} /></div>
                        <div className="col-md-2"><input className={inputClass} placeholder="Model" value={componentReplaceForm.model} onChange={(e) => setComponentReplaceForm((prev) => ({ ...prev, model: e.target.value }))} /></div>
                        <div className="col-md-2"><input className={inputClass} placeholder="Reason" value={componentReplaceForm.reason} onChange={(e) => setComponentReplaceForm((prev) => ({ ...prev, reason: e.target.value }))} /></div>
                        <div className="col-md-8"><input className={inputClass} placeholder="Notes" value={componentReplaceForm.notes} onChange={(e) => setComponentReplaceForm((prev) => ({ ...prev, notes: e.target.value }))} /></div>
                        <div className="col-md-4 d-grid"><button type="button" className="btn btn-outline-dark" disabled={componentBusy} onClick={submitComponentReplace}>{componentBusy ? 'Processing...' : 'Replace Selected Component'}</button></div>
                      </div>

                      {componentStatus && (
                        <div className={`small mt-2 ${componentStatus.type === 'error' ? 'text-danger' : 'text-success'}`}>
                          {componentStatus.message}
                        </div>
                      )}

                      <div className="table-responsive mt-3">
                        <table className="table table-sm align-middle mb-0">
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Name</th>
                              <th>Serial</th>
                              <th>Status</th>
                              <th>Installed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {assetComponents.map((item) => (
                              <tr key={item.id}>
                                <td>{item.component_type}</td>
                                <td>{item.component_name}</td>
                                <td className="small text-muted">{item.serial_number || '-'}</td>
                                <td><span className={`badge ${item.status === 'active' ? 'bg-success-subtle text-success-emphasis' : 'bg-secondary-subtle text-secondary-emphasis'}`}>{item.status}</span></td>
                                <td className="small text-muted">{item.installed_at ? new Date(item.installed_at).toLocaleDateString() : '-'}</td>
                              </tr>
                            ))}
                            {!assetComponents.length && (
                              <tr><td colSpan="5" className="small text-muted text-center py-3">No components added yet.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <div className="asset-component-history mt-3">
                        <div className="fw-semibold small mb-1">Latest Component History</div>
                        {componentMovements.slice(0, 6).map((entry) => (
                          <div key={entry.id} className="small text-muted">
                            {formatDateTime(entry.created_at)} - {entry.movement_type}
                            {entry.from_component_name ? ` - from ${entry.from_component_name}` : ''}
                            {entry.to_component_name ? ` to ${entry.to_component_name}` : ''}
                            {entry.reason ? ` (${entry.reason})` : ''}
                          </div>
                        ))}
                        {!componentMovements.length && <div className="small text-muted">No component movement history.</div>}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="row g-3">
                <div className="col-md-4"><input className={inputClass} placeholder="Item code" value={formState.item_code} onChange={(e) => setFormState((prev) => ({ ...prev, item_code: e.target.value }))} /></div>
                <div className="col-md-8"><input className={inputClass} placeholder="Item name" value={formState.item_name} onChange={(e) => setFormState((prev) => ({ ...prev, item_name: e.target.value }))} /></div>
                <div className="col-md-4"><input className={inputClass} placeholder="Item type" value={formState.item_type} onChange={(e) => setFormState((prev) => ({ ...prev, item_type: e.target.value }))} /></div>
                <div className="col-md-4">
                  <select className={inputClass} value={formState.category_id} onChange={(e) => setFormState((prev) => ({ ...prev, category_id: e.target.value }))}>
                    <option value="">Category</option>
                    {masters.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <select className={inputClass} value={formState.vendor_id} onChange={(e) => setFormState((prev) => ({ ...prev, vendor_id: e.target.value }))}>
                    <option value="">Vendor</option>
                    {masters.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <select className={inputClass} value={formState.office_id} onChange={(e) => setFormState((prev) => ({ ...prev, office_id: e.target.value }))}>
                    <option value="">Office</option>
                    {masters.offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <select className={inputClass} value={formState.desk_id} onChange={(e) => setFormState((prev) => ({ ...prev, desk_id: e.target.value }))}>
                    <option value="">Desk</option>
                    {masters.desks.map((desk) => <option key={desk.id} value={desk.id}>Desk {desk.desk_no} - {desk.office_name}</option>)}
                  </select>
                </div>
                <div className="col-md-4"><input className={inputClass} type="number" min="0" placeholder="Quantity on hand" value={formState.quantity_on_hand} onChange={(e) => setFormState((prev) => ({ ...prev, quantity_on_hand: e.target.value }))} /></div>
                <div className="col-md-4"><input className={inputClass} type="number" min="0" placeholder="Minimum quantity" value={formState.minimum_quantity} onChange={(e) => setFormState((prev) => ({ ...prev, minimum_quantity: e.target.value }))} /></div>
                <div className="col-md-4"><input className={inputClass} type="number" step="0.01" placeholder="Unit price" value={formState.unit_price} onChange={(e) => setFormState((prev) => ({ ...prev, unit_price: e.target.value }))} /></div>
                <div className="col-md-6"><input className={inputClass} placeholder="Serial number" value={formState.serial_number} onChange={(e) => setFormState((prev) => ({ ...prev, serial_number: e.target.value }))} /></div>
                <div className="col-md-4">
                  <select className={inputClass} value={formState.status} onChange={(e) => setFormState((prev) => ({ ...prev, status: e.target.value }))}>
                    <option value="available">Available</option>
                    <option value="reserved">Reserved</option>
                    <option value="out_of_stock">Out of stock</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div className="col-12"><textarea className={inputClass} rows="3" placeholder="Notes" value={formState.notes} onChange={(e) => setFormState((prev) => ({ ...prev, notes: e.target.value }))} /></div>
              </div>
            )}
            <div className="d-flex justify-content-end gap-2 mt-4">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary">{submitLabel}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default AssetEditModal;
