const express = require('express');
const authMiddleware = require('../middleware/auth');
const {
  getMasterData,
  createOffice,
  createDesk,
  updateDesk,
  getDeskHistory,
  createCategory,
  createVendor,
  listAssets,
  createAsset,
  updateAsset,
  deleteAsset,
  moveAsset,
  getAssetHistory,
  listAssetComponents,
  createAssetComponent,
  updateAssetComponent,
  replaceAssetComponent,
  listAssetComponentMovements,
  getSummary,
  listWarranties,
  createWarranty,
  listIssues,
  createIssue,
  updateIssueStatus,
  listRepairs,
  createRepair,
  listReplacements,
  createReplacement,
  listMovements,
  listStockItems,
  createStockItem,
  updateStockItem,
  listStockMovements,
  createStockMovement,
  getReports
} = require('../controllers/assetManagementController');
const { requireAnyPermission, requirePermission } = require('../middleware/checkPermission');

const router = express.Router();

router.use(authMiddleware);

router.get('/summary', requireAnyPermission(['assets.view', 'assets.manage']), getSummary);
router.get('/reports', requireAnyPermission(['assets.view', 'assets.manage']), getReports);
router.get('/masters', requireAnyPermission(['assets.view', 'assets.manage']), getMasterData);
router.get('/movements', requireAnyPermission(['assets.view', 'assets.manage']), listMovements);
router.get('/warranties', requireAnyPermission(['assets.view', 'assets.manage']), listWarranties);
router.post('/warranties', requirePermission('assets.manage'), createWarranty);
router.get('/issues', requireAnyPermission(['assets.view', 'assets.manage']), listIssues);
router.post('/issues', requirePermission('assets.manage'), createIssue);
router.patch('/issues/:id', requirePermission('assets.manage'), updateIssueStatus);
router.get('/repairs', requireAnyPermission(['assets.view', 'assets.manage']), listRepairs);
router.post('/repairs', requirePermission('assets.manage'), createRepair);
router.get('/replacements', requireAnyPermission(['assets.view', 'assets.manage']), listReplacements);
router.post('/replacements', requirePermission('assets.manage'), createReplacement);
router.get('/stock-items', requireAnyPermission(['assets.view', 'assets.manage']), listStockItems);
router.post('/stock-items', requirePermission('assets.manage'), createStockItem);
router.put('/stock-items/:id', requirePermission('assets.manage'), updateStockItem);
router.get('/stock-movements', requireAnyPermission(['assets.view', 'assets.manage']), listStockMovements);
router.post('/stock-movements', requirePermission('assets.manage'), createStockMovement);

router.post('/offices', requirePermission('assets.manage'), createOffice);
router.post('/desks', requirePermission('assets.manage'), createDesk);
router.put('/desks/:id', requirePermission('assets.manage'), updateDesk);
router.get('/desks/:id/history', requireAnyPermission(['assets.view', 'assets.manage']), getDeskHistory);
router.post('/categories', requirePermission('assets.manage'), createCategory);
router.post('/vendors', requirePermission('assets.manage'), createVendor);

router.get('/', requireAnyPermission(['assets.view', 'assets.manage']), listAssets);
router.post('/', requirePermission('assets.manage'), createAsset);
router.put('/:id', requirePermission('assets.manage'), updateAsset);
router.delete('/:id', requirePermission('assets.manage'), deleteAsset);
router.post('/:id/move', requirePermission('assets.manage'), moveAsset);
router.get('/:id/components', requireAnyPermission(['assets.view', 'assets.manage']), listAssetComponents);
router.post('/:id/components', requirePermission('assets.manage'), createAssetComponent);
router.get('/:id/component-movements', requireAnyPermission(['assets.view', 'assets.manage']), listAssetComponentMovements);
router.put('/components/:componentId', requirePermission('assets.manage'), updateAssetComponent);
router.post('/components/:componentId/replace', requirePermission('assets.manage'), replaceAssetComponent);
router.get('/:id/history', requireAnyPermission(['assets.view', 'assets.manage']), getAssetHistory);

module.exports = router;
