import React, { useState } from 'react';

const DeskDetailDrawer = ({ desk, offices, users, onClose, onSave }) => {
  const [form, setForm] = useState({
    office_id: desk.office_id,
    desk_label: desk.desk_label || '',
    official_email: desk.official_email || '',
    assigned_user_id: desk.assigned_user_id || '',
    floor_label: desk.floor_label || '',
    location_note: desk.location_note || '',
  });
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('details');

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave(form);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ background: 'transparent' }} onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '500px', marginLeft: 'auto', marginRight: 0, maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header bg-primary text-white">
          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-white text-primary px-3 py-1 fw-bold">Desk {desk.desk_no}</span>
            <span className="small opacity-75">{desk.office_name}</span>
          </div>
          <button type="button" className="btn-close btn-close-white" onClick={onClose} />
        </div>
        <div className="modal-body" style={{ maxHeight: '70vh', overflow: 'auto' }}>
          <ul className="nav nav-tabs mb-3" role="tablist">
            <li className="nav-item"><button className={`nav-link ${activeTab === 'details' ? 'active' : ''}`} onClick={() => setActiveTab('details')}>Details</button></li>
            <li className="nav-item"><button className={`nav-link ${activeTab === 'assignment' ? 'active' : ''}`} onClick={() => setActiveTab('assignment')}>Assignment</button></li>
            <li className="nav-item"><button className={`nav-link ${activeTab === 'assets' ? 'active' : ''}`} onClick={() => setActiveTab('assets')}>Assets ({desk.asset_count || 0})</button></li>
          </ul>

          {activeTab === 'details' && (
            <form onSubmit={handleSubmit}>
              <div className="mb-3">
                <label className="form-label small text-muted">Office</label>
                <select className="form-select form-select-sm" value={form.office_id} onChange={e => handleChange('office_id', e.target.value)}>
                  {offices?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label small text-muted">Desk Label</label>
                <input type="text" className="form-control form-control-sm" value={form.desk_label} onChange={e => handleChange('desk_label', e.target.value)} />
              </div>
              <div className="mb-3">
                <label className="form-label small text-muted">Official Email</label>
                <input type="email" className="form-control form-control-sm" value={form.official_email} onChange={e => handleChange('official_email', e.target.value)} />
              </div>
              <div className="mb-3">
                <label className="form-label small text-muted">Floor</label>
                <select className="form-select form-select-sm" value={form.floor_label} onChange={e => handleChange('floor_label', e.target.value)}>
                  <option value="">Unspecified</option>
                  <option value="Ground Floor">Ground Floor</option>
                  <option value="1st Floor">1st Floor</option>
                  <option value="2nd Floor">2nd Floor</option>
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label small text-muted">Location Note</label>
                <textarea className="form-control form-control-sm" rows="2" value={form.location_note} onChange={e => handleChange('location_note', e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving...' : 'Save Details'}</button>
            </form>
          )}

          {activeTab === 'assignment' && (
            <form onSubmit={handleSubmit}>
              <div className="mb-3">
                <label className="form-label small text-muted">Assigned User</label>
                <select className="form-select form-select-sm" value={form.assigned_user_id} onChange={e => handleChange('assigned_user_id', e.target.value)}>
                  <option value="">Unassigned</option>
                  {users?.map(u => <option key={u.id} value={u.id}>{u.full_name} {u.designation ? `- ${u.designation}` : ''}</option>)}
                </select>
              </div>
              <div className="mb-3">
                <label className="form-label small text-muted">Official Email</label>
                <input type="email" className="form-control form-control-sm" value={form.official_email} onChange={e => handleChange('official_email', e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving...' : 'Update Assignment'}</button>
            </form>
          )}

          {activeTab === 'assets' && (
            <div className="list-group list-group-flush">
              {desk.asset_count === 0 ? (
                <div className="empty-state p-3"><i className="fa-solid fa-laptop" /><p className="mb-0 small">No assets on this desk</p></div>
              ) : (
                desk.assets?.map(asset => (
                  <div key={asset.id} className="list-group-item px-3 py-2">
                    <div className="d-flex justify-content-between align-items-center">
                      <div>
                        <div className="fw-medium small">{asset.asset_name}</div>
                        <div className="small text-muted">{asset.asset_tag}</div>
                      </div>
                      <span className="badge bg-secondary-subtle text-secondary-emphasis small">{asset.status}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeskDetailDrawer;