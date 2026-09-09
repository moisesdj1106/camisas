import { useEffect } from 'react';

const Modal = ({ open, title, message, children, onClose, onConfirm, confirmLabel = 'Aceptar', cancelLabel = 'Cancelar', tone = 'info' }) => {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className={`modal app-modal app-modal--${tone}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={(event) => event.stopPropagation()}>
        <div className="app-modal__header">
          <h3 id="modal-title">{title}</h3>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Cerrar modal" title="Cerrar">×</button>
        </div>
        {message ? <p className="app-modal__message">{message}</p> : null}
        {children}
        {onConfirm ? (
          <div className="app-modal__actions">
            <button className="ghost-btn" type="button" onClick={onClose}>{cancelLabel}</button>
            <button className="primary-btn" type="button" onClick={onConfirm}>{confirmLabel}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default Modal;
