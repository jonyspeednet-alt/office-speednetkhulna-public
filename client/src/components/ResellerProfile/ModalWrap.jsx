import React, { useEffect } from 'react';

const ModalWrap = ({ title, children, onClose, size = "md" }) => {
    const sizeClass = size === "lg" ? "rp-modal-lg" : size === "sm" ? "rp-modal-sm" : "";

    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div
            className="position-fixed top-0 start-0 w-100 h-100 d-flex rp-modal-backdrop"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rp-modal-title"
            onClick={(e) => e.target === e.currentTarget && onClose?.()}
        >
            <div className={`card shadow rp-modal-panel ${sizeClass}`} onClick={(e) => e.stopPropagation()}>
                <div className="card-header d-flex justify-content-between align-items-center bg-white">
                    <h6 id="rp-modal-title" className="m-0 fw-bold">{title}</h6>
                    <button type="button" className="btn btn-sm btn-light rounded-circle flex-shrink-0" onClick={onClose} aria-label="Close">
                        <i className="fas fa-times" />
                    </button>
                </div>
                <div className="card-body">{children}</div>
            </div>
        </div>
    );
};

export default ModalWrap;
