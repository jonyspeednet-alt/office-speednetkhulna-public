import React from 'react';
import ModalWrap from '../ModalWrap';
import { splitCsv } from '../../../utils/formatters';

const EditProfileModal = ({ editForm, setEditForm, saving, onSubmit, onClose }) => {
    if (!editForm) return null;

    const toggleCsvValue = (key, value) => {
        const current = new Set(splitCsv(editForm?.[key]));
        if (current.has(value)) current.delete(value);
        else current.add(value);
        setEditForm({ ...editForm, [key]: Array.from(current).join(', ') });
    };

    return (
        <ModalWrap title="Edit Profile" onClose={onClose}>
            <form className="row g-3" onSubmit={onSubmit}>
                <h6 className="text-primary fw-bold mb-1 border-bottom pb-2">General Info</h6>

                {/* Multi-partner editor */}
                {(editForm.partners || []).map((p, idx) => (
                    <React.Fragment key={idx}>
                        <div className="col-md-4">
                            <label className="form-label fw-semibold">
                                {idx === 0 ? 'Partner Name' : `Partner ${idx + 1} Name`}
                            </label>
                            <input
                                className="form-control"
                                value={p.partner_name}
                                onChange={(e) => {
                                    const updated = [...(editForm.partners || [])];
                                    updated[idx] = { ...updated[idx], partner_name: e.target.value };
                                    setEditForm({ ...editForm, partners: updated, name: idx === 0 ? e.target.value : editForm.name });
                                }}
                                required={idx === 0}
                            />
                        </div>
                        <div className="col-md-3">
                            <label className="form-label fw-semibold">Contact No</label>
                            <div className="d-flex gap-1">
                                <input
                                    className="form-control"
                                    value={p.contact_no}
                                    onChange={(e) => {
                                        const updated = [...(editForm.partners || [])];
                                        updated[idx] = { ...updated[idx], contact_no: e.target.value };
                                        setEditForm({ ...editForm, partners: updated, phone: idx === 0 ? e.target.value : editForm.phone });
                                    }}
                                />
                                {(editForm.partners || []).length > 1 && (
                                    <button
                                        type="button"
                                        className="btn btn-outline-danger btn-sm"
                                        style={{ minWidth: 38 }}
                                        onClick={() => {
                                            const updated = (editForm.partners || []).filter((_, i) => i !== idx);
                                            setEditForm({ ...editForm, partners: updated });
                                        }}
                                        title="Remove"
                                    >
                                        <i className="fas fa-trash-alt" />
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="col-md-1 d-flex align-items-end" style={{ paddingBottom: 0 }}>
                            {idx === (editForm.partners || []).length - 1 && (
                                <button
                                    type="button"
                                    className="btn btn-outline-primary btn-sm"
                                    style={{ minWidth: 38, minHeight: 38 }}
                                    onClick={() => {
                                        const updated = [...(editForm.partners || []), { partner_name: '', contact_no: '' }];
                                        setEditForm({ ...editForm, partners: updated });
                                    }}
                                    title="Add another partner"
                                >
                                    <i className="fas fa-plus" />
                                </button>
                            )}
                        </div>
                    </React.Fragment>
                ))}

                <div className="col-md-4">
                    <label className="form-label fw-semibold">Company Name</label>
                    <input
                        className="form-control"
                        value={editForm.company_name}
                        onChange={(e) => setEditForm({ ...editForm, company_name: e.target.value })}
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-semibold">User ID</label>
                    <input
                        className="form-control"
                        value={editForm.reseller_code}
                        onChange={(e) => setEditForm({ ...editForm, reseller_code: e.target.value })}
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-semibold">Partner Type</label>
                    <select
                        className="form-select"
                        value={editForm.partner_type}
                        onChange={(e) => setEditForm({ ...editForm, partner_type: e.target.value })}
                    >
                        <option value="mac_partner">Mac Partner</option>
                        <option value="distribution_partner">Distribution Partner</option>
                        <option value="channel_partner">Channel Partner</option>
                    </select>
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-semibold">POP Location</label>
                    <input
                        className="form-control"
                        value={editForm.pop_location}
                        onChange={(e) => setEditForm({ ...editForm, pop_location: e.target.value })}
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-semibold">Security Deposit</label>
                    <input
                        type="number"
                        className="form-control"
                        value={editForm.security_deposit}
                        onChange={(e) => setEditForm({ ...editForm, security_deposit: e.target.value })}
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-semibold">OTC Charge</label>
                    <input
                        type="number"
                        step="0.01"
                        className="form-control"
                        value={editForm.otc_charge}
                        onChange={(e) => setEditForm({ ...editForm, otc_charge: e.target.value })}
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-semibold">Latitude</label>
                    <input
                        className="form-control"
                        value={editForm.latitude}
                        onChange={(e) => setEditForm({ ...editForm, latitude: e.target.value })}
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-semibold">Longitude</label>
                    <input
                        className="form-control"
                        value={editForm.longitude}
                        onChange={(e) => setEditForm({ ...editForm, longitude: e.target.value })}
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-semibold">Joining Date</label>
                    <input
                        type="date"
                        className="form-control"
                        value={editForm.joining_date || ''}
                        onChange={(e) => setEditForm({ ...editForm, joining_date: e.target.value })}
                    />
                </div>
                <div className="col-md-6">
                    <label className="form-label fw-semibold">Reseller Status</label>
                    <select
                        className="form-select"
                        value={editForm.status}
                        onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                    >
                        <option value="active">Active</option>
                        <option value="suspended">Suspended</option>
                        <option value="inactive">Inactive</option>
                    </select>
                </div>
                <div className="col-md-6">
                    <label className="form-label fw-semibold text-danger">New Password (optional)</label>
                    <input
                        type="password"
                        className="form-control"
                        value={editForm.password || ''}
                        onChange={(e) => setEditForm({ ...editForm, password: e.target.value })}
                        placeholder="Leave empty to keep unchanged"
                    />
                </div>

                {editForm.partner_type === 'channel_partner' ? (
                    <>
                        <h6 className="text-primary fw-bold mt-2 mb-1 border-bottom pb-2">User & Commission Info</h6>
                        <div className="col-md-4">
                            <label className="form-label fw-semibold">Total Users</label>
                            <input
                                type="number"
                                min="0"
                                className="form-control"
                                value={editForm.channel_user_count}
                                onChange={(e) => setEditForm({ ...editForm, channel_user_count: e.target.value })}
                            />
                        </div>
                        <div className="col-md-4">
                            <label className="form-label fw-semibold">Profit Share (%)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                className="form-control"
                                value={editForm.profit_share_percentage}
                                onChange={(e) => setEditForm({ ...editForm, profit_share_percentage: e.target.value })}
                            />
                        </div>
                    </>
                ) : (
                    <>
                        <h6 className="text-primary fw-bold mt-2 mb-1 border-bottom pb-2">Bandwidth Allocation (Mbps)</h6>
                        <div className="col-12">
                            <div className="alert alert-info border-0 py-2 small mb-2">
                                <i className="fas fa-info-circle me-1" />
                                <strong>To change rates</strong> close this form and use the <strong>&quot;Change Bandwidth Rate&quot;</strong> button on the Bandwidth tab — rates can be changed there with an effective date and log.
                            </div>
                        </div>

                        <div className="col-md-4">
                            <label className="form-label fw-semibold">Profit Share (%)</label>
                            <input
                                type="number"
                                step="0.01"
                                min="0"
                                max="100"
                                className="form-control"
                                value={editForm.profit_share_percentage}
                                onChange={(e) => setEditForm({ ...editForm, profit_share_percentage: e.target.value })}
                            />
                        </div>

                        {['iig', 'bdix', 'ggc', 'fna', 'cdn', 'bcdn', 'nttn'].map((k) => (
                            <React.Fragment key={k}>
                                <div className="col-md-3">
                                    <label className="form-label text-uppercase">{k === 'bcdn' ? 'Other' : k} BW (Mbps)</label>
                                    <input
                                        type="number"
                                        className="form-control"
                                        value={editForm[`${k === 'nttn' ? 'nttn_capacity' : `${k}_bw`}`]}
                                        onChange={(e) => setEditForm({ ...editForm, [`${k === 'nttn' ? 'nttn_capacity' : `${k}_bw`}`]: e.target.value })}
                                    />
                                </div>
                                <div className="col-md-3">
                                    <label className="form-label text-uppercase text-muted">{k === 'bcdn' ? 'Other' : k} Rate (Tk) <small className="text-warning">→ separate button</small></label>
                                    <input
                                        type="number"
                                        className="form-control form-control-sm bg-light text-muted"
                                        value={editForm[`rate_${k}`]}
                                        onChange={(e) => setEditForm({ ...editForm, [`rate_${k}`]: e.target.value })}
                                    />
                                </div>
                            </React.Fragment>
                        ))}
                    </>
                )}

                <div className="col-md-4">
                    <label className="form-label fw-semibold">Projected Bill</label>
                    <input
                        type="number"
                        className="form-control"
                        value={editForm.monthly_rate}
                        onChange={(e) => setEditForm({ ...editForm, monthly_rate: e.target.value })}
                    />
                </div>
                <div className="col-md-4">
                    <label className="form-label fw-semibold">Previous Due</label>
                    <input
                        type="number"
                        className="form-control"
                        value={editForm.due_amount}
                        onChange={(e) => setEditForm({ ...editForm, due_amount: e.target.value })}
                    />
                </div>
                {editForm.partner_type !== 'channel_partner' && (
                    <div className="col-md-4">
                        <label className="form-label fw-semibold">NTTN Link</label>
                        <input
                            className="form-control"
                            value={editForm.nttn_link}
                            onChange={(e) => setEditForm({ ...editForm, nttn_link: e.target.value })}
                        />
                    </div>
                )}
                <div className="col-md-6">
                    <label className="form-label fw-semibold">Real IP Quantity</label>
                    <input
                        type="number"
                        min="0"
                        className="form-control"
                        value={editForm.real_ip_count}
                        onChange={(e) => setEditForm({ ...editForm, real_ip_count: e.target.value })}
                    />
                </div>
                <div className="col-md-6">
                    <label className="form-label fw-semibold">Real IP Unit Price</label>
                    <input
                        type="number"
                        step="0.01"
                        min="0"
                        className="form-control"
                        value={editForm.real_ip_price}
                        onChange={(e) => setEditForm({ ...editForm, real_ip_price: e.target.value })}
                    />
                </div>
                {editForm.partner_type !== 'channel_partner' && (
                    <>
                        <div className="col-md-6">
                            <label className="form-label fw-semibold d-block">NTTN Type</label>
                            {['D2D', 'OHF', 'Longhaul'].map((item) => {
                                const checked = splitCsv(editForm.nttn_type).includes(item);
                                return (
                                    <div key={item} className="form-check form-check-inline">
                                        <input
                                            className="form-check-input"
                                            type="checkbox"
                                            id={`nttn_${item}`}
                                            checked={checked}
                                            onChange={() => toggleCsvValue('nttn_type', item)}
                                        />
                                        <label className="form-check-label" htmlFor={`nttn_${item}`}>{item}</label>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="col-md-6">
                            <label className="form-label fw-semibold d-block">Connection Type</label>
                            {['Speed Net', 'L3'].map((item) => {
                                const checked = splitCsv(editForm.connection_type).includes(item);
                                return (
                                    <div key={item} className="form-check form-check-inline">
                                        <input
                                            className="form-check-input"
                                            type="checkbox"
                                            id={`con_${item}`}
                                            checked={checked}
                                            onChange={() => toggleCsvValue('connection_type', item)}
                                        />
                                        <label className="form-check-label" htmlFor={`con_${item}`}>{item}</label>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                <div className="col-12 text-end">
                    <button type="button" className="btn btn-light me-2" onClick={onClose}>Close</button>
                    <button className="btn btn-primary" disabled={saving}>
                        {saving ? 'Saving...' : 'Update'}
                    </button>
                </div>
            </form>
        </ModalWrap>
    );
};

export default EditProfileModal;
