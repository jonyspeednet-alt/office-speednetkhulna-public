const pool = require('../utilities/db');
const { resolvePermission } = require('../utilities/permissionRegistry');

/**
 * Get Leave Events for Calendar
 * Replaces logic in get_leave_events.php (implied) and leave_calendar.php
 */
const getLeaveEvents = async (req, res) => {
  try {
    // FullCalendar sends start and end query params (ISO strings)
    const { start, end } = req.query;
    const { id: userId } = req.user;
    const isPrivileged = resolvePermission(req.user, 'leave.manage');
    
    let query = `
      SELECT lr.id, lr.start_date, lr.end_date, lr.reason, lr.status, lr.leave_type_id,
             u.full_name, lt.name as leave_type_name
      FROM leave_requests lr
      JOIN users u ON lr.user_id = u.id
      JOIN leave_types lt ON lr.leave_type_id = lt.id
      WHERE lr.status = 'Approved'
    `;
    
    const params = [];
    let paramIdx = 1;

    // Logic from get_leave_events.php: If not admin, only show current user's leaves
    if (!isPrivileged) {
      query += ` AND lr.user_id = $${paramIdx}`;
      params.push(userId);
      paramIdx++;
    }

    if (start && end) {
      // Filter events overlapping with the view range
      query += ` AND (lr.start_date < $${paramIdx + 1} AND lr.end_date > $${paramIdx})`; 
      params.push(start, end);
      paramIdx += 2;
    }

    const result = await pool.query(query, params);
    
    const events = result.rows.map(row => {
      // FullCalendar end date is exclusive for all-day events.
      // We create a new date object for the calendar end date.
      const endDateForCalendar = new Date(row.end_date);
      endDateForCalendar.setDate(endDateForCalendar.getDate() + 1);
      
      return {
        id: row.id,
        title: `${row.full_name} (${row.leave_type_name})`,
        start: row.start_date, // YYYY-MM-DD
        end: endDateForCalendar.toISOString().split('T')[0], // YYYY-MM-DD (Exclusive)
        allDay: true,
        backgroundColor: '#05cd99',
        borderColor: '#05cd99',
        textColor: 'white',
        extendedProps: {
          employee_name: row.full_name,
          leave_type_name: row.leave_type_name,
          original_end_date: row.end_date, // Inclusive end date for display
          reason: row.reason,
          status: row.status
        }
      };
    });

    res.json(events);

  } catch (error) {
    console.error('Calendar Events Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getLeaveEvents };
