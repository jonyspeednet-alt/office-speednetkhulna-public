const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const load = () => {
  const calls = [];
  let storage;
  const multer = (opts) => { storage = opts.storage; return {}; };
  multer.memoryStorage = () => ({
    _handleFile: (_req, file, cb) => cb(null, { buffer: file.buffer, size: file.buffer.length }),
    _removeFile: (_req, _file, cb) => cb(null),
  });
  const sharp = (buffer, opts) => {
    calls.push({ buffer, opts });
    const pipeline = { timeout(opts) { calls.push(opts); return this; }, resize() { return this; },
      toFormat() { return this; }, async toFile() {} };
    return pipeline;
  };
  sharp.fit = { inside: 'inside' };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../middleware/uploadMiddleware.js'), 'utf8'), {
    module, Buffer, console, require: (name) => name === 'multer' ? multer : name === 'sharp' ? sharp : require(name),
  });
  return { ...module.exports, storage, calls };
};

test('shared upload storage rejects spoofed image MIME before a decoder can consume it', async () => {
  const { storage, imageSignatureMatches } = load();
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    const bad = { mimetype: mime, buffer: Buffer.from('<svg onload="attack()"/>') };
    await assert.rejects(new Promise((resolve, reject) => storage._handleFile({}, bad, (err, info) => err ? reject(err) : resolve(info))), /does not match/);
  }
  for (const [mime, bytes] of [
    ['image/jpeg', [255, 216, 255, 224]], ['image/png', [137, 80, 78, 71, 13, 10, 26, 10]],
    ['image/gif', Buffer.from('GIF89a')], ['image/webp', Buffer.from('RIFFxxxxWEBP')],
  ]) assert.equal(imageSignatureMatches(Buffer.from(bytes), mime), true);
  assert.equal(imageSignatureMatches(Buffer.from('GIF89a'), 'image/png'), false);
});

test('image conversion supplies a pixel ceiling, single-frame decoding and codec timeout', async () => {
  const { resizeAndSave, calls } = load();
  const req = { file: { buffer: Buffer.from('image') }, body: {} };
  let nextCalls = 0;
  await resizeAndSave('/test-uploads', 'photo')(req, {}, (err) => { assert.equal(err, undefined); nextCalls++; });
  assert.equal(nextCalls, 1);
  assert.equal(calls[0].opts.limitInputPixels, 16 * 1024 * 1024);
  assert.equal(calls[0].opts.animated, false);
  assert.equal(calls[1].seconds, 10);
  assert.match(req.body.imageFilename, /^photo-\d+\.webp$/);
});
