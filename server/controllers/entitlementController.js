const pool = require('../utilities/db');
const hasPermission = (value) => value === true || value === 1 || value === '1';

/**
 * Get Entitlements Data
 * Fetches users, leave types, and grouped entitlements.
 */
const getEntitlementsData = async (req, res) => {
  try {
    // Permission check
    const { role, role_id, p_manage_leaves, permissions } = req.user;
    const roleLower = (role || '').toLowerCase();
    const isPrivileged = (!role_id && (roleLower === 'admin' || roleLower === 'super admin' || roleLower === 'superadmin')) || (permissions && permissions.all_access);
    const canManageLeaves = isPrivileged || hasPermission(p_manage_leaves) || hasPermission(permissions?.p_manage_leaves);
    if (!canManageLeaves) {
      return res.status(403).json({ message: 'Unauthorized access.' });
    }

    const usersQuery = 'SELECT id, full_name, employee_id FROM users ORDER BY full_name ASC';
    const typesQuery = 'SELECT id, name FROM leave_types ORDER BY name ASC';
    const entQuery = `
      SELECT le.id, le.user_id, le.leave_type_id, le.year, le.total_days, lt.name as leave_type_name 
      FROM leave_entitlements le
      JOIN leave_types lt ON le.leave_type_id = lt.id
      ORDER BY le.year DESC, le.user_id ASC, lt.name ASC
    `;

    const [usersRes, typesRes, entRes] = await Promise.all([
      pool.query(usersQuery),
      pool.query(typesQuery),
      pool.query(entQuery)
    ]);

    // Group entitlements by user_id -> year -> list
    const entitlements = {};
    entRes.rows.forEach(ent => {
      if (!entitlements[ent.user_id]) entitlements[ent.user_id] = {};
      if (!entitlements[ent.user_id][ent.year]) entitlements[ent.user_id][ent.year] = [];
      entitlements[ent.user_id][ent.year].push(ent);
    });

    res.json({
      users: usersRes.rows,
      leaveTypes: typesRes.rows,
      entitlements
    });

  } catch (error) {
    console.error('Get Entitlements Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

const addEntitlement = async (req, res) => {
  try {
    const { user_id, leave_type_id, year, total_days } = req.body;
    // Basic validation
    if (!user_id || !leave_type_id || !year || total_days === undefined) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    const query = `
      INSERT INTO leave_entitlements (user_id, leave_type_id, year, total_days) 
      VALUES ($1, $2, $3, $4) RETURNING *
    `;
    await pool.query(query, [user_id, leave_type_id, year, total_days]);
    
    res.status(201).json({ message: 'Entitlement added successfully.' });
  } catch (error) {
    console.error('Add Entitlement Error:', error);
    res.status(500).json({ message: 'Failed to add entitlement.' });
  }
};

const updateEntitlement = async (req, res) => {
  try {
    const { id } = req.params;
    const { total_days } = req.body;

    const query = `
      UPDATE leave_entitlements 
      SET total_days = $1, updated_at = NOW() 
      WHERE id = $2
    `;
    await pool.query(query, [total_days, id]);

    res.json({ message: 'Entitlement updated successfully.' });
  } catch (error) {
    console.error('Update Entitlement Error:', error);
    res.status(500).json({ message: 'Failed to update entitlement.' });
  }
};

const deleteEntitlement = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM leave_entitlements WHERE id = $1', [id]);
    res.json({ message: 'Entitlement deleted successfully.' });
  } catch (error) {
    console.error('Delete Entitlement Error:', error);
    res.status(500).json({ message: 'Failed to delete entitlement.' });
  }
};

module.exports = { getEntitlementsData, addEntitlement, updateEntitlement, deleteEntitlement };
