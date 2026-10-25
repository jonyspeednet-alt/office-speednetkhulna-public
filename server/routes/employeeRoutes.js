const express = require('express');
const router = express.Router();
const employeeController = require('../controllers/employeeController');
const authMiddleware = require('../middleware/auth');
const { requirePermission, requireAnyPermission } = require('../middleware/checkPermission');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');
const requireFreshAuth = (req, res, next) => {
    req.requireFreshAuth = true;
    next();
};

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        try {
            if (!fs.existsSync(UPLOADS_DIR)) {
                fs.mkdirSync(UPLOADS_DIR, { recursive: true });
            }
            cb(null, UPLOADS_DIR);
        } catch (err) {
            console.error('Multer destination error:', err);
            cb(err);
        }
    },
    filename: function (req, file, cb) {
        // S12: never reuse the client filename (x.html / x.svg → same-origin
        // script). Random name + extension from an image allowlist only.
        const mime = String(file.mimetype || '').toLowerCase();
        const extByMime = {
            'image/jpeg': '.jpg',
            'image/png': '.png',
            'image/webp': '.webp',
            'image/gif': '.gif',
        };
        const ext = extByMime[mime] || '';
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // NID scans get an identifiable prefix so the static mount can
        // gate them behind auth (profile photos stay public for the directory).
        const prefix = file.fieldname === 'nid_pic' ? 'nid-' : '';
        const filename = prefix + uniqueSuffix + ext;
        if (prefix) {
            // Create private before multer opens it: nginx must never read NID scans.
            try {
                const fd = fs.openSync(path.join(UPLOADS_DIR, filename), 'wx', 0o600);
                fs.closeSync(fd);
            } catch (err) { return cb(err); }
        }
        cb(null, filename);
    }
});
// S12: image allowlist + 5 MB cap. Note: fileFilter runs on the
// client-declared mimetype — the static mount (nosniff + attachment for
// non-images) is the backstop, not this filter.
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024, files: 2 },
    fileFilter: (req, file, cb) => {
        const mime = String(file.mimetype || '').toLowerCase();
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)) {
            return cb(new Error('Only JPG/PNG/WebP/GIF images are allowed'), false);
        }
        cb(null, true);
    },
});

const employeeUpload = upload.fields([{ name: 'profile_pic', maxCount: 1 }, { name: 'nid_pic', maxCount: 1 }]);
// Convert multer errors (size/type) into JSON 400s instead of HTML pages.
const handleEmployeeUpload = (req, res, next) => {
    employeeUpload(req, res, (err) => {
        if (err) return res.status(400).json({ message: 'Photo must be ≤5 MB (JPG/PNG/WebP/GIF)' });
        next();
    });
};

router.get('/', requireFreshAuth, authMiddleware, employeeController.getEmployees);
router.get('/departments', authMiddleware, employeeController.getDepartments);
router.get('/next-id', authMiddleware, requireAnyPermission(['users.manage', 'employees.create_edit']), employeeController.getNextEmployeeId);
router.post('/', authMiddleware, requireAnyPermission(['users.manage', 'employees.create_edit']), handleEmployeeUpload, employeeController.addEmployee);

// NEW: Toggle employee status (Active <-> Inactive)
router.patch('/:id/status', authMiddleware, requireAnyPermission(['users.manage', 'employees.create_edit']), employeeController.toggleEmployeeStatus);
router.post('/:id/reset-password', authMiddleware, requirePermission('users.manage'), employeeController.resetEmployeePassword);

router.get('/:id/history', authMiddleware, employeeController.getProfileHistory);

router.get('/:id', requireFreshAuth, authMiddleware, employeeController.getEmployeeById);
router.put('/:id', authMiddleware, requireAnyPermission(['users.manage', 'users.edit.any', 'employees.create_edit']), handleEmployeeUpload, employeeController.updateEmployee);
// Route lists users.edit.any to match the controller's canEditAnyProfile gate above.

module.exports = router;
