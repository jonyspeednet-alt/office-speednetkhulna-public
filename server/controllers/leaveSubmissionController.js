const pool = require('../utilities/db');
const { getYearlyQuota, calcHolidayMonthCap, getCleanDays } = require('../utilities/leaveUtils');

/**
 * Submit Leave Request
 * Replaces: submit_leave.php
 */
const submitLeave = async (req, res) => {
  // Validate BEFORE checking out a pool client — every early return below
  // a connect() would otherwise leak the client permanently (pool drain).
  const { reason, items } = req.body; // Expecting items as an array of objects

  if (!items || items.length === 0) {
    return res.status(400).json({ message: 'At least one leave line is required.' });
  }

  const client = await pool.connect();

  try {
    // 1. Basic Data Collection
    const userId = req.user.id; // From auth middleware

    await client.query('BEGIN'); // Start Transaction

    // 2. Fetch User's Weekly Off-Day & Joining Date
    const userRes = await client.query('SELECT weekly_off, joining_date FROM users WHERE id = $1', [userId]);
    const weeklyOff = userRes.rows[0]?.weekly_off || 'Friday';
    const joiningDate = userRes.rows[0]?.joining_date;
    const jd = joiningDate ? new Date(joiningDate) : null;
    const joinMonth = jd ? jd.getMonth() + 1 : 1;
    const joinYear = jd ? jd.getFullYear() : 2026;

    // Pre-processing containers
    const processedItems = [];
    const holidayRequestedByYearMonth = {}; // "YYYY-MM" => days
    const festivalRequestedByYear = {};     // "YYYY" => days
    const holidayRequestedByYear = {};      // "YYYY" => days

    // 3. Process Each Line Item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const leaveTypeId = parseInt(item.leave_type_id);
      const startDate = item.start_date;
      const endDate = item.end_date;
      
      // Validation
      if (!leaveTypeId || !startDate || !endDate) {
        throw new Error(`Line ${i + 1}: Missing leave type or dates.`);
      }

      const halfDayPeriod = (leaveTypeId === 3 && item.half_day_period) ? item.half_day_period : null;
      
      const startObj = new Date(startDate);
      const appliedYear = startObj.getFullYear();
      const appliedMonth = startObj.getMonth() + 1; // 1-12
      const yearMonthKey = `${appliedYear}-${appliedMonth}`;

      // Calculate Requested Days
      let requestedDays = 0;
      if (leaveTypeId === 3) {
        requestedDays = 0.5;
      } else {
        requestedDays = getCleanDays(startDate, endDate, weeklyOff);
      }

      if (requestedDays <= 0) {
        throw new Error(`Line ${i + 1}: Selected dates fall on your off-day (${weeklyOff}).`);
      }

      // Check Overlap
      const overlapQuery = `
        SELECT COUNT(*) FROM leave_requests 
        WHERE user_id = $1 AND status != 'Rejected' 
        AND (start_date <= $2 AND end_date >= $3)
      `;
      const overlapRes = await client.query(overlapQuery, [userId, endDate, startDate]);
      if (parseInt(overlapRes.rows[0].count) > 0) {
        throw new Error(`Line ${i + 1}: Overlaps with an existing leave request.`);
      }

      // Aggregate for Quota Checks
      if (leaveTypeId === 1) { // Holiday
        holidayRequestedByYearMonth[yearMonthKey] = (holidayRequestedByYearMonth[yearMonthKey] || 0) + requestedDays;
        holidayRequestedByYear[appliedYear] = (holidayRequestedByYear[appliedYear] || 0) + requestedDays;
      } else if (leaveTypeId === 2) { // Festival
        festivalRequestedByYear[appliedYear] = (festivalRequestedByYear[appliedYear] || 0) + requestedDays;
      }

      processedItems.push({
        leaveTypeId,
        startDate,
        endDate,
        halfDayPeriod,
        reason,
        requestedDays
      });
    }

    // 4. Holiday Quota Check (Monthly Accumulation)
    // Logic: Allowed = MonthIndex (e.g., 3 for March) - UsedPreviousMonths
    for (const [ym, reqDays] of Object.entries(holidayRequestedByYearMonth)) {
      const [y, m] = ym.split('-').map(Number);

      // Calculate Used Previous
      const prevQuery = `
        SELECT start_date, end_date FROM leave_requests 
        WHERE user_id = $1 AND leave_type_id = 1 AND status != 'Rejected' 
        AND EXTRACT(YEAR FROM start_date) = $2 AND EXTRACT(MONTH FROM start_date) < $3
      `;
      const prevRes = await client.query(prevQuery, [userId, y, m]);
      
      let usedPrev = 0;
      prevRes.rows.forEach(row => {
        usedPrev += getCleanDays(row.start_date, row.end_date, weeklyOff);
      });

      const monthsEmployed = Math.max(0, m - joinMonth);
      const allowedThisMonth = Math.max(0, monthsEmployed - usedPrev);

      // Calculate Used This Month
      const monthQuery = `
        SELECT start_date, end_date FROM leave_requests 
        WHERE user_id = $1 AND leave_type_id = 1 AND status != 'Rejected' 
        AND EXTRACT(MONTH FROM start_date) = $2 AND EXTRACT(YEAR FROM start_date) = $3
      `;
      const monthRes = await client.query(monthQuery, [userId, m, y]);
      
      let usedMonth = 0;
      monthRes.rows.forEach(row => {
        usedMonth += getCleanDays(row.start_date, row.end_date, weeklyOff);
      });

      if ((usedMonth + reqDays) > allowedThisMonth) {
        console.warn(`User ${userId}: Holiday month cap advisory - ${usedMonth + reqDays} > ${allowedThisMonth} for ${ym}. Allowing (yearly cap will enforce).`);
      }
    }

    // 5. Festival Quota Check (Yearly Limit: 8)
    for (const [year, reqDays] of Object.entries(festivalRequestedByYear)) {
      const festQuery = `
        SELECT start_date, end_date FROM leave_requests 
        WHERE user_id = $1 AND leave_type_id = 2 AND status != 'Rejected' 
        AND EXTRACT(YEAR FROM start_date) = $2
      `;
      const festRes = await client.query(festQuery, [userId, year]);
      
      let usedFest = 0;
      festRes.rows.forEach(row => {
        usedFest += getCleanDays(row.start_date, row.end_date, weeklyOff);
      });

      if ((usedFest + reqDays) > 8) {
        throw new Error(`Festival quota (8 days) exceeded for year ${year}.`);
      }
    }

    // 6. Holiday Yearly Quota Check (Yearly Limit: 12)
    for (const [year, reqDays] of Object.entries(holidayRequestedByYear)) {
      const holYearQuery = `
        SELECT start_date, end_date FROM leave_requests 
        WHERE user_id = $1 AND leave_type_id = 1 AND status != 'Rejected' 
        AND EXTRACT(YEAR FROM start_date) = $2
      `;
      const holYearRes = await client.query(holYearQuery, [userId, year]);
      
      let usedHolYear = 0;
      holYearRes.rows.forEach(row => {
        usedHolYear += getCleanDays(row.start_date, row.end_date, weeklyOff);
      });

      const maxHolidayYearly = (parseInt(year) === joinYear) ? Math.max(0, 12 - joinMonth) : 12;
      if ((usedHolYear + reqDays) > maxHolidayYearly) {
        throw new Error(`Holiday yearly quota (${maxHolidayYearly} days) exceeded for year ${year}.`);
      }
    }

    // 7. Insert Records
    const appliedAt = new Date();
    const groupId = `GRP-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const insertQuery = `
      INSERT INTO leave_requests (user_id, leave_type_id, start_date, end_date, half_day_period, reason, status, applied_at, group_id) 
      VALUES ($1, $2, $3, $4, $5, $6, 'Pending', $7, $8)
    `;

    for (const item of processedItems) {
      await client.query(insertQuery, [
        userId,
        item.leaveTypeId,
        item.startDate,
        item.endDate,
        item.halfDayPeriod,
        item.reason,
        appliedAt,
        groupId
      ]);
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: 'Leave application submitted successfully.' });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Leave Submission Error:', error);
    // Deliberate validation messages are user-facing (safe prefixes only);
    // anything else (e.g. pool errors) stays generic.
    const msg = String(error.message || "");
    const knownValidation = /^(Line \d+:|Festival quota|Holiday yearly quota)/.test(msg);
    res.status(knownValidation ? 400 : 500).json({
      success: false,
      message: knownValidation ? msg : "Leave request failed. Please try again.",
    });
  } finally {
    client.release();
  }
};

/**
 * Get Data for Leave Application Form
 * Replaces logic in apply_leave.php (fetching quotas, types, etc.)
 */
const getLeaveFormData = async (req, res) => {
  try {
    const userId = req.user.id;
    const currentYear = new Date().getFullYear();
    const nextYear = currentYear + 1;
    const currentMonth = new Date().getMonth() + 1;

    // 1. Fetch User Info & Leave Types
    const userQuery = 'SELECT weekly_off, joining_date FROM users WHERE id = $1';
    const typeQuery = 'SELECT id, name FROM leave_types ORDER BY id ASC';
    
    const [userRes, typeRes] = await Promise.all([
      pool.query(userQuery, [userId]),
      pool.query(typeQuery)
    ]);

    const weeklyOff = userRes.rows[0]?.weekly_off || 'Friday';
    const joiningDate = userRes.rows[0]?.joining_date;
    const joinMonth = joiningDate ? new Date(joiningDate).getMonth() + 1 : 1;
    const leaveTypes = typeRes.rows;

    // 2. Calculate Quotas
    const quotaThisYear = await getYearlyQuota(pool, userId, currentYear, weeklyOff);
    const quotaNextYear = await getYearlyQuota(pool, userId, nextYear, weeklyOff);

    // 3. Fetch Entitlements
    const entQuery = `
      SELECT leave_type_id, total_days, year 
      FROM leave_entitlements 
      WHERE user_id = $1 AND year IN ($2, $3)
    `;
    const entRes = await pool.query(entQuery, [userId, currentYear, nextYear]);
    
    const entitlements = {
      [currentYear]: {},
      [nextYear]: {}
    };

    entRes.rows.forEach(row => {
      const typeName = leaveTypes.find(t => t.id === row.leave_type_id)?.name;
      if (typeName) {
        entitlements[row.year][typeName] = parseFloat(row.total_days);
      }
    });

    // 4. Holiday Cap for Current Month
    const holidayCap = await calcHolidayMonthCap(pool, userId, currentYear, currentMonth, weeklyOff, joinMonth);

    res.json({
      weeklyOff,
      leaveTypes,
      quotaThisYear,
      quotaNextYear,
      entitlements,
      holidayCap,
      years: { current: currentYear, next: nextYear }
    });

  } catch (error) {
    console.error('Leave Form Data Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { submitLeave, getLeaveFormData };