const pool = require('../utilities/db');

/**
 * Get My Leaves
 * Replaces logic in my_leaves.php
 */
const getMyLeaves = async (req, res) => {
  try {
    const userId = req.user.id; // From auth middleware
    const query = `
      SELECT lr.*, lt.name as leave_name 
      FROM leave_requests lr 
      JOIN leave_types lt ON lr.leave_type_id = lt.id 
      WHERE lr.user_id = $1 
      ORDER BY lr.applied_at DESC
    `;
    const result = await pool.query(query, [userId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching my leaves:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { getMyLeaves };