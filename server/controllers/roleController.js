const pool = require('../utilities/db');

// Get all roles
const getRoles = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM roles ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    console.error('Get Roles Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

// Keep the RBAC v2 normalized table (role_permissions) in sync with
// roles.permissions JSONB after every create/update — see
// migrations/20260707_rbac_v2_phase1_up.sql. Permission keys not yet in the
// `permissions` catalog are silently skipped (no-op), not an error.
const syncRolePermissions = async (client, roleId, permissions) => {
  await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  await client.query(
    `INSERT INTO role_permissions (role_id, permission_id)
     SELECT $1, p.id
     FROM jsonb_each($2::jsonb) AS kv(key, value)
     JOIN permissions p ON p.legacy_key = kv.key
     WHERE kv.value IN ('true'::jsonb, '1'::jsonb, '"1"'::jsonb)`,
    [roleId, JSON.stringify(permissions || {})],
  );
};

// Create or update role
const saveRole = async (req, res) => {
  const { id, name, permissions } = req.body;

  // Input validation
  if (!name || !String(name).trim()) {
    return res.status(400).json({ message: 'Role name is required' });
  }
  const trimmedName = String(name).trim();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (id) {
      // FIX: Check duplicate name on UPDATE (exclude self)
      const dupCheck = await client.query(
        'SELECT id FROM roles WHERE LOWER(name) = LOWER($1) AND id != $2 LIMIT 1',
        [trimmedName, id]
      );
      if (dupCheck.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: `Role "${trimmedName}" already exists` });
      }

      const result = await client.query(
        'UPDATE roles SET name = $1, permissions = $2 WHERE id = $3 RETURNING *',
        [trimmedName, JSON.stringify(permissions || {}), id]
      );
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Role not found' });
      }
      await syncRolePermissions(client, id, permissions);
      // Permission set changed — force re-login for everyone holding this role
      await client.query('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE role_id = $1', [id]);
      const holders = await client.query('SELECT id FROM users WHERE role_id = $1', [id]);
      await client.query('COMMIT');
      // Evict only after commit: a concurrent request must not recache the
      // pre-update role between invalidation and transaction visibility.
      const evict = require('../middleware/auth').evictAuthCache;
      for (const holder of holders.rows) evict(holder.id);
      res.json({ message: 'Role updated successfully', role: result.rows[0] });
    } else {
      // FIX: Check duplicate name on CREATE
      const dupCheck = await client.query(
        'SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1',
        [trimmedName]
      );
      if (dupCheck.rowCount > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: `Role "${trimmedName}" already exists` });
      }

      const result = await client.query(
        'INSERT INTO roles (name, permissions) VALUES ($1, $2) RETURNING *',
        [trimmedName, JSON.stringify(permissions || {})]
      );
      await syncRolePermissions(client, result.rows[0].id, permissions);
      await client.query('COMMIT');
      res.status(201).json({ message: 'Role created successfully', role: result.rows[0] });
    }
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Save Role Error:', error);
    res.status(500).json({ message: 'Database Error' });
  } finally {
    client.release();
  }
};

// Delete role
const deleteRole = async (req, res) => {
  const { id } = req.params;
  try {
    // Check if role is assigned to any user (via role_id)
    const userCheck = await pool.query('SELECT 1 FROM users WHERE role_id = $1 LIMIT 1', [id]);
    if (userCheck.rowCount > 0) {
      return res.status(400).json({ message: 'Cannot delete role assigned to users' });
    }
    // Also block when legacy text-only users (role_id IS NULL) still carry
    // this role's name — otherwise the semantic link is orphaned silently.
    const legacyCheck = await pool.query(
      `SELECT 1 FROM users u WHERE u.role_id IS NULL
       AND LOWER(TRIM(u.role)) = LOWER(TRIM((SELECT name FROM roles WHERE id = $1))) LIMIT 1`,
      [id]
    );
    if (legacyCheck.rowCount > 0) {
      return res.status(400).json({ message: 'Cannot delete role assigned to users' });
    }
    
    const delResult = await pool.query('DELETE FROM roles WHERE id = $1', [id]);
    if (delResult.rowCount === 0) {
      return res.status(404).json({ message: 'Role not found' });
    }
    res.json({ message: 'Role deleted successfully' });
  } catch (error) {
    console.error('Delete Role Error:', error);
    res.status(500).json({ message: 'Database Error' });
  }
};

// Assign role to user
// FIX: Added rowCount check + input validation
// Sync fix: users.role TEXT is kept in sync with roles.name so the
// Employees list / Edit form (which read the text column) never disagree
// with Manage Permissions (which reads role_id).
const assignRoleToUser = async (req, res) => {
  const { user_id, role_id } = req.body;

  if (!user_id) {
    return res.status(400).json({ message: 'user_id is required' });
  }

  try {
    const beforeRes = await pool.query('SELECT role, role_id FROM users WHERE id = $1', [user_id]);
    const before = beforeRes.rows[0] || {};
    let roleName = null;
    if (role_id) {
      const roleCheck = await pool.query('SELECT id, name FROM roles WHERE id = $1', [role_id]);
      if (roleCheck.rowCount === 0) {
        return res.status(404).json({ message: 'Role not found' });
      }
      roleName = roleCheck.rows[0].name;
    }

    const result = roleName
      ? await pool.query(
        'UPDATE users SET role_id = $1, role = $2, token_version = COALESCE(token_version, 0) + 1 WHERE id = $3',
        [role_id, roleName, user_id]
      )
      : await pool.query(
        'UPDATE users SET role_id = NULL, role = $1, token_version = COALESCE(token_version, 0) + 1 WHERE id = $2',
        ['Staff', user_id]
      );

    // FIX: If user not found, return 404 instead of silent success
    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }
    try {
      require('../middleware/auth').evictAuthCache(user_id);
    } catch (_) {}
    try {
      const { diffProfile, logProfileHistory: logHist3 } = require('../utilities/profileHistory');
      const afterRes = await pool.query('SELECT role, role_id FROM users WHERE id = $1', [user_id]);
      const changes = diffProfile(before, afterRes.rows[0] || {});
      if (changes.length > 0) {
        await pool.query('UPDATE users SET updated_at = NOW(), updated_by = $2 WHERE id = $1', [user_id, Number(req.user?.id || 0)]);
        logHist3({
          employeeId: Number(user_id),
          actorId: Number(req.user?.id || 0) || null,
          actorName: req.user?.full_name || req.user?.name || null,
          source: 'role_assign',
          changes,
        });
      }
    } catch (histErr) {
      console.error('[ProfileHistory] assignRole hook failed:', histErr.message);
    }

    res.json({ message: 'Role assigned successfully', role: roleName || 'Staff', role_id: role_id || null });
  } catch (error) {
    console.error('Assign Role Error:', error);
    res.status(500).json({ message: 'Database Error' });
  }
};

module.exports = { getRoles, saveRole, deleteRole, assignRoleToUser };
