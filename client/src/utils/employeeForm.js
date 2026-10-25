import { normalizeOfficeName } from '../constants/branches.js';

const profileFields = [
  'full_name', 'father_name', 'designation', 'department', 'email', 'phone',
  'emergency_phone', 'blood_group', 'nid_number', 'joining_date',
  'present_address', 'permanent_address', 'reporting_manager',
  'work_location', 'employment_type',
];

export const normalizeEmployeeForm = (employee) => ({
  ...employee,
  role: employee.role_name || employee.role || '',
  blood_group: String(employee.blood_group || '').trim().toUpperCase(),
  work_location: normalizeOfficeName(employee.work_location),
  status: ['active', 'inactive'].includes(String(employee.status || '').toLowerCase())
    ? String(employee.status).toLowerCase() === 'active' ? 'Active' : 'Inactive'
    : employee.status || '',
});

// Send editable changes only. Display metadata and unchanged stale values must
// never become writes, particularly role_id and private fields masked by the API.
export const buildEmployeeUpdate = (form, initial, { canEditProfile, canManageAccount, isOwnProfile }) => {
  const data = new FormData();
  const fields = canEditProfile
    ? profileFields.filter((field) => field !== 'work_location' || canManageAccount)
    : [];
  if (canManageAccount && !isOwnProfile) fields.push('employee_id', 'role', 'status');
  for (const key of fields) {
    // Cleared fields send '' and rely on server ''→null coercion for explicit-null clearing.
    const value = form[key] ?? '';
    // Clearing joining_date is a silent server no-op (server keeps old), so skip it.
    if (key === 'joining_date' && !value && initial?.[key]) continue;
    if (String(value) !== String(initial?.[key] ?? '')) data.append(key, value);
  }
  if (canEditProfile) {
    for (const key of ['profile_pic', 'nid_pic']) {
      if (form[key] instanceof File) data.append(key, form[key]);
    }
  }
  if (canManageAccount && !isOwnProfile && form.password) data.append('password', form.password);
  return data;
};
