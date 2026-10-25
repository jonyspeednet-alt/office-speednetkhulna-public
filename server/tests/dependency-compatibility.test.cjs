const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');
const { IMAGE_DECODE_OPTIONS, IMAGE_DECODE_TIMEOUT_SECONDS } = require('../middleware/uploadMiddleware');

test('patched native image codec preserves supported photo processing and rejects oversized dimensions', async () => {
  const input = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#126699' } }).png().toBuffer();
  const output = await sharp(input, IMAGE_DECODE_OPTIONS).timeout({ seconds: IMAGE_DECODE_TIMEOUT_SECONDS })
    .resize(16, 16, { fit: sharp.fit.inside }).webp({ quality: 80 }).toBuffer();
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 16);
  assert.equal(metadata.height, 8);
  // A tiny compressed SVG fixture exercises the pixel ceiling without allocating a large raster.
  await assert.rejects(sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="5000" height="5000"/>'),
    IMAGE_DECODE_OPTIONS).webp().toBuffer(), /pixel limit/i);
});

test('patched mail library preserves invoice multipart delivery without a live SMTP connection', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true,
    disableFileAccess: true, disableUrlAccess: true });
  const sent = await transport.sendMail({ from: 'billing@example.com', to: 'recipient+invoice@example.com',
    subject: 'Invoice — বাংলা', html: '<p>Invoice</p>',
    attachments: [{ filename: 'invoice.pdf', content: Buffer.from('%PDF-1.4\n'), contentType: 'application/pdf' }] });
  const message = sent.message.toString('utf8');
  assert.match(message, /multipart\/mixed/i);
  assert.match(message, /application\/pdf/i);
  assert.equal(sent.envelope.to[0], 'recipient+invoice@example.com');
  assert.match(message, /Subject: =\?UTF-8\?/i);
});

test('patched spreadsheet library preserves date/numeric imports and browser packages load through CommonJS', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Name', 'Amount'], ['Alice', 12.5]]), 'Sheet1');
  const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const parsed = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(XLSX.utils.sheet_to_json(parsed.Sheets.Sheet1), [{ Name: 'Alice', Amount: 12.5 }]);
  assert.equal(typeof require('puppeteer').launch, 'function');
  assert.equal(typeof require('../../whatsapp-worker/node_modules/puppeteer').launch, 'function');
  assert.equal(typeof require('whatsapp-web.js').Client, 'function');
  assert.equal(typeof require('../../whatsapp-worker/node_modules/whatsapp-web.js').Client, 'function');
});
