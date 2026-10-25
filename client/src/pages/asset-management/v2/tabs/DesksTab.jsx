import React, { useState, useMemo } from 'react';
import { useAssets, useDesks } from '../../../../hooks/useAssetData';
import DeskFormModal from '../modals/DeskFormModal';

const DesksTab = () => {
  const [search, setSearch] = useState('');
  const [officeFilter, setOfficeFilter] = useState('all');
  const [floorFilter, setFloorFilter] = useState('all');
  const [selectedDesk, setSelectedDesk] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [editingDesk, setEditingDesk] = useState(null);

  const { items: assets } = useAssets('', { office_id: officeFilter });
  const { items: desks, offices, users, update, create } = useDesks();

  const filteredDesks = useMemo(() => {
    return desks.filter(desk => {
      if (officeFilter !== 'all' && String(desk.office_id) !== String(officeFilter)) return false;
      const floor = desk.floor_label || 'Main Area';
      if (floorFilter !== 'all' && floor !== floorFilter) return false;
      if (search) {
        const query = search.toLowerCase();
        const haystack = [
          desk.desk_no, desk.desk_label, desk.office_name,
          desk.assigned_user_name, desk.official_email,
          desk.floor_label
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [desks, search, officeFilter, floorFilter]);

  const floorOptions = useMemo(() => {
    const set = new Set();
    desks.forEach(d => set.add(d.floor_label || 'Main Area'));
    return Array.from(set).sort();
  }, [desks]);

  const deskAssets = useMemo(() => {
    if (!selectedDesk) return [];
    return assets.filter(a => String(a.desk_id) === String(selectedDesk.id));
  }, [assets, selectedDesk]);

  const stats = useMemo(() => ({
    total: filteredDesks.length,
    assigned: filteredDesks.filter(d => d.assigned_user_id).length,
    open: filteredDesks.filter(d => !d.assigned_user_id).length,
  }), [filteredDesks]);

  const getAssetVisual = (asset) => {
    const haystack = `${asset.asset_name || ''} ${asset.category_name || ''}`.toLowerCase();
    if (haystack.includes('monitor') || haystack.includes('display') || haystack.includes('screen')) {
      return { icon: 'fa-display', label: 'Monitor', tone: 'primary' };
    }
    if (haystack.includes('ssd') || haystack.includes('hard drive') || haystack.includes('storage')) {
      return { icon: 'fa-hdd', label: 'Storage', tone: 'info' };
    }
    if (haystack.includes('processor') || haystack.includes('cpu') || haystack.includes('microchip')) {
      return { icon: 'fa-microchip', label: 'Processor', tone: 'warning' };
    }
    if (haystack.includes('laptop') || haystack.includes('notebook')) {
      return { icon: 'fa-laptop', label: 'Laptop', tone: 'success' };
    }
    if (haystack.includes('printer')) {
      return { icon: 'fa-print', label: 'Printer', tone: 'secondary' };
    }
    if (haystack.includes('keyboard')) {
      return { icon: 'fa-keyboard', label: 'Keyboard', tone: 'purple' };
    }
    if (haystack.includes('mouse')) {
      return { icon: 'fa-computer-mouse', label: 'Mouse', tone: 'danger' };
    }
    if (haystack.includes('router') || haystack.includes('switch') || haystack.includes('network')) {
      return { icon: 'fa-network-wired', label: 'Network', tone: 'indigo' };
    }
    return { icon: 'fa-box-archive', label: asset.category_name || 'Asset', tone: 'primary' };
  };

  const handleDeskClick = (desk) => {
    setSelectedDesk(desk);
  };

  const handleEditDesk = (desk) => {
    setEditingDesk(desk);
    setShowModal(true);
  };

  const handleAddDesk = () => {
    setEditingDesk(null);
    setShowModal(true);
  };

  const handleSubmit = async (formData) => {
    if (editingDesk) {
      await update(editingDesk.id, formData);
    } else {
      await create(formData);
    }
    setShowModal(false);
    setEditingDesk(null);
  };

  return (
    <div className="asset-management-v2">
      <div className="row g-3">
        <div className="col-xl-7">
          <div className="card h-100 desk-map-panel">
            <div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
              <div>
                <h5 className="mb-0">Desk Map</h5>
                <small className="text-muted">Scan desk occupancy and equipment with a cleaner, lighter map.</small>
              </div>
              <div className="d-flex gap-2 flex-wrap">
                <span className="badge bg-success-subtle text-success-emphasis align-self-center">{stats.assigned} assigned</span>
                <span className="badge bg-secondary-subtle text-secondary-emphasis align-self-center">{stats.open} open</span>
                <button className="btn btn-primary btn-sm" onClick={handleAddDesk}><i className="fa-solid fa-plus me-1" /> Add Desk</button>
              </div>
            </div>
            <div className="card-body border-bottom">
              <div className="row g-2 align-items-end">
                <div className="col-md-4">
                  <label className="form-label small text-muted">Search</label>
                  <input type="text" className="form-control form-control-sm" placeholder="Desk, person, email..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <div className="col-md-3">
                  <label className="form-label small text-muted">Office</label>
                  <select className="form-select form-select-sm" value={officeFilter} onChange={e => setOfficeFilter(e.target.value)}>
                    <option value="all">All Offices</option>
                    {offices.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="col-md-3">
                  <label className="form-label small text-muted">Floor</label>
                  <select className="form-select form-select-sm" value={floorFilter} onChange={e => setFloorFilter(e.target.value)}>
                    <option value="all">All Floors</option>
                    {floorOptions.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="card-body p-0">
              {filteredDesks.length === 0 ? (
                <div className="empty-state p-4"><i className="fa-solid fa-table-cells-large" /><p>No desks found</p></div>
              ) : (
                <div className="desk-grid p-3">
                  {filteredDesks.map(desk => {
                    const hasOccupant = Boolean(desk.assigned_user_id);
                    const isSelected = selectedDesk && String(selectedDesk.id) === String(desk.id);
                    return (
                      <button
                        key={desk.id}
                        type="button"
                        className={`desk-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => handleDeskClick(desk)}
                      >
                        <div className="d-flex justify-content-between align-items-start gap-2">
                          <span className="desk-number">Desk {desk.desk_no}</span>
                          <span className={`desk-status ${hasOccupant ? 'assigned' : 'open'}`}>
                            {hasOccupant ? 'Assigned' : 'Open'}
                          </span>
                        </div>
                        <div className="desk-occupant">{desk.assigned_user_name || desk.desk_label || 'Unassigned'}</div>
                        <div className="desk-meta">{desk.assigned_user_designation || desk.assigned_user_department || desk.office_name}</div>
                        <div className="desk-meta">{desk.official_email || 'No email'}</div>
                        <div className="desk-stats">
                          <span>{desk.asset_count || 0} assets</span>
                          <span>{desk.stock_count || 0} stock</span>
                          <span>{desk.issue_count || 0} issues</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-xl-5">
          <div className="card h-100 desk-detail-panel">
            <div className="card-header">
              <h5 className="mb-0">Desk Details</h5>
            </div>
            <div className="card-body">
              {selectedDesk ? (
                <div className="desk-detail-shell">
                  <div className="desk-detail-hero desk-detail-hero-strong">
                    <div className="desk-detail-kicker">Workspace snapshot</div>
                    <div className="desk-detail-title">{selectedDesk.desk_label || `Desk ${selectedDesk.desk_no}`}</div>
                    <div className="desk-detail-subtitle">{selectedDesk.office_name} · {selectedDesk.floor_label || 'Main Area'}</div>
                    <div className="desk-detail-status">
                      <span className={`desk-status ${selectedDesk.assigned_user_id ? 'assigned' : 'open'}`}>{selectedDesk.assigned_user_id ? 'Assigned' : 'Available'}</span>
                      <span className="desk-detail-note">{selectedDesk.location_note || 'Desktop design view ready'}</span>
                    </div>
                  </div>

                  <div className="desk-visual-grid">
                    <div className="desk-plan-card">
                      <div className="desk-plan-chip">Desk Layout</div>
                      <div className="desk-plan-body">
                        <div className="desk-plan-monitor"><i className="fa-solid fa-display" /></div>
                        <div className="desk-plan-laptop"><i className="fa-solid fa-laptop" /></div>
                        <div className="desk-plan-chair"><i className="fa-solid fa-chair" /></div>
                        <div className="desk-plan-accessories">
                          <span><i className="fa-solid fa-keyboard" /></span>
                          <span><i className="fa-solid fa-mouse" /></span>
                          <span><i className="fa-solid fa-microchip" /></span>
                        </div>
                      </div>
                      <div className="desk-plan-label">Modern desk concept with visual components</div>
                    </div>
                    <div className="desk-summary-card">
                      <div className="desk-summary-row">
                        <div>
                          <div className="desk-summary-value">{selectedDesk.asset_count || 0}</div>
                          <div className="desk-summary-label">Assets</div>
                        </div>
                        <div>
                          <div className="desk-summary-value">{selectedDesk.stock_count || 0}</div>
                          <div className="desk-summary-label">Stock</div>
                        </div>
                        <div>
                          <div className="desk-summary-value text-danger">{selectedDesk.issue_count || 0}</div>
                          <div className="desk-summary-label">Issues</div>
                        </div>
                      </div>
                      <div className="desk-summary-meta">
                        <div className="desk-summary-meta-item"><i className="fa-solid fa-user"></i> {selectedDesk.assigned_user_name || 'No occupant'}</div>
                        <div className="desk-summary-meta-item"><i className="fa-solid fa-envelope"></i> {selectedDesk.official_email || 'No email'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="desk-assets-panel">
                    <div className="desk-assets-panel-header">
                      <h6 className="mb-0">Equipment at this desk</h6>
                      <span className="badge bg-primary-subtle text-primary-emphasis">{deskAssets.length}</span>
                    </div>
                    {deskAssets.length > 0 ? (
                      <div className="desk-assets-grid desk-assets-grid-large">
                        {deskAssets.map(asset => {
                          const visual = getAssetVisual(asset);
                          return (
                            <div key={asset.id} className={`asset-graphic-card asset-tone-${visual.tone}`}>
                              <div className="asset-graphic-icon">
                                <i className={`fa-solid ${visual.icon}`} />
                              </div>
                              <div className="asset-graphic-body">
                                <div className="asset-graphic-title">{asset.asset_name || 'Unnamed asset'}</div>
                                <div className="asset-graphic-meta">{asset.asset_tag || 'No tag'}</div>
                                <div className="asset-graphic-footer">
                                  <span className="asset-chip">{visual.label}</span>
                                  <span className="asset-chip subtle">{asset.status || 'Active'}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="empty-state compact">
                        <i className="fa-solid fa-box-open" />
                        <p>No assets assigned yet</p>
                      </div>
                    )}
                  </div>

                  <button className="btn btn-outline-primary w-100" onClick={() => handleEditDesk(selectedDesk)}>
                    <i className="fa-solid fa-pen me-1" /> Edit Desk
                  </button>
                </div>
              ) : (
                <div className="text-center text-muted py-5">
                  <i className="fa-solid fa-mouse-pointer fa-2x mb-2" />
                  <p>Select a desk to see the visual workspace details</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showModal && (
        <DeskFormModal
          desk={editingDesk}
          offices={offices}
          users={users}
          onClose={() => { setShowModal(false); setEditingDesk(null); }}
          onSubmit={handleSubmit}
        />
      )}
    </div>
  );
};

export default DesksTab;