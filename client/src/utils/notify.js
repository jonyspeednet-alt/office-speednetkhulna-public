import { toast } from 'react-hot-toast';

/**
 * Unified feedback helper — wraps react-hot-toast so every page gives
 * consistent success/error/info feedback (replaces window.alert and
 * ad-hoc message state). The global <Toaster /> lives in App.jsx.
 */
const baseStyle = {
  borderRadius: '12px',
  fontWeight: 600,
};

export const notify = {
  success: (msg, opts = {}) =>
    toast.success(msg, { duration: 3000, style: baseStyle, ...opts }),
  error: (msg, opts = {}) =>
    toast.error(msg, { duration: 4000, style: baseStyle, ...opts }),
  info: (msg, opts = {}) =>
    toast(msg, { duration: 3000, style: baseStyle, icon: 'ℹ️', ...opts }),
  loading: (msg, opts = {}) => toast.loading(msg, { style: baseStyle, ...opts }),
  dismiss: (id) => toast.dismiss(id),
};

export default notify;
