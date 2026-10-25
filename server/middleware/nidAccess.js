const pool = require('../utilities/db');
const { resolvePermission } = require('../utilities/permissionRegistry');

// Match the profile controller's private-document policy: owner or user manager.
module.exports = async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    if (!req.user?.id) return res.status(401).json({ message: 'Authentication required' });
    if (resolvePermission(req.user, 'users.manage')) return next();
    let filename;
    try {
        filename = decodeURIComponent(String(req.path || '')).split('/').pop();
    } catch (_) {
        return res.status(400).json({ message: 'Invalid upload path' });
    }
    try {
        const result = await pool.query(
            'SELECT 1 FROM users WHERE id = $1 AND nid_pic = $2 LIMIT 1',
            [req.user.id, filename],
        );
        if (!result.rows.length) return res.status(403).json({ message: 'Access denied' });
        return next();
    } catch (_) {
        return res.status(503).json({ message: 'Service unavailable. Please retry.' });
    }
};
