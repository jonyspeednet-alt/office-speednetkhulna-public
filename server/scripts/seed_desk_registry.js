const { ensureAssetSchema } = require('../controllers/assetManagementController');

(async () => {
  await ensureAssetSchema();
  console.log('Desk registry seeded successfully.');
  process.exit(0);
})().catch((error) => {
  console.error('Desk registry seeding failed:', error);
  process.exit(1);
});
