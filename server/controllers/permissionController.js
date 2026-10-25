const pool = require('../utilities/db');
const { resolvePermission, LEGACY_TO_CANONICAL, CANONICAL_TO_LEGACY } = require('../utilities/permissionRegistry');

const toTitle = (value) =>
  String(value || '')
    .replace(/^p_/, '')
    .replace(/\./g, ' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

const isPermissionKey = (key) => {
  const s = String(key || '');
  return s.startsWith('p_') || s.includes('.');
};

/**
 * Update User Permission
 * Replaces: update_permission_ajax.php
 */
const updatePermission = async (req, res) => {
  let client;
  try {
    if (!resolvePermission(req.user, 'permissions.manage')) {
      return res.status(403).json({ message: 'Unauthorized Access' });
    }
    const { user_id, column, value } = req.body;
    if (!Number.isSafeInteger(Number(user_id)) || Number(user_id) <= 0 ||
        typeof column !== 'string' || !/^[a-zA-Z0-9_.]+$/.test(column) ||
        ![0, 1, '0', '1', false, true].includes(value)) {
      return res.status(400).json({ message: 'Invalid permission update' });
    }
    const legacyKey = CANONICAL_TO_LEGACY[column]?.[0] || column;
    const allow = value === 1 || value === '1' || value === true;
    client = await pool.connect();
    await client.query('BEGIN');
    const target = await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [user_id]);
    if (!target.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found' });
    }
    const catalog = await client.query('SELECT id FROM permissions WHERE legacy_key = $1', [legacyKey]);
    if (!catalog.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Unknown permission key' });
    }
    if (allow) {
      await client.query(`INSERT INTO user_permissions (user_id, permission_key)
        VALUES ($1, $2) ON CONFLICT (user_id, permission_key) DO NOTHING`, [user_id, legacyKey]);
    } else {
      await client.query('DELETE FROM user_permissions WHERE user_id = $1 AND permission_key = ANY($2::text[])',
        [user_id, [legacyKey, column]]);
    }
    // A revoke must deny inherited role grants, not merely remove an override.
    await client.query(`INSERT INTO user_permission_overrides (user_id, permission_id, effect)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, permission_id) DO UPDATE SET effect = EXCLUDED.effect`,
      [user_id, catalog.rows[0].id, allow ? 'allow' : 'deny']);
    await client.query('UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = $1', [user_id]);
    await client.query('COMMIT');
    require('../middleware/auth').evictAuthCache(user_id);
    return res.status(200).json({ message: 'Success' });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    console.error('Database Error:', error);
    return res.status(500).json({ message: 'Database Error' });
  } finally {
    if (client) client.release();
  }
};

/**
 * Get Data for Permission Management Page
 * Replaces logic in manage_permissions.php
 */
const getManagePermissionsData = async (req, res) => {
  try {
    const currentUserId = req.user.id;
    if (!resolvePermission(req.user, 'permissions.manage')) {
      return res.status(403).json({ message: 'Unauthorized Access' });
    }

    // 2. Build a complete permission catalog.
    //    Sidebar menus alone is not enough (some permissions may not have a menu yet),
    //    so we union: sidebar_menus + role JSON permissions + user overrides + registry.
    const menuPermQuery = `
      SELECT permission_column, MAX(menu_name) AS menu_name
      FROM sidebar_menus
      WHERE permission_column IS NOT NULL AND permission_column <> ''
      GROUP BY permission_column
    `;
    const menuPermResult = await pool.query(menuPermQuery);

    const rolePermsQuery = `
      SELECT permissions
      FROM roles
      WHERE permissions IS NOT NULL
    `;
    const rolePermsResult = await pool.query(rolePermsQuery);

    const overrideKeysQuery = `
      SELECT DISTINCT permission_key
      FROM user_permissions
      WHERE permission_key IS NOT NULL AND permission_key <> ''
    `;
    const overrideKeysResult = await pool.query(overrideKeysQuery);

    const permissionMap = new Map();

    // Registry-defined legacy permission keys (source-of-truth for app checks).
    Object.keys(LEGACY_TO_CANONICAL || {}).forEach((key) => {
      if (isPermissionKey(key)) {
        permissionMap.set(key, toTitle(key));
      }
    });
    // Registry-defined canonical keys (e.g. assets.view) so they show in the UI.
    Object.values(LEGACY_TO_CANONICAL || {}).forEach((key) => {
      if (isPermissionKey(key) && !permissionMap.has(key)) {
        permissionMap.set(key, toTitle(key));
      }
    });

    // Menu-derived names.
    menuPermResult.rows.forEach((row) => {
      if (!row?.permission_column) return;
      permissionMap.set(row.permission_column, row.menu_name || permissionMap.get(row.permission_column) || toTitle(row.permission_column));
    });

    // Role JSON keys.
    rolePermsResult.rows.forEach((row) => {
      const perms = row?.permissions && typeof row.permissions === 'object' ? row.permissions : {};
      Object.keys(perms).forEach((key) => {
        if (isPermissionKey(key)) {
          if (!permissionMap.has(key)) permissionMap.set(key, toTitle(key));
        }
      });
    });

    // User override keys.
    overrideKeysResult.rows.forEach((row) => {
      const key = row?.permission_key;
      if (key && isPermissionKey(key) && !permissionMap.has(key)) {
        permissionMap.set(key, toTitle(key));
      }
    });

    const permissionColumns = Array.from(permissionMap.entries())
      .map(([permission_column, menu_name]) => ({ permission_column, menu_name }))
      .sort((a, b) => a.permission_column.localeCompare(b.permission_column));

    // 3. Fetch Users (Include role_id; phone/email for search)
    const userQuery = `
      SELECT id, employee_id, full_name, role, role_id, phone, email
      FROM users 
      WHERE role NOT ILIKE 'super admin' AND id != $1
      ORDER BY full_name ASC
    `;
    const userResult = await pool.query(userQuery, [currentUserId]);

    // 4. Fetch Active Permissions Map (for legacy or direct user overrides)
    const activePermQuery = `SELECT user_id, permission_key FROM user_permissions`;
    const activePermResult = await pool.query(activePermQuery);

    const activePermissions = {};
    activePermResult.rows.forEach(row => {
      if (!activePermissions[row.user_id]) activePermissions[row.user_id] = {};
      activePermissions[row.user_id][row.permission_key] = true;
    });

    res.json({ columns: permissionColumns, users: userResult.rows, activePermissions });
  } catch (error) {
    console.error('Get Permissions Data Error:', error);
    res.status(500).json({ message: 'Server Error' });
  }
};

module.exports = { updatePermission, getManagePermissionsData };
