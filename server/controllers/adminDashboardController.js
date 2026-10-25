const pool = require('../utilities/db');
const { isSuperAdmin } = require('../utilities/permissionRegistry');

/**
 * Get Admin Dashboard Data
 * Replaces logic in admin_dashboard.php
 */
const getAdminDashboardData = async (req, res) => {
  try {
    // Role check. Name-based "admin" bypass only applies to legacy users
    // without a role_id — a role_id-linked role must actually be flagged
    // super admin (or carry all_access) to see this dashboard.
    const role = String(req.user?.role || req.user?.role_name || '').toLowerCase();
    const isLegacyAdmin = !req.user?.role_id && role === 'admin';
    if (!isLegacyAdmin && !isSuperAdmin(req.user) && !req.user?.permissions?.all_access) {
      return res.status(403).json({ message: 'Unauthorized' });
    }

    const today = new Date().toISOString().split('T')[0];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayDay = days[new Date().getDay()];

    // 1. Stats Queries
    const pendingQuery = "SELECT COUNT(*) as count FROM leave_requests WHERE status = 'Pending'";
    const onLeaveQuery = "SELECT COUNT(*) as count FROM leave_requests WHERE status = 'Approved' AND $1::date BETWEEN start_date AND end_date";
    const totalStaffQuery = "SELECT COUNT(*) as count FROM users";
    const offDayQuery = "SELECT COUNT(*) as count FROM users WHERE weekly_off = $1";

    // 2. On Leave List Query
    const onLeaveListQuery = `
        SELECT u.full_name, lt.name as leave_type 
        FROM leave_requests lr 
        JOIN users u ON lr.user_id = u.id 
        JOIN leave_types lt ON lr.leave_type_id = lt.id
        WHERE lr.status = 'Approved' AND $1::date BETWEEN lr.start_date AND lr.end_date LIMIT 5
    `;

    // 3. Recent Leaves Query
    const recentLeavesQuery = `
        SELECT lr.*, u.full_name, u.employee_id, u.profile_pic, lt.name as type_name
        FROM leave_requests lr 
        JOIN users u ON lr.user_id = u.id 
        LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
        ORDER BY lr.applied_at DESC LIMIT 6
    `;

    const [
      pendingRes, 
      onLeaveRes, 
      totalStaffRes, 
      offDayRes, 
      onLeaveListRes, 
      recentLeavesRes
    ] = await Promise.all([
      pool.query(pendingQuery),
      pool.query(onLeaveQuery, [today]),
      pool.query(totalStaffQuery),
      pool.query(offDayQuery, [todayDay]),
      pool.query(onLeaveListQuery, [today]),
      pool.query(recentLeavesQuery)
    ]);

    res.json({
      stats: {
        pending: parseInt(pendingRes.rows[0]?.count || 0),
        onLeave: parseInt(onLeaveRes.rows[0]?.count || 0),
        totalStaff: parseInt(totalStaffRes.rows[0]?.count || 0),
        offDay: parseInt(offDayRes.rows[0]?.count || 0)
      },
      onLeaveList: onLeaveListRes.rows,
      recentLeaves: recentLeavesRes.rows
    });

  } catch (error) {
    console.error('Admin Dashboard Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getAdminDashboardData };
