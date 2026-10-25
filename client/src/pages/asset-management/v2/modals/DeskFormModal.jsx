import React, { useState, useEffect } from 'react';

const DeskFormModal = ({ desk, offices, users, onClose, onSubmit }) => {
  const [form, setForm] = useState({
    office_id: '',
    desk_no: '',
    desk_label: '',
    official_email: '',
    assigned_user_id: '',
    floor_label: '',
    location_note: '',
  });

  const [floors, setFloors] = useState([]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  useEffect(() => {
    if (desk) {
      setForm({
        office_id: desk.office_id || '',
        desk_no: desk.desk_no || '',
        desk_label: desk.desk_label || '',
        official_email: desk.official_email || '',
        assigned_user_id: desk.assigned_user_id || '',
        floor_label: desk.floor_label || '',
        location_note: desk.location_note || '',
      });
    } else {
      setForm({
        office_id: '',
        desk_no: '',
        desk_label: '',
        official_email: '',
        assigned_user_id: '',
        floor_label: '',
        location_note: '',
      });
    }
  }, [desk]);

  useEffect(() => {
    const office = offices?.find(o => String(o.id) === String(form.office_id));
    if (office?.code === 'HQ') {
      setFloors(['Ground Floor', '1st Floor', '2nd Floor']);
    } else {
      setFloors(['Main Area']);
    }
  }, [form.office_id, offices]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.office_id || !form.desk_no) return;
    onSubmit(form);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '500px' }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h5 className="mb-0">{desk ? `Edit Desk ${desk.desk_no}` : 'Add New Desk'}</h5>
          <button type="button" className="btn-close" onClick={onClose} />
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="row g-3">
              <div className="col-12">
                <label className="form-label small text-muted">Office *</label>
                <select className="form-select form-select-sm" value={form.office_id} onChange={e => handleChange('office_id', e.target.value)} required>
                  <option value="">Select Office</option>
                  {offices?.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Desk Number *</label>
                <input type="text" className="form-control form-control-sm" value={form.desk_no} onChange={e => handleChange('desk_no', e.target.value)} placeholder="D001" required />
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Desk Label</label>
                <input type="text" className="form-control form-control-sm" value={form.desk_label} onChange={e => handleChange('desk_label', e.target.value)} placeholder="Reception Desk, Meeting Room A, etc." />
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Official Email</label>
                <input type="email" className="form-control form-control-sm" value={form.official_email} onChange={e => handleChange('official_email', e.target.value)} placeholder="desk.d001@company.com" />
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Assigned User</label>
                <select className="form-select form-select-sm" value={form.assigned_user_id} onChange={e => handleChange('assigned_user_id', e.target.value)}>
                  <option value="">Unassigned</option>
                  {users?.map(u => <option key={u.id} value={u.id}>{u.full_name} {u.designation ? `- ${u.designation}` : ''}</option>)}
                </select>
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Floor</label>
                <select className="form-select form-select-sm" value={form.floor_label} onChange={e => handleChange('floor_label', e.target.value)}>
                  <option value="">Select</option>
                  {floors.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Location Note</label>
                <textarea className="form-control form-control-sm" rows="2" value={form.location_note} onChange={e => handleChange('location_note', e.target.value)} placeholder="Near window, by printer, etc." />
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary btn-sm">{desk ? 'Save Changes' : 'Create Desk'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DeskFormModal;