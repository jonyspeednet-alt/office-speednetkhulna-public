export const toneBadge = (tone) => `badge bg-${tone}-subtle text-${tone}-emphasis`;

export const toneFor = (map, value) => map[String(value || '').toLowerCase()] || 'secondary';

export const formatStatusLabel = (value) => String(value || '-').replace(/_/g, ' ');

export const getWarrantyMeta = (endDate) => {
  const raw = String(endDate || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  const days = Math.ceil((date.getTime() - Date.now()) / 86400000);
  if (days < 0) return { tone: 'danger', label: 'Expired' };
  if (days <= 30) return { tone: 'warning', label: `${days} day${days === 1 ? '' : 's'} left` };
  return { tone: 'success', label: `${days} days left` };
};

export const apiErrorMessage = (error, fallback) => (
  error?.response?.data?.detail || error?.response?.data?.message || error?.message || fallback
);

export const getDeskFloorLabel = (desk) => {
  if (desk?.office_code && String(desk.office_code).toUpperCase() !== 'HQ') {
    return 'Main Area';
  }
  if (desk?.floor_label) return String(desk.floor_label);

  const floorSources = [desk?.location_note, desk?.office_name, desk?.office_code]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  for (const source of floorSources) {
    const match = source.match(/\b(ground|gf|g\.?\s*floor|[0-9]{1,2}(?:st|nd|rd|th)?\s*floor|level\s*[0-9]{1,2}|l\s*[0-9]{1,2})\b/i);
    if (!match) continue;
    const token = match[0].replace(/\s+/g, ' ').trim();
    if (/^ground|^gf|^g\.?\s*floor/i.test(token)) return 'Ground Floor';
    if (/^level/i.test(token)) return token.replace(/^level/i, 'Level');
    if (/^l\s*[0-9]/i.test(token)) return token.toUpperCase();
    return token.replace(/\bfloor\b/i, 'Floor');
  }

  return 'Unspecified Floor';
};

export const floorSortKey = (label) => {
  if (/^main area$/i.test(label)) return 0;
  if (/^ground floor$/i.test(label)) return -1;
  const numericMatch = label.match(/[0-9]{1,2}/);
  if (numericMatch) return Number(numericMatch[0]);
  return 999;
};

export const getDeskOccupantLabel = (desk) => {
  if (!desk?.assigned_user_id) return 'Unassigned';
  const designation = String(desk?.assigned_user_designation || '').trim();
  const department = String(desk?.assigned_user_department || '').trim();
  if (designation && department) return `${designation} (${department})`;
  return designation || department || String(desk?.assigned_user_name || 'Assigned User');
};

export const getDeskUserName = (desk) => {
  if (!desk?.assigned_user_id) return 'Unassigned';
  const assignedName = String(desk?.assigned_user_name || '').trim();
  if (assignedName) return assignedName;
  const deskLabel = String(desk?.desk_label || '').trim();
  return deskLabel || 'Assigned User';
};

export const getDeskRoleLabel = (desk) => {
  if (!desk?.assigned_user_id) return 'Open desk';
  const designation = String(desk?.assigned_user_designation || '').trim();
  const department = String(desk?.assigned_user_department || '').trim();
  if (designation && department) return `${designation} (${department})`;
  return designation || department || 'Role not set';
};

export const getDeskNoSortValue = (deskNo) => {
  const normalized = String(deskNo || '').trim();
  const numeric = normalized.match(/[0-9]+/);
  if (!numeric) return Number.POSITIVE_INFINITY;
  return Number(numeric[0]);
};
