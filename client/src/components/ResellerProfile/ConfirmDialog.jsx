import React from 'react';
import ModalWrap from './ModalWrap';

const ConfirmDialog = ({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onCancel, variant = 'danger' }) => (
  <ModalWrap title={title || 'Confirm'} onClose={onCancel} size="sm">
    <p className="mb-4" style={{ fontSize: '0.95rem' }}>{message}</p>
    <div className="d-flex justify-content-end gap-2">
      <button type="button" className="btn btn-light border rounded-pill px-4" onClick={onCancel}>{cancelLabel}</button>
      <button type="button" className={`btn btn-${variant} rounded-pill px-4 fw-bold`} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </ModalWrap>
);

export default ConfirmDialog;
