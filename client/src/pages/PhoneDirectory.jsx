import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getPhones, getUsers, addPhone, updatePhone, deletePhone, exportPhonesCSV } from '../services/phoneDirectoryService';
import { Modal, Button } from 'react-bootstrap';
import { buildAvatarDataUri } from '../utils/imagePaths';
import { confirmAction } from '../utils/confirm';
import { notify } from '../utils/notify';
import { t } from '../i18n';

const PhoneDirectory = () => {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(handler);
  }, [search]);

  const { data: phoneData, isLoading: loading } = useQuery({
    queryKey: ['phones', page, debouncedSearch],
    queryFn: () => getPhones(page, debouncedSearch),
    placeholderData: (prev) => prev,
  });

  const phones = phoneData?.phones || [];
  const totalPages = phoneData?.totalPages || 1;
  const totalRecords = phoneData?.totalRecords || 0;

  const { data: users = [] } = useQuery({
    queryKey: ['directoryUsers'],
    queryFn: getUsers,
  });

  const [showModal, setShowModal] = useState(false);
  const [isEdit, setIsEdit] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    id: '', desk_name: '', assign_to: '', extension: '', phone_number: '', device_model: '', ip_address: ''
  });

  const deleteMutation = useMutation({
    mutationFn: deletePhone,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phones'] });
      notify.success(t('phoneDirectory.deleted'));
    },
    onError: () => notify.error(t('phoneDirectory.deleteFailed'))
  });

  const upsertMutation = useMutation({
    mutationFn: (data) => isEdit ? updatePhone(data.id, data) : addPhone(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['phones'] });
      notify.success(isEdit ? t('phoneDirectory.updated') : t('phoneDirectory.added'));
      setShowModal(false);
    },
    onError: () => notify.error(t('phoneDirectory.operationFailed'))
  });

  const handleDelete = async (id) => {
    if (await confirmAction({ title: t('phoneDirectory.deleteConfirm'), danger: true })) {
      deleteMutation.mutate(id);
    }
  };

  const handleModalSubmit = (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!formData.assign_to || !String(formData.phone_number).trim()) return;
    upsertMutation.mutate(formData);
  };

  const openAddModal = () => {
    setIsEdit(false);
    setSubmitted(false);
    setFormData({ id: '', desk_name: '', assign_to: '', extension: '', phone_number: '', device_model: '', ip_address: '' });
    setShowModal(true);
  };

  const openEditModal = (phone) => {
    setIsEdit(true);
    setSubmitted(false);
    setFormData({
      id: phone.id,
      desk_name: phone.desk_name,
      assign_to: phone.assign_to,
      extension: phone.extension,
      phone_number: phone.phone_number,
      device_model: phone.device_model,
      ip_address: phone.ip_address
    });
    setShowModal(true);
  };

  const fromRecord = totalRecords === 0 ? 0 : ((page - 1) * 10) + 1;
  const toRecord = Math.min(page * 10, totalRecords);

  return (
    <div className="container-fluid p-4">
      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-center mb-4 gap-3">
        <div>
          <h3 className="fw-bold mb-1">{t('phoneDirectory.title')}</h3>
          <p className="text-muted small mb-0">{t('phoneDirectory.subtitle')}</p>
        </div>

        <div className="d-flex gap-2 align-items-center d-print-none">
          <form onSubmit={(e) => e.preventDefault()} className="d-flex">
            <div className="input-group">
              <span className="input-group-text bg-white border-end-0 rounded-start-pill ps-3"><i className="fas fa-search text-muted"></i></span>
              <input
                type="text"
                className="form-control border-start-0 rounded-end-pill"
                placeholder={t('phoneDirectory.search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </form>
          <button onClick={() => exportPhonesCSV(search)} className="btn btn-success shadow-sm rounded-circle p-2" title={t('phoneDirectory.downloadCsv')}><i className="fas fa-file-csv"></i></button>
          <button onClick={() => window.print()} className="btn btn-light shadow-sm rounded-circle p-2" title={t('phoneDirectory.print')}><i className="fas fa-print text-secondary"></i></button>
          <button className="btn btn-primary px-4 shadow-sm rounded-pill fw-bold text-nowrap" onClick={openAddModal}><i className="fas fa-plus me-2"></i> {t('phoneDirectory.new')}</button>
        </div>
      </div>

      <div className="ui-card p-4">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <thead>
              <tr>
                <th>{t('phoneDirectory.deskName')}</th>
                <th>{t('phoneDirectory.assignTo')}</th>
                <th>{t('phoneDirectory.ext')}</th>
                <th>{t('phoneDirectory.phoneNumber')}</th>
                <th>{t('phoneDirectory.deviceModel')}</th>
                <th>{t('phoneDirectory.ipAddress')}</th>
                <th className="text-end d-print-none">{t('phoneDirectory.action')}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={`sk-${i}`}>
                    {[...Array(7)].map((__, c) => (
                      <td key={c}><span className="ui-skeleton ui-skeleton-line" /></td>
                    ))}
                  </tr>
                ))
              ) : phones.length === 0 ? (
                <tr>
                  <td colSpan="7">
                    <div className="ui-empty">
                      <i className="fas fa-phone-slash ui-empty-icon"></i>
                      <span className="ui-empty-title">{t('phoneDirectory.noData')}</span>
                    </div>
                  </td>
                </tr>
              ) : (
                phones.map((phone) => (
                  <tr key={phone.id}>
                    <td className="fw-bold text-dark">{phone.desk_name}</td>
                    <td>
                      {phone.full_name ? (
                        <div className="d-flex align-items-center">
                          <img
                            src={phone.profile_pic ? `/uploads/${phone.profile_pic}` : buildAvatarDataUri(phone.full_name)}
                            className="rounded-circle me-2 border border-white shadow-sm"
                            style={{ width: '35px', height: '35px', objectFit: 'cover' }}
                            alt={t('phoneDirectory.profileAlt')}
                          />
                          <div>
                            <div className="fw-bold small">{phone.full_name}</div>
                            <div className="text-muted" style={{ fontSize: '10px' }}>{phone.designation}</div>
                          </div>
                        </div>
                      ) : (
                        <span className="text-muted">{t('phoneDirectory.unassigned')}</span>
                      )}
                    </td>
                    <td><span className="badge bg-light text-primary fw-bold px-2 py-1 rounded">{phone.extension}</span></td>
                    <td>{phone.phone_number || '-'}</td>
                    <td className="small text-muted">{phone.device_model || '-'}</td>
                    <td className="small text-muted">{phone.ip_address || '-'}</td>
                    <td className="text-end d-print-none">
                      <button className="btn btn-sm btn-warning bg-opacity-10 text-warning border-0 me-1" onClick={() => openEditModal(phone)} title={t('phoneDirectory.edit') || 'Edit'} aria-label={t('phoneDirectory.edit') || 'Edit'}>
                        <i className="fas fa-edit" aria-hidden="true"></i>
                      </button>
                      <button className="btn btn-sm btn-danger bg-opacity-10 text-danger border-0" onClick={() => handleDelete(phone.id)} title={t('phoneDirectory.delete') || 'Delete'} aria-label={t('phoneDirectory.delete') || 'Delete'}>
                        <i className="fas fa-trash" aria-hidden="true"></i>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="d-flex justify-content-between align-items-center pt-3 border-top d-print-none">
            <div className="text-muted small">
              {t('phoneDirectory.showing', { from: fromRecord, to: toRecord, total: totalRecords })}
            </div>
            <nav>
              <ul className="pagination pagination-sm mb-0">
                <li className={`page-item ${page <= 1 ? 'disabled' : ''}`}>
                  <button className="page-link rounded-start-pill" onClick={() => setPage(page - 1)}>{t('phoneDirectory.previous')}</button>
                </li>
                {[...Array(totalPages)].map((_, i) => (
                  <li key={i + 1} className={`page-item ${page === i + 1 ? 'active' : ''}`}>
                    <button className="page-link" onClick={() => setPage(i + 1)}>{i + 1}</button>
                  </li>
                ))}
                <li className={`page-item ${page >= totalPages ? 'disabled' : ''}`}>
                  <button className="page-link rounded-end-pill" onClick={() => setPage(page + 1)}>{t('phoneDirectory.next')}</button>
                </li>
              </ul>
            </nav>
          </div>
        )}
      </div>

      <Modal show={showModal} onHide={() => setShowModal(false)} centered>
        <Modal.Header closeButton className="border-0 px-4 pt-4">
          <Modal.Title className="fw-bold">{isEdit ? t('phoneDirectory.modalUpdateTitle') : t('phoneDirectory.modalAddTitle')}</Modal.Title>
        </Modal.Header>
        <Modal.Body className="px-4">
          <form onSubmit={handleModalSubmit}>
            <div className="mb-3">
              <label htmlFor="pd-desk-name" className="form-label small fw-bold text-muted">{t('phoneDirectory.deskName')}</label>
              <input id="pd-desk-name" type="text" className="form-control rounded-3" value={formData.desk_name} onChange={(e) => setFormData({ ...formData, desk_name: e.target.value })} placeholder={t('phoneDirectory.deskNamePlaceholder')} />
            </div>
            <div className="mb-3">
              <label htmlFor="pd-assign-to" className="form-label small fw-bold text-muted ui-required">{t('phoneDirectory.assignTo')}</label>
              <select id="pd-assign-to" className={`form-select rounded-3 ${submitted && !formData.assign_to ? 'is-invalid' : ''}`} value={formData.assign_to} onChange={(e) => setFormData({ ...formData, assign_to: e.target.value })} required>
                <option value="">{t('phoneDirectory.selectUser')}</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name} ({u.designation})</option>
                ))}
              </select>
              {submitted && !formData.assign_to && (
                <div className="invalid-feedback">{t('phoneDirectory.selectUser')}</div>
              )}
            </div>
            <div className="row g-3 mb-3">
              <div className="col-6">
                <label className="form-label small fw-bold text-muted">{t('phoneDirectory.extension')}</label>
                <input type="text" className="form-control rounded-3" value={formData.extension} onChange={(e) => setFormData({ ...formData, extension: e.target.value })} placeholder={t('phoneDirectory.extensionPlaceholder')} />
              </div>
              <div className="col-6">
                <label htmlFor="pd-phone" className="form-label small fw-bold text-muted ui-required">{t('phoneDirectory.phoneNumber')}</label>
                <input id="pd-phone" type="text" className={`form-control rounded-3 ${submitted && !String(formData.phone_number).trim() ? 'is-invalid' : ''}`} value={formData.phone_number} onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })} required />
              </div>
            </div>
            <div className="row g-3 mb-3">
              <div className="col-6">
                <label className="form-label small fw-bold text-muted">{t('phoneDirectory.deviceModel')}</label>
                <input type="text" className="form-control rounded-3" value={formData.device_model} onChange={(e) => setFormData({ ...formData, device_model: e.target.value })} />
              </div>
              <div className="col-6">
                <label className="form-label small fw-bold text-muted">{t('phoneDirectory.ipAddress')}</label>
                <input type="text" className="form-control rounded-3" value={formData.ip_address} onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })} />
              </div>
            </div>
            <div className="text-end pb-2">
              <Button variant="light" className="rounded-pill me-2" onClick={() => setShowModal(false)}>{t('phoneDirectory.close')}</Button>
              <Button type="submit" variant="primary" className="rounded-pill px-4" disabled={upsertMutation.isPending}>
                {upsertMutation.isPending && <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>}
                {isEdit ? t('phoneDirectory.update') : t('phoneDirectory.save')}
              </Button>
            </div>
          </form>
        </Modal.Body>
      </Modal>
    </div>
  );
};

export default PhoneDirectory;
