/**
 * Calculates the number of working days between two dates, excluding a specific weekly off-day.
 * @param {string} startStr The start date (YYYY-MM-DD).
 * @param {string} endStr The end date (YYYY-MM-DD).
 * @param {string} weeklyOffDay The name of the weekly off-day (e.g., 'Friday').
 * @returns {number} The number of working days.
 */
const getCleanDays = (startStr, endStr, weeklyOffDay) => {
  try {
    const start = new Date(startStr);
    const end = new Date(endStr);
    
    // Normalize to logical midnight (local to the system)
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    if (end < start) return 0;

    let days = 0;
    const current = new Date(start);

    while (current <= end) {
      const dayName = getDayName(current);
      if (dayName !== weeklyOffDay) {
        days++;
      }
      current.setDate(current.getDate() + 1);
    }
    return days;
  } catch (e) {
    return 0;
  }
};

const getDayName = (date) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
};

/**
 * Calculates the yearly quota summary for a specific user for a given year.
 * @param {object} pool The database connection pool.
 * @param {number} userId The ID of the user.
 * @param {number} year The year to calculate the quota for.
 * @param {string} offDay The user's weekly off-day.
 * @returns {Promise<object>} An object with the summary of used leave days for each type.
 */
const getYearlyQuota = async (pool, userId, year, offDay) => {
  const summary = { 'Holiday': 0, 'Festival': 0, 'Half Day': 0, 'Unpaid': 0 };

  const sql = `
    SELECT lt.name as leave_type_name, lr.start_date, lr.end_date, lr.leave_type_id 
    FROM leave_requests lr
    JOIN leave_types lt ON lr.leave_type_id = lt.id
    WHERE lr.user_id = $1 AND lr.status != 'Rejected' AND EXTRACT(YEAR FROM lr.start_date) = $2
  `;
  
  const result = await pool.query(sql, [userId, year]);

  for (const leave of result.rows) {
    if (parseInt(leave.leave_type_id) === 3) { // Half Day
      summary['Half Day'] += 0.5;
    } else {
      const daysCount = getCleanDays(leave.start_date, leave.end_date, offDay);
      if (summary.hasOwnProperty(leave.leave_type_name)) {
        summary[leave.leave_type_name] += daysCount;
      }
    }
  }
  
  return summary;
};

/**
 * Calculates the monthly holiday leave cap.
 * @returns {Promise<object>} { cap, used, remain }
 */
const calcHolidayMonthCap = async (pool, userId, year, month, offDay, joinMonth = 1) => {
  const prevQuery = `SELECT start_date, end_date FROM leave_requests WHERE user_id = $1 AND status != 'Rejected' AND leave_type_id = 1 AND EXTRACT(YEAR FROM start_date) = $2 AND EXTRACT(MONTH FROM start_date) < $3`;
  const monthQuery = `SELECT start_date, end_date FROM leave_requests WHERE user_id = $1 AND status != 'Rejected' AND leave_type_id = 1 AND EXTRACT(YEAR FROM start_date) = $2 AND EXTRACT(MONTH FROM start_date) = $3`;

  const prevRes = await pool.query(prevQuery, [userId, year, month]);
  const monthRes = await pool.query(monthQuery, [userId, year, month]);

  const usedPrev = prevRes.rows.reduce((sum, row) => sum + getCleanDays(row.start_date, row.end_date, offDay), 0);
  const usedMonth = monthRes.rows.reduce((sum, row) => sum + getCleanDays(row.start_date, row.end_date, offDay), 0);

  const monthsEmployed = Math.max(0, month - joinMonth);
  const cap = Math.max(0, monthsEmployed - usedPrev);
  const remain = Math.max(0, cap - usedMonth);

  return { cap, used: usedMonth, remain };
};

module.exports = { getCleanDays, getYearlyQuota, calcHolidayMonthCap, getDayName };