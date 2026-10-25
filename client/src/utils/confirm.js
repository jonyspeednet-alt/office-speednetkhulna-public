import Swal from 'sweetalert2';

/**
 * Branded confirmation dialog — replaces native window.confirm().
 * Returns a Promise<boolean> (true if confirmed).
 *
 * @param {Object} opts
 * @param {string} opts.title        - main heading
 * @param {string} [opts.text]       - supporting text
 * @param {string} [opts.confirmText]- confirm button label
 * @param {string} [opts.cancelText] - cancel button label
 * @param {boolean}[opts.danger]     - red confirm button for destructive actions
 * @param {string} [opts.icon]       - Swal icon (default 'warning')
 */
export async function confirmAction({
  title,
  text = '',
  confirmText = 'Yes',
  cancelText = 'Cancel',
  danger = false,
  icon = 'warning',
} = {}) {
  const result = await Swal.fire({
    title,
    text,
    icon,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    reverseButtons: true,
    focusCancel: danger,
    confirmButtonColor: danger ? '#ef4444' : '#2563eb',
    cancelButtonColor: '#94a3b8',
    heightAuto: false,
    didOpen: () => {
      const c = document.querySelector('.swal2-container');
      if (c) c.style.zIndex = '10000';
    },
  });
  return result.isConfirmed;
}

export default confirmAction;
