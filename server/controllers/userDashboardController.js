const pool = require('../utilities/db');
const { getYearlyQuota } = require('../utilities/leaveUtils');

/**
 * Get User Dashboard Data
 * Provides data for the main user dashboard, including leave quotas.
 */
const getUserDashboardData = async (req, res) => {
  try {
    const userId = req.user.id;
    const currentYear = new Date().getFullYear();
    const today = new Date().toISOString().split('T')[0];

    const onLeaveListQuery = `
      SELECT u.full_name, lt.name as leave_type, u.profile_pic
      FROM leave_requests lr
      JOIN users u ON lr.user_id = u.id
      JOIN leave_types lt ON lr.leave_type_id = lt.id
      WHERE lr.status = 'Approved' AND $1::date BETWEEN lr.start_date AND lr.end_date
      ORDER BY u.full_name
    `;

    // Fetch user info and entitlements in parallel
    const [userRes, entRes, onLeaveListRes] = await Promise.all([
      pool.query('SELECT weekly_off FROM users WHERE id = $1', [userId]),
      pool.query(
        `SELECT lt.name, le.total_days
         FROM leave_entitlements le
         JOIN leave_types lt ON le.leave_type_id = lt.id
         WHERE le.user_id = $1 AND le.year = $2`,
        [userId, currentYear],
      ),
      pool.query(onLeaveListQuery, [today]),
    ]);

    const weeklyOff = userRes.rows[0]?.weekly_off || 'Friday';
    const quotaUsage = await getYearlyQuota(pool, userId, currentYear, weeklyOff);

    const entitlements = {};
    entRes.rows.forEach(row => {
      entitlements[row.name] = parseFloat(row.total_days);
    });

    // Leave Planner Overview: previous, current, next month
    const date = new Date();
    const months = [
      { key: 'prev', d: new Date(date.getFullYear(), date.getMonth() - 1, 1) },
      { key: 'curr', d: new Date(date.getFullYear(), date.getMonth(), 1) },
      { key: 'next', d: new Date(date.getFullYear(), date.getMonth() + 1, 1) }
    ];

    // B8: local calendar fields — toISOString() would shift the 1st back a day
    // under Asia/Dhaka and misalign the range/planner keys by a month.
    const ymdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    // Single query covering all 3 months instead of 3 sequential queries
    const rangeStart = ymdLocal(months[0].d);
    const rangeEnd   = ymdLocal(new Date(date.getFullYear(), date.getMonth() + 2, 1));

    const planRes = await pool.query(
      `SELECT
         TO_CHAR(start_date, 'YYYY-MM') AS ym,
         SUM(CASE WHEN leave_type_id = 3 THEN 0.5
                  ELSE DATE_PART('day', end_date::timestamp - start_date::timestamp) + 1
             END) AS total_days
       FROM leave_requests
       WHERE user_id = $1
         AND status = 'Approved'
         AND start_date >= $2::date
         AND start_date <  $3::date
       GROUP BY TO_CHAR(start_date, 'YYYY-MM')`,
      [userId, rangeStart, rangeEnd],
    );

    const spentByMonth = {};
    for (const row of planRes.rows) spentByMonth[row.ym] = parseFloat(row.total_days || 0);

    const plannerData = {};
    for (const m of months) {
      const ym = ymdLocal(m.d).slice(0, 7);
      plannerData[m.key] = {
        month_name: m.d.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
        spent: spentByMonth[ym] || 0,
      };
    }

    res.json({ quotaUsage, entitlements, plannerData, onLeaveList: onLeaveListRes.rows });

  } catch (error) {
    console.error('User Dashboard Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getUserDashboardData };