export default function Modal({ title, onClose, children, size = '' }) {
  return (
    <>
      <div
        className="modal fade show d-block"
        tabIndex="-1"
        style={{ background: 'rgba(0,0,0,0.4)' }}
        onClick={onClose}
      >
        <div
          className={`modal-dialog modal-dialog-centered ${size}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-content border-0 shadow">
            <div className="modal-header border-0">
              <h5 className="modal-title fw-bold">{title}</h5>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body p-4">{children}</div>
          </div>
        </div>
      </div>
    </>
  );
}
