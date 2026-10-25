import React from 'react';
import { inputClass } from '../constants';
import { getDeskFloorLabel, getDeskOccupantLabel, getDeskUserName, getDeskRoleLabel } from '../utils';
import { formatDateTime } from '../../../utils/formatters';

const DeskMapTab = ({
  masters,
  loading,
  deskSearch,
  setDeskSearch,
  deskOfficeFilter,
  setDeskOfficeFilter,
  deskFloorFilter,
  setDeskFloorFilter,
  deskFloorOptions,
  deskGroups,
  deskSections,
  selectedDeskId,
  selectedDesk,
  selectedDeskOffice,
  openDeskDetail,
  deskForm,
  setDeskForm,
  submitDeskAssignment,
  deskAssignmentSaving,
  deskAssignmentStatus,
  selectedDeskAssets,
  selectedDeskStockItems,
  deskHistory,
  openDeskMoveModal
}) => (
  <div className="row g-4">
    <div className="col-lg-8">
      <div className="card shadow-sm h-100">
        <div className="card-header bg-white d-flex flex-wrap justify-content-between align-items-center gap-3">
          <div>
            <div className="fw-bold">Desk Map</div>
            <div className="text-muted small">Filter by office and floor, then click a desk to inspect occupant, assets, and stock items.</div>
          </div>
          <div className="d-flex flex-wrap gap-2">
            <input
              className="form-control form-control-sm"
              style={{ minWidth: 200 }}
              value={deskSearch}
              onChange={(e) => setDeskSearch(e.target.value)}
              placeholder="Search desk, email, or person"
            />
            <select className="form-select form-select-sm" style={{ minWidth: 180 }} value={deskOfficeFilter} onChange={(e) => setDeskOfficeFilter(e.target.value)}>
              <option value="all">All offices</option>
              {masters.offices.map((office) => (
                <option key={office.id} value={office.id}>{office.name}</option>
              ))}
            </select>
            <select className="form-select form-select-sm" style={{ minWidth: 180 }} value={deskFloorFilter} onChange={(e) => setDeskFloorFilter(e.target.value)}>
              <option value="all">All floors</option>
              {deskFloorOptions.map((floor) => (
                <option key={floor} value={floor}>{floor}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="card-body desk-map-body">
          <div className="desk-layout-summary">
            <div><strong>{deskGroups.reduce((count, group) => count + group.desks.length, 0)}</strong><span>Visible desks</span></div>
            <div><strong>{deskGroups.reduce((count, group) => count + group.desks.filter((desk) => desk.assigned_user_id).length, 0)}</strong><span>Assigned</span></div>
            <div><strong>{deskGroups.reduce((count, group) => count + group.desks.filter((desk) => !desk.assigned_user_id).length, 0)}</strong><span>Open</span></div>
            <div><strong>{deskFloorFilter === 'all' ? deskFloorOptions.length : 1}</strong><span>Floors</span></div>
          </div>
          {deskSections.map((section) => (
            <div key={section.key} className={`desk-zone desk-zone-${section.key}`}>
              <div className="desk-zone-title mb-3">
                <span>{section.label} <small>{section.subtitle}</small></span>
                <span>{section.groups.reduce((count, group) => count + group.desks.length, 0)} desks</span>
              </div>
              {section.groups.map((group) => (
                <div key={`${section.key}-${group.office_id}-${group.floor_label}`} className="mb-4">
                  <div className="desk-office-title mb-3">
                    <span>{group.office_name} <small>{group.floor_label}</small></span>
                    <span>{group.desks.length} desks</span>
                  </div>
                  <div className="desk-grid">
                    {group.desks.map((desk) => {
                      const isSelected = String(selectedDeskId) === String(desk.id);
                      const hasOccupant = Boolean(desk.assigned_user_id);
                      return (
                        <button
                          key={desk.id}
                          type="button"
                          className={`desk-card ${isSelected ? 'desk-card-selected' : ''}`}
                          onClick={() => openDeskDetail(desk)}
                        >
                          <div className="desk-card-top">
                            <span className="desk-no">Desk {desk.desk_no}</span>
                            <span className={`desk-pill ${hasOccupant ? 'desk-pill-assigned' : 'desk-pill-empty'}`}>
                              {hasOccupant ? 'Assigned' : 'Open'}
                            </span>
                          </div>
                          <div className="desk-card-name">{getDeskUserName(desk)}</div>
                          <div className="desk-card-meta">{getDeskRoleLabel(desk)}</div>
                          <div className="desk-card-email">{desk.official_email || '-'}</div>
                          <div className="desk-card-stats">
                            <span>{desk.asset_count || 0} assets</span>
                            <span>{desk.stock_count || 0} stock</span>
                            <span>{desk.issue_count || 0} issues</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {!deskGroups.length && !loading && (
            <div className="text-muted text-center py-5">No desk records found for the selected office/floor filter.</div>
          )}
        </div>
      </div>
    </div>

    <div className="col-lg-4">
      <div className="card shadow-sm h-100 desk-detail-shell">
        <div className="card-header bg-white fw-bold">Desk Details</div>
        <div className="card-body">
          {!selectedDesk ? (
            <div className="text-muted">
              Click a desk card to see the current occupant, linked portal user, and items on that desk.
            </div>
          ) : (
            <div className="d-grid gap-3">
              <div className="desk-detail-hero">
                <div className="desk-detail-no">Desk {selectedDesk.desk_no}</div>
                <div className="desk-detail-office">
                  {selectedDesk.office_name}
                  {getDeskFloorLabel(selectedDesk) !== 'Main Area' ? ` - ${getDeskFloorLabel(selectedDesk)}` : ''}
                </div>
                <div className="desk-detail-user">
                  {getDeskOccupantLabel(selectedDesk)}
                </div>
                <div className="desk-detail-email">{selectedDesk.official_email || 'No official email set'}</div>
              </div>

              <div className="desk-detail-summary">
                <div><strong>{selectedDesk.asset_count || 0}</strong><span>Assets</span></div>
                <div><strong>{selectedDesk.stock_count || 0}</strong><span>Stock</span></div>
                <div><strong>{selectedDesk.issue_count || 0}</strong><span>Issues</span></div>
              </div>

              <form className="d-grid gap-3" onSubmit={submitDeskAssignment}>
                <select className={inputClass} value={deskForm.office_id} onChange={(e) => setDeskForm((prev) => ({ ...prev, office_id: e.target.value }))}>
                  <option value="">Office</option>
                  {masters.offices.map((office) => (
                    <option key={office.id} value={office.id}>{office.name}</option>
                  ))}
                </select>
                <select className={inputClass} value={deskForm.assigned_user_id} onChange={(e) => setDeskForm((prev) => ({ ...prev, assigned_user_id: e.target.value }))}>
                  <option value="">Assign portal user</option>
                  {masters.users.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.full_name}
                      {user.designation ? ` - ${user.designation}` : ''}
                      {user.department ? ` (${user.department})` : ''}
                    </option>
                  ))}
                </select>
                {selectedDeskOffice?.code === 'HQ' ? (
                  <select className={inputClass} value={deskForm.floor_label || ''} onChange={(e) => setDeskForm((prev) => ({ ...prev, floor_label: e.target.value }))}>
                    <option value="">Select floor</option>
                    <option value="Ground Floor">Ground Floor</option>
                    <option value="1st Floor">1st Floor</option>
                  </select>
                ) : (
                  <div className="small text-muted">Floor assignment is only applicable for Head Office desks.</div>
                )}
                <input className={inputClass} value={deskForm.desk_label} placeholder="Desk label / occupant name" onChange={(e) => setDeskForm((prev) => ({ ...prev, desk_label: e.target.value }))} />
                <input className={inputClass} value={deskForm.official_email} placeholder="Official email" onChange={(e) => setDeskForm((prev) => ({ ...prev, official_email: e.target.value }))} />
                <textarea className={inputClass} rows="2" value={deskForm.location_note} placeholder="Location note" onChange={(e) => setDeskForm((prev) => ({ ...prev, location_note: e.target.value }))} />
                <button className="btn btn-primary" type="submit" disabled={deskAssignmentSaving}>
                  {deskAssignmentSaving ? 'Saving...' : 'Save Desk Assignment'}
                </button>
                {deskAssignmentStatus && (
                  <div className={deskAssignmentStatus.type === 'error' ? 'small text-danger' : 'small text-success'}>
                    {deskAssignmentStatus.message}
                  </div>
                )}
              </form>

              <div className="desk-detail-list">
                <div className="desk-detail-list-title">Assets on this desk</div>
                {selectedDeskAssets.length ? selectedDeskAssets.map((asset) => (
                  <div key={asset.id} className="desk-detail-item">
                    <div>
                      <div className="fw-semibold">{asset.asset_name}</div>
                      <div className="small text-muted">{asset.asset_tag} {asset.serial_number ? `- ${asset.serial_number}` : ''}</div>
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className="badge bg-info-subtle text-info-emphasis">{asset.status}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        onClick={() => openDeskMoveModal(asset.id)}
                      >
                        Move
                      </button>
                    </div>
                  </div>
                )) : <div className="text-muted small">No assets linked to this desk.</div>}
              </div>

              <div className="desk-detail-list">
                <div className="desk-detail-list-title">Move asset from this desk</div>
                <div className="small text-muted mb-3">
                  Use transfer modal for cleaner routing between offices/desks with validation.
                </div>
                <button type="button" className="btn btn-outline-primary" onClick={() => openDeskMoveModal()}>
                  Open Transfer Modal
                </button>
              </div>

              <div className="desk-detail-list">
                <div className="desk-detail-list-title">Stock items on this desk</div>
                {selectedDeskStockItems.length ? selectedDeskStockItems.map((item) => (
                  <div key={item.id} className="desk-detail-item">
                    <div>
                      <div className="fw-semibold">{item.item_name}</div>
                      <div className="small text-muted">{item.item_code}</div>
                    </div>
                    <span className="badge bg-secondary-subtle text-secondary-emphasis">{item.quantity_on_hand}</span>
                  </div>
                )) : <div className="text-muted small">No stock items linked to this desk.</div>}
              </div>

              <div className="desk-detail-list">
                <div className="desk-detail-list-title">Assignment history</div>
                {deskHistory.length ? deskHistory.map((entry) => (
                  <div key={entry.id} className="desk-history-item">
                    <div className="fw-semibold">
                      {entry.assigned_user_name || 'Unassigned'}
                    </div>
                    <div className="small text-muted">
                      {entry.assigned_user_email || entry.official_email || 'No email'}{entry.assigned_by_name ? ` - by ${entry.assigned_by_name}` : ''}
                    </div>
                    <div className="small text-muted">
                      {entry.notes || 'No notes'}{entry.created_at ? ` - ${formatDateTime(entry.created_at)}` : ''}
                    </div>
                  </div>
                )) : <div className="text-muted small">No assignment history found.</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  </div>
);

export default DeskMapTab;
