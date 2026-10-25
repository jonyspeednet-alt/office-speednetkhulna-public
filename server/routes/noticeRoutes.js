const express = require('express');
const router = express.Router();
const noticeController = require('../controllers/noticeController');

// Route: GET /api/notice
router.get('/', noticeController.getActiveNotice);

module.exports = router;