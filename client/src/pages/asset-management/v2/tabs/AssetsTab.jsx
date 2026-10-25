import React, { useState, useMemo, useCallback } from 'react';
import { useAssets } from '../../../../hooks/useAssetData';
import { confirmAction } from '../../../../utils/confirm';
import { notify } from '../../../../utils/notify';
import AssetFormModal from '../modals/AssetFormModal';

const AssetsTab = ({ masters }) => {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [officeFilter, setOfficeFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showModal, setShowModal] = useState(false);
  const [editingAsset, setEditingAsset] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const { items: assets, loading, refetch, create, update, remove } = useAssets(search, {
    status: statusFilter,
    office_id: officeFilter,
    category_id: categoryFilter,
  });

  const categories = useMemo(() => {
    const byId = new Map();
    assets.forEach(a => {
      if (a.category_id && a.category_name) {
        byId.set(String(a.category_id), { id: a.category_id, name: a.category_name });
      }
    });
    return Array.from(byId.values());
  }, [assets]);

  const offices = useMemo(() => {
    const byId = new Map();
    assets.forEach(a => {
      if (a.office_id && a.office_name) {
        byId.set(String(a.office_id), { id: a.office_id, name: a.office_name });
      }
    });
    return Array.from(byId.values());
  }, [assets]);

  const statuses = useMemo(() => {
    const byStatus = new Map();
    assets.forEach(a => {
      if (a.status) {
        byStatus.set(a.status, a.status);
      }
    });
    return Array.from(byStatus.values()).sort();
  }, [assets]);

  const handleSubmit = useCallback(async (formData, keepOpen) => {
    setSubmitting(true);
    try {
      if (editingAsset) {
        await update(editingAsset.id, formData);
        notify.success('Asset updated successfully');
      } else {
        await create(formData);
        notify.success('Asset created successfully');
      }
      if (!keepOpen) {
        setShowModal(false);
        setEditingAsset(null);
      }
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Failed to save asset');
    } finally {
      setSubmitting(false);
    }
  }, [editingAsset, create, update]);

  const handleEdit = (asset) => {
    setEditingAsset(asset);
    setShowModal(true);
  };

  const handleAdd = () => {
    setEditingAsset(null);
    setShowModal(true);
  };

  const handleDelete = useCallback(async (asset) => {
    const ok = await confirmAction({
      title: `Delete asset "${asset.asset_name}"?`,
      text: `${asset.asset_tag} — This will soft-delete the asset and hide it from the list. This action can be reversed from the database.`,
      confirmText: 'Delete',
      danger: true
    });
    if (!ok) return;
    try {
      await remove(asset.id, 'Removed via UI');
      await refetch();
      notify.success('Asset deleted successfully');
    } catch (err) {
      notify.error(err?.response?.data?.message || 'Failed to delete asset');
    }
  }, [remove, refetch]);

  const handleClose = useCallback(() => {
    setShowModal(false);
    setEditingAsset(null);
  }, []);

  const getStatusBadge = (status) => {
    const colors = { active: 'success', in_stock: 'secondary', maintenance: 'warning', repair: 'warning', broken: 'danger', replaced: 'dark' };
    return <span className={`badge bg-${colors[status] || 'secondary'}-subtle text-${colors[status] || 'secondary'}-emphasis`}>{status.replace('_', ' ')}</span>;
  };

  const getWarrantyBadge = (endDate) => {
    if (!endDate) return <span className="text-muted">—</span>;
    const end = new Date(endDate);
    const now = new Date();
    const diff = (end - now) / (1000 * 60 * 60 * 24);
    if (diff < 0) return <span className="badge bg-danger-subtle text-danger-emphasis">Expired</span>;
    if (diff <= 30) return <span className="badge bg-warning-subtle text-warning-emphasis">{Math.ceil(diff)} days</span>;
    return <span className="badge bg-success-subtle text-success-emphasis">{Math.ceil(diff)} days</span>;
  };

  return (
    <div className="asset-management-v2">
      <div className="card">
        <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
          <div>
            <h5 className="mb-0">Assets</h5>
            <small className="text-muted">{assets.length} records</small>
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleAdd}>
            <i className="fa-solid fa-plus me-1" /> Add Asset
          </button>
        </div>
        <div className="card-body border-bottom">
          <div className="row g-2 align-items-end">
            <div className="col-md-3">
              <label className="form-label small text-muted">Search</label>
              <input type="text" className="form-control form-control-sm search-input" placeholder="Tag, name, brand, model..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label small text-muted">Status</label>
              <select className="form-select form-select-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All</option>
                {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small text-muted">Office</label>
              <select className="form-select form-select-sm" value={officeFilter} onChange={e => setOfficeFilter(e.target.value)}>
                <option value="all">All</option>
                {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div className="col-md-2">
              <label className="form-label small text-muted">Category</label>
              <select className="form-select form-select-sm" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                <option value="all">All</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-md-3">
              <button className="btn btn-outline-secondary btn-sm w-100" onClick={refetch} disabled={loading}>
                <i className="fa-solid fa-arrow-rotate-right me-1" /> Refresh
              </button>
            </div>
          </div>
        </div>
        <div className="table-responsive">
          <table className="table table-hover mb-0">
            <thead>
              <tr>
                <th>Asset</th>
                <th>Category</th>
                <th>Location</th>
                <th>Vendor</th>
                <th>Warranty</th>
                <th>Status</th>
                <th>Condition</th>
                <th className="text-end">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="8" className="loading-state"><div className="spinner-border spinner-border-sm" /><span>Loading...</span></td></tr>}
              {!loading && assets.length === 0 && <tr><td colSpan="8" className="empty-state"><i className="fa-solid fa-laptop" /><p>No assets found</p></td></tr>}
              {assets.map(asset => (
                <tr key={asset.id} style={{ cursor: 'pointer' }} onClick={() => handleEdit(asset)}>
                  <td>
                    <div className="fw-medium">{asset.asset_name}</div>
                    <div className="small text-muted">{asset.asset_tag} {asset.serial_number ? `· ${asset.serial_number}` : ''}</div>
                    <div className="small text-muted">{asset.brand || ''} {asset.model ? `· ${asset.model}` : ''}</div>
                  </td>
                  <td>{asset.category_name || '—'}</td>
                  <td>
                    <div>{asset.office_name || '—'}</div>
                    <div className="small text-muted">{asset.desk_no ? `Desk ${asset.desk_no}` : 'Unassigned'}</div>
                  </td>
                  <td>{asset.vendor_name || '—'}</td>
                  <td>{getWarrantyBadge(asset.warranty_end_date)}</td>
                  <td>{getStatusBadge(asset.status)}</td>
                  <td>
                    <span className={`badge bg-${asset.condition === 'good' ? 'success' : asset.condition === 'fair' ? 'warning' : 'danger'}-subtle text-${asset.condition === 'good' ? 'success' : asset.condition === 'fair' ? 'warning' : 'danger'}-emphasis`}>
                      {asset.condition}
                    </span>
                  </td>
                  <td className="text-end">
                    <button className="btn btn-sm btn-outline-primary me-1" onClick={e => { e.stopPropagation(); handleEdit(asset); }}>
                      <i className="fa-solid fa-pen me-1" /> Edit
                    </button>
                    <button className="btn btn-sm btn-outline-danger" onClick={e => { e.stopPropagation(); handleDelete(asset); }}>
                      <i className="fa-solid fa-trash me-1" /> Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <AssetFormModal
          asset={editingAsset}
          categories={masters?.categories}
          offices={masters?.offices}
          desks={masters?.desks}
          vendors={masters?.vendors}
          users={masters?.users}
          onClose={handleClose}
          onSubmit={handleSubmit}
          submitting={submitting}
        />
      )}
    </div>
  );
};

export default AssetsTab;
