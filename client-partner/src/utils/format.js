export const fmt = (n, d = 2) =>
  Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

export const fmtDate = (value, opts) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(
    'en-GB',
    opts || { day: '2-digit', month: 'short', year: 'numeric' },
  );
};

export const fmtDateTime = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const statusBn = (s) =>
  ({ pending: 'অপেক্ষমান', approved: 'অনুমোদিত', rejected: 'বাতিল', implemented: 'বাস্তবায়িত' }[
    String(s || '').toLowerCase()
  ] || s || '');
