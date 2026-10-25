const path = require('path');
const { ensureClient } = require('../services/whatsappNotificationService');

process.env.WHATSAPP_GROUP_NOTIFICATIONS_ENABLED = 'true';

console.log('Starting one-time WhatsApp authentication window...');
console.log('Scan the QR in the opened browser with the office WhatsApp account.');
console.log('After it says client is ready, you can close this window and use normal backend startup.');

ensureClient({ headless: false })
  .then(() => {
    console.log('WHATSAPP_AUTH_READY');
    setInterval(() => {}, 1000);
  })
  .catch((error) => {
    console.error('WHATSAPP_AUTH_FAILED');
    console.error(error && (error.stack || error.message || error));
    process.exit(1);
  });
