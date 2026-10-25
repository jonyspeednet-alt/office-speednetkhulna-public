const pool = require('../utilities/db');
const { resolvePermission } = require('../utilities/permissionRegistry');

/**
 * Helper: Calculate actual leave days excluding the weekly off-day.
 */
const getCleanDays = (startStr, endStr, weeklyOffDay) => {
  const start = new Date(startStr);
  const end = new Date(endStr);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  if (end < start) return 0;

  let days = 0;
  const current = new Date(start);

  while (current <= end) {
    // Weekday rendered in Asia/Dhaka so the count never shifts with server TZ.
    // (start_date is DATE — EXTRACT bucketing below needs no tz conversion.)
    const dayName = current.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'Asia/Dhaka' });
    if (dayName !== weeklyOffDay) {
      days++;
    }
    current.setDate(current.getDate() + 1);
  }
  return days;
};

/**
 * Get User Profile & Leave History
 * Replaces logic in profile.php
 */
const getUserProfile = async (req, res) => {
  try {
    // Determine target user ID: provided in params or from auth token.
    // Non-integer ids (e.g. /profile/abc → NaN) are a 400, never a PG 500.
    let targetUserId = req.params.id ? parseInt(req.params.id, 10) : req.user.id;
    if (!Number.isInteger(targetUserId)) {
      return res.status(400).json({ message: 'Invalid user ID' });
    }
    const currentUserId = req.user.id;
    const isOwnProfile = targetUserId === currentUserId;

    // IDOR guard: others' profiles need explicit permission
    if (!isOwnProfile) {
      const canViewOthers = resolvePermission(req.user, 'users.manage')
        || resolvePermission(req.user, 'users.edit.any')
        || resolvePermission(req.user, 'p_employees')
        || resolvePermission(req.user, 'employees.view');
      if (!canViewOthers) {
        return res.status(403).json({ message: 'Not allowed to view this profile' });
      }
    }

    // 1. Fetch User Details (explicit allowlist — never SELECT *)
    const userQuery = `SELECT id, employee_id, full_name, father_name, email, phone,
      designation, department, role, role_id,
      (SELECT r.name FROM roles r WHERE r.id = users.role_id) AS role_name,
      status, joining_date, weekly_off, blood_group, work_location, employment_type,
      reporting_manager, nid_number, nid_pic, present_address, permanent_address,
      profile_pic, created_at FROM users WHERE id = $1`;
    const userResult = await pool.query(userQuery, [targetUserId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = userResult.rows[0];
    if (user.role_id && user.role_name) user.role = user.role_name;
    // Never expose secrets/hashes/session state, even to managers.
    delete user.password; // Security: remove password hash
    delete user.token_version; // Security: session-invalidaton counter, not profile data

    // Mask employee_id if viewer doesn't have permission.
    // Visible (blurred or clear) to: own profile, users with 'users.edit.any' OR 'p_employees' permission.
    const canSeeId = isOwnProfile ||
      resolvePermission(req.user, 'users.edit.any') ||
      resolvePermission(req.user, 'p_employees');
    if (!canSeeId) {
      user.employee_id = null;
    }
    // S1/S17 (mirror maskEmployeeRow): never expose NID / addresses of OTHER
    // users to non-managers — nid_pic filename alone enables /uploads access.
    const viewerIsManager = resolvePermission(req.user, 'users.manage');
    if (!isOwnProfile && !viewerIsManager) {
      user.nid_number = null;
      user.nid_pic = null;
      user.present_address = null;
      user.permanent_address = null;
    }

    // 2. Filter Parameters for Leaves (invalid month/year → 400, never a PG 500)
    const { month, year } = req.query;
    const currentYear = new Date().getFullYear();
    if (month !== undefined && month !== '' && !(Number.isInteger(Number(month)) && Number(month) >= 1 && Number(month) <= 12)) {
      return res.status(400).json({ message: 'Invalid month (1-12)', field: 'month' });
    }
    if (year !== undefined && year !== '' && !(Number.isInteger(Number(year)) && Number(year) >= 2000 && Number(year) <= 2100)) {
      return res.status(400).json({ message: 'Invalid year', field: 'year' });
    }
    const filterYear = year || currentYear;
    // Directory/profile visibility does not grant access to private leave
    // reasons and history. Match the leave administration endpoint's grant.
    if (!isOwnProfile && !resolvePermission(req.user, 'leave.manage')) {
      return res.json({ user, leaves: [], filteredTotalDays: 0, filters: { month, year: filterYear } });
    }

    // 3. Fetch Leave History
    let leaveQuery = `
      SELECT lr.*, lt.name as type_name 
      FROM leave_requests lr 
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id 
      WHERE lr.user_id = $1
    `;
    const queryParams = [targetUserId];
    let paramCount = 1;

    if (month) {
      paramCount++;
      leaveQuery += ` AND EXTRACT(MONTH FROM lr.start_date) = $${paramCount}`;
      queryParams.push(Number(month));
    }

    if (filterYear) {
      paramCount++;
      leaveQuery += ` AND EXTRACT(YEAR FROM lr.start_date) = $${paramCount}`;
      queryParams.push(Number(filterYear));
    }

    leaveQuery += ' ORDER BY lr.start_date DESC LIMIT 500';

    const leaveResult = await pool.query(leaveQuery, queryParams);
    const leaves = leaveResult.rows;

    // 4. Calculate Filtered Total Days (Approved only)
    let filteredTotalDays = 0;
    const weeklyOff = user.weekly_off || 'Friday';

    leaves.forEach(leave => {
      if (leave.status === 'Approved') {
        if (parseInt(leave.leave_type_id) === 3) { // Half Day
          filteredTotalDays += 0.5;
        } else {
          filteredTotalDays += getCleanDays(leave.start_date, leave.end_date, weeklyOff);
        }
      }
    });

    res.json({
      user,
      leaves,
      filteredTotalDays,
      filters: { month, year: filterYear }
    });

  } catch (error) {
    console.error('Profile Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getUserProfile };
