import React from 'react';
import { inputClass, STOCK_STATUS_TONES } from '../constants';
import { toneBadge, toneFor, formatStatusLabel } from '../utils';

const StockTab = ({
  stockItemForm,
  setStockItemForm,
  submitStockItem,
  masters,
  stockItems,
  openStockEdit,
  stockMovementForm,
  setStockMovementForm,
  submitStockMovement,
  stockMovements,
  loading
}) => (
  <div className="row g-4">
    <div className="col-lg-4">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold">Add Stock Item</div>
        <div className="card-body">
          <form className="d-grid gap-3" onSubmit={submitStockItem}>
            <input className={inputClass} placeholder="Item code" value={stockItemForm.item_code} onChange={(e) => setStockItemForm((prev) => ({ ...prev, item_code: e.target.value }))} />
            <input className={inputClass} placeholder="Item name" value={stockItemForm.item_name} onChange={(e) => setStockItemForm((prev) => ({ ...prev, item_name: e.target.value }))} />
            <input className={inputClass} placeholder="Item type" value={stockItemForm.item_type} onChange={(e) => setStockItemForm((prev) => ({ ...prev, item_type: e.target.value }))} />
            <select className={inputClass} value={stockItemForm.category_id} onChange={(e) => setStockItemForm((prev) => ({ ...prev, category_id: e.target.value }))}>
              <option value="">Category</option>
              {masters.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <select className={inputClass} value={stockItemForm.vendor_id} onChange={(e) => setStockItemForm((prev) => ({ ...prev, vendor_id: e.target.value }))}>
              <option value="">Vendor</option>
              {masters.vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
            </select>
            <select className={inputClass} value={stockItemForm.office_id} onChange={(e) => setStockItemForm((prev) => ({ ...prev, office_id: e.target.value }))}>
              <option value="">Office</option>
              {masters.offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
            </select>
            <select className={inputClass} value={stockItemForm.desk_id} onChange={(e) => setStockItemForm((prev) => ({ ...prev, desk_id: e.target.value }))}>
              <option value="">Desk</option>
              {masters.desks.map((desk) => <option key={desk.id} value={desk.id}>Desk {desk.desk_no} - {desk.office_name}</option>)}
            </select>
            <input className={inputClass} type="number" min="0" placeholder="Quantity on hand" value={stockItemForm.quantity_on_hand} onChange={(e) => setStockItemForm((prev) => ({ ...prev, quantity_on_hand: e.target.value }))} />
            <input className={inputClass} type="number" min="0" placeholder="Minimum quantity" value={stockItemForm.minimum_quantity} onChange={(e) => setStockItemForm((prev) => ({ ...prev, minimum_quantity: e.target.value }))} />
            <input className={inputClass} type="number" step="0.01" placeholder="Unit price" value={stockItemForm.unit_price} onChange={(e) => setStockItemForm((prev) => ({ ...prev, unit_price: e.target.value }))} />
            <input className={inputClass} placeholder="Serial number" value={stockItemForm.serial_number} onChange={(e) => setStockItemForm((prev) => ({ ...prev, serial_number: e.target.value }))} />
            <select className={inputClass} value={stockItemForm.status} onChange={(e) => setStockItemForm((prev) => ({ ...prev, status: e.target.value }))}>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
            <textarea className={inputClass} rows="2" placeholder="Notes" value={stockItemForm.notes} onChange={(e) => setStockItemForm((prev) => ({ ...prev, notes: e.target.value }))} />
            <button className="btn btn-primary" type="submit">Save Stock Item</button>
          </form>
        </div>
      </div>
    </div>
    <div className="col-lg-8">
      <div className="card shadow-sm h-100 mb-4">
        <div className="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
          <span>Stock Inventory</span>
          <span className="text-muted small">{stockItems.length} items</span>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Min</th>
                <th>Office</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {stockItems.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="fw-semibold">{item.item_name}</div>
                    <div className="small text-muted">{item.item_code || '-'}</div>
                  </td>
                  <td>{item.quantity_on_hand}</td>
                  <td>{item.minimum_quantity}</td>
                  <td>{item.office_name || '-'}</td>
                  <td><span className={toneBadge(toneFor(STOCK_STATUS_TONES, item.stock_status))}>{formatStatusLabel(item.stock_status)}</span></td>
                  <td>
                    <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => openStockEdit(item)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {!stockItems.length && !loading && (
                <tr><td colSpan="6" className="text-muted text-center py-4">No stock items found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white fw-bold">Stock Movement</div>
        <div className="card-body">
          <form className="row g-3" onSubmit={submitStockMovement}>
            <div className="col-md-4">
              <select className={inputClass} value={stockMovementForm.stock_item_id} onChange={(e) => setStockMovementForm((prev) => ({ ...prev, stock_item_id: e.target.value }))}>
                <option value="">Stock item</option>
                {stockItems.map((item) => <option key={item.id} value={item.id}>{item.item_name}</option>)}
              </select>
            </div>
            <div className="col-md-4">
              <select className={inputClass} value={stockMovementForm.movement_type} onChange={(e) => setStockMovementForm((prev) => ({ ...prev, movement_type: e.target.value }))}>
                <option value="received">Received</option>
                <option value="issued">Issued</option>
                <option value="adjusted">Adjusted</option>
                <option value="returned">Returned</option>
              </select>
            </div>
            <div className="col-md-4">
              <input className={inputClass} type="number" placeholder="Quantity change e.g. 5 or -2" value={stockMovementForm.quantity_change} onChange={(e) => setStockMovementForm((prev) => ({ ...prev, quantity_change: e.target.value }))} />
            </div>
            <div className="col-md-6">
              <select className={inputClass} value={stockMovementForm.to_office_id} onChange={(e) => setStockMovementForm((prev) => ({ ...prev, to_office_id: e.target.value }))}>
                <option value="">To office</option>
                {masters.offices.map((office) => <option key={office.id} value={office.id}>{office.name}</option>)}
              </select>
            </div>
            <div className="col-md-6">
              <select className={inputClass} value={stockMovementForm.to_desk_id} onChange={(e) => setStockMovementForm((prev) => ({ ...prev, to_desk_id: e.target.value }))}>
                <option value="">To desk</option>
                {masters.desks.map((desk) => <option key={desk.id} value={desk.id}>Desk {desk.desk_no} - {desk.office_name}</option>)}
              </select>
            </div>
            <div className="col-12">
              <input className={inputClass} placeholder="Reason" value={stockMovementForm.reason} onChange={(e) => setStockMovementForm((prev) => ({ ...prev, reason: e.target.value }))} />
            </div>
            <div className="col-12">
              <textarea className={inputClass} rows="2" placeholder="Notes" value={stockMovementForm.notes} onChange={(e) => setStockMovementForm((prev) => ({ ...prev, notes: e.target.value }))} />
            </div>
            <div className="col-12">
              <button className="btn btn-primary" type="submit">Save Stock Movement</button>
            </div>
          </form>
        </div>
      </div>
      <div className="card shadow-sm h-100 mt-4">
        <div className="card-header bg-white fw-bold d-flex justify-content-between align-items-center">
          <span>Stock Movements</span>
          <span className="text-muted small">{stockMovements.length} records</span>
        </div>
        <div className="table-responsive">
          <table className="table align-middle mb-0">
            <thead>
              <tr>
                <th>Item</th>
                <th>Change</th>
                <th>From</th>
                <th>To</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {stockMovements.map((movement) => (
                <tr key={movement.id}>
                  <td>{movement.item_name}</td>
                  <td>{movement.quantity_change}</td>
                  <td>
                    <div>{movement.from_office_name || '-'}</div>
                    <div className="small text-muted">{movement.from_desk_no ? `Desk ${movement.from_desk_no}` : '-'}</div>
                  </td>
                  <td>
                    <div>{movement.to_office_name || '-'}</div>
                    <div className="small text-muted">{movement.to_desk_no ? `Desk ${movement.to_desk_no}` : '-'}</div>
                  </td>
                  <td>{movement.reason || '-'}</td>
                </tr>
              ))}
              {!stockMovements.length && !loading && (
                <tr><td colSpan="5" className="text-muted text-center py-4">No stock movements found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
);

export default StockTab;
