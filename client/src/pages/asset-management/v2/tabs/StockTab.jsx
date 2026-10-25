import React, { useState, useMemo } from 'react';
import { useStock } from '../../../../hooks/useAssetData';
import StockItemModal from '../modals/StockItemModal';

const StockTab = () => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [officeFilter, setOfficeFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  const { items, movements, categories, offices, desks, vendors, loading, createItem, updateItem } = useStock();

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (search && !item.item_name.toLowerCase().includes(search.toLowerCase()) &&
          !item.item_code.toLowerCase().includes(search.toLowerCase())) return false;
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (officeFilter !== 'all' && String(item.office_id) !== String(officeFilter)) return false;
      return true;
    });
  }, [items, search, statusFilter, officeFilter]);

  const statuses = useMemo(() => {
    const set = new Set();
    items.forEach(i => i.status && set.add(i.status));
    return Array.from(set).sort();
  }, [items]);

  const officeOptions = useMemo(() => {
    const set = new Set();
    items.forEach(i => i.office_id && i.office_name && set.add({ id: i.office_id, name: i.office_name }));
    return Array.from(set).filter(Boolean);
  }, [items]);

  const stats = useMemo(() => ({
    total: items.length,
    lowStock: items.filter(i => Number(i.quantity_on_hand) <= Number(i.minimum_quantity)).length,
    totalValue: items.reduce((sum, i) => sum + Number(i.quantity_on_hand) * Number(i.unit_price || 0), 0),
    movements: movements.length,
  }), [items, movements]);

  const handleSubmit = async (formData) => {
    if (editingItem) await updateItem(editingItem.id, formData);
    else await createItem(formData);
    setShowModal(false);
    setEditingItem(null);
  };

  const handleEdit = (item) => { setEditingItem(item); setShowModal(true); };
  const handleAdd = () => { setEditingItem(null); setShowModal(true); };

  const getStatusBadge = (status) => {
    const map = {
      available: 'bg-success-subtle text-success-emphasis',
      reserved: 'bg-info-subtle text-info-emphasis',
      low_stock: 'bg-warning-subtle text-warning-emphasis',
      out_of_stock: 'bg-danger-subtle text-danger-emphasis',
    };
    return <span className={`badge ${map[status] || 'bg-secondary-subtle text-secondary-emphasis'}`}>{status.replace('_', ' ')}</span>;
  };

  return (
    <div className="asset-management-v2">
      <div className="row g-3 mb-3">
        <div className="col-md-3">
          <div className="card metric-card"><div className="card-body d-flex align-items-center gap-3">
            <div className="bg-primary-subtle text-primary rounded-3 p-3"><i className="fa-solid fa-boxes-stacked fa-1.5x" /></div>
            <div><div className="metric-value fw-bold">{stats.total}</div><div className="metric-label text-muted small">Total Items</div></div>
          </div></div>
        </div>
        <div className="col-md-3">
          <div className="card metric-card"><div className="card-body d-flex align-items-center gap-3">
            <div className="bg-warning-subtle text-warning rounded-3 p-3"><i className="fa-solid fa-triangle-exclamation fa-1.5x" /></div>
            <div><div className="metric-value fw-bold">{stats.lowStock}</div><div className="metric-label text-muted small">Low Stock</div></div>
          </div></div>
        </div>
        <div className="col-md-3">
          <div className="card metric-card"><div className="card-body d-flex align-items-center gap-3">
            <div className="bg-info-subtle text-info rounded-3 p-3"><i className="fa-solid fa-arrow-right-arrow-left fa-1.5x" /></div>
            <div><div className="metric-value fw-bold">{stats.movements}</div><div className="metric-label text-muted small">Movements</div></div>
          </div></div>
        </div>
        <div className="col-md-3">
          <div className="card metric-card"><div className="card-body d-flex align-items-center gap-3">
            <div className="bg-success-subtle text-success rounded-3 p-3"><i className="fa-solid fa-taka-sign fa-1.5x" /></div>
            <div><div className="metric-value fw-bold">৳{stats.totalValue.toLocaleString()}</div><div className="metric-label text-muted small">Total Value</div></div>
          </div></div>
        </div>
      </div>

      <div className="card">
        <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div>
            <h5 className="mb-0">Stock Items</h5>
            <small className="text-muted">Manage spare parts and consumables inventory</small>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd}><i className="fa-solid fa-plus me-1" /> Add Item</button>
        </div>
        <div className="card-body border-bottom">
          <div className="row g-2 align-items-end">
            <div className="col-md-4">
              <label className="form-label small text-muted">Search</label>
              <input type="text" className="form-control form-control-sm search-input" placeholder="Item name, code..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label small text-muted">Status</label>
              <select className="form-select form-select-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All</option>
                {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <label className="form-label small text-muted">Office</label>
              <select className="form-select form-select-sm" value={officeFilter} onChange={e => setOfficeFilter(e.target.value)}>
                <option value="all">All</option>
                {officeOptions.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          </div>
        </div>
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Item</th>
                <th>Code</th>
                <th>Category</th>
                <th>Location</th>
                <th>Qty</th>
                <th>Min</th>
                <th>Status</th>
                <th>Value</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="9" className="loading-state"><div className="spinner-border spinner-border-sm" /><span>Loading...</span></td></tr>}
              {!loading && filteredItems.length === 0 && <tr><td colSpan="9" className="empty-state"><i className="fa-solid fa-box" /><p>No stock items found</p></td></tr>}
              {filteredItems.map(item => (
                <tr key={item.id}>
                  <td>
                    <div className="fw-medium">{item.item_name}</div>
                    <div className="small text-muted">{item.vendor_name || '—'}</div>
                  </td>
                  <td className="text-muted small">{item.item_code}</td>
                  <td>{item.category_name || '—'}</td>
                  <td>
                    <div>{item.office_name || '—'}</div>
                    <div className="small text-muted">Desk {item.desk_no || '—'}</div>
                  </td>
                  <td><strong>{item.quantity_on_hand}</strong></td>
                  <td className="text-muted">{item.minimum_quantity}</td>
                  <td>{getStatusBadge(item.status)}</td>
                  <td>৳{(Number(item.quantity_on_hand) * Number(item.unit_price || 0)).toLocaleString()}</td>
                  <td className="text-end">
                    <button className="btn btn-sm btn-outline-primary" onClick={() => handleEdit(item)}><i className="fa-solid fa-pen" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <StockItemModal
          item={editingItem}
          categories={categories}
          offices={offices}
          desks={desks}
          vendors={vendors}
          onClose={() => { setShowModal(false); setEditingItem(null); }}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
};

export default StockTab;