import React from 'react';
import { inputClass } from '../constants';

const DeskMoveModal = ({
  selectedDesk,
  masters,
  deskMoveForm,
  setDeskMoveForm,
  deskMoveError,
  selectedDeskAssets,
  deskMoveDestinationDesks,
  closeDeskMoveModal,
  submitDeskAssetMove
}) => {
  if (!selectedDesk) return null;
  const destinationDesk = (masters.desks || []).find((desk) => String(desk.id) === String(deskMoveForm.to_desk_id));
  const selectedAsset = selectedDeskAssets.find((asset) => String(asset.id) === String(deskMoveForm.asset_id));

  return (
    <div className="asset-modal-overlay position-fixed top-0 start-0 w-100 h-100" style={{ zIndex: 1090, background: 'rgba(15, 23, 42, 0.6)' }}>
      <div
        className="container h-100 d-flex align-items-center justify-content-center py-4"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeDeskMoveModal();
        }}
      >
        <div className="asset-modal-shell bg-white shadow-lg w-100 desk-transfer-modal" style={{ maxWidth: 760, maxHeight: '92vh', overflowY: 'auto' }}>
          <div className="d-flex justify-content-between align-items-center border-bottom px-4 py-3">
            <div>
              <div className="fw-bold fs-5">Desk Transfer</div>
              <div className="text-muted small">Move asset from Desk {selectedDesk.desk_no} with destination filtering and validation.</div>
            </div>
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={closeDeskMoveModal}>Close</button>
          </div>
          <form className="p-4 d-grid gap-3" onSubmit={submitDeskAssetMove}>
            <div className="desk-transfer-from">
              <div className="small text-muted text-uppercase fw-semibold">From</div>
              <div className="fw-semibold">{selectedDesk.office_name} - Desk {selectedDesk.desk_no}</div>
              <div className="small text-muted">{selectedDesk.assigned_user_name || selectedDesk.desk_label || 'Unassigned desk'}</div>
            </div>
            <select className={inputClass} value={deskMoveForm.asset_id} onChange={(e) => setDeskMoveForm((prev) => ({ ...prev, asset_id: e.target.value }))}>
              <option value="">Select asset</option>
              {selectedDeskAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.asset_name} ({asset.asset_tag})</option>
              ))}
            </select>
            <div className="row g-3">
              <div className="col-md-6">
                <select
                  className={inputClass}
                  value={deskMoveForm.to_office_id}
                  onChange={(e) => setDeskMoveForm((prev) => ({ ...prev, to_office_id: e.target.value, to_desk_id: '' }))}
                >
                  <option value="">Destination office</option>
                  {masters.offices.map((office) => (
                    <option key={office.id} value={office.id}>{office.name}</option>
                  ))}
                </select>
              </div>
              <div className="col-md-6">
                <select className={inputClass} value={deskMoveForm.to_desk_id} onChange={(e) => setDeskMoveForm((prev) => ({ ...prev, to_desk_id: e.target.value }))}>
                  <option value="">Destination desk</option>
                  {deskMoveDestinationDesks.map((desk) => (
                    <option key={desk.id} value={desk.id}>
                      Desk {desk.desk_no} - {desk.office_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <input
              className={inputClass}
              placeholder="Move reason"
              value={deskMoveForm.reason}
              onChange={(e) => setDeskMoveForm((prev) => ({ ...prev, reason: e.target.value }))}
            />
            {deskMoveError && <div className="desk-transfer-error">{deskMoveError}</div>}
            <div className="desk-transfer-preview small text-muted">
              {selectedAsset ? `Asset: ${selectedAsset.asset_name} (${selectedAsset.asset_tag})` : 'Asset not selected'}
              {destinationDesk ? ` -> Destination: ${destinationDesk.office_name}, Desk ${destinationDesk.desk_no}` : ' -> Destination not selected'}
            </div>
            <div className="d-flex justify-content-end gap-2">
              <button type="button" className="btn btn-outline-secondary" onClick={closeDeskMoveModal}>Cancel</button>
              <button type="submit" className="btn btn-primary">Confirm Transfer</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default DeskMoveModal;
