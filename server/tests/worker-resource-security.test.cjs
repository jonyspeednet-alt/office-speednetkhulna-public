const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createBrowserPool, launchBrowserWithSlot } = require('../../whatsapp-worker/browserLifecycle');
const { createJsonRequester } = require('../../whatsapp-worker/boundedHttpJson');
const { boundedRenderClip } = require('../../whatsapp-worker/renderSecurity');

test('oversized screenshot geometry cannot allocate an unbounded output bitmap', () => {
  assert.deepEqual(boundedRenderClip({ x: 0.2, y: 1.2, width: 900, height: 1300 }), { x: 0, y: 1, width: 900, height: 1300 });
  for (const box of [{ x: 0, y: 0, width: 900, height: 10000000 },
    { x: 0, y: 0, width: 10000000, height: 1300 },
    { x: 0, y: 0, width: 900, height: NaN }, { x: 0, y: 0, width: 0, height: 1 }]) {
    assert.throws(() => boundedRenderClip(box), /size limits/);
  }
});

test('failed browser launch and failed close release the single screenshot slot', async () => {
  const acquire = createBrowserPool({ waitTimeoutMs: 30 });
  await assert.rejects(launchBrowserWithSlot({ launch: async () => { throw new Error('Launch failure'); } }, {}, acquire), /Launch failure/);
  const slot = await launchBrowserWithSlot({ launch: async () => ({ close: async () => { throw new Error('Close failure'); } }) }, {}, acquire);
  await assert.rejects(slot.closeBrowser(), /Close failure/);
  const release = await acquire();
  release();
});

test('screenshot pool bounds waiting work, times out waiters and preserves capacity', async () => {
  const acquire = createBrowserPool({ maxWaiting: 1, waitTimeoutMs: 15 });
  const release = await acquire();
  const waiting = acquire();
  const timedOut = assert.rejects(waiting, /queue timed out/);
  await assert.rejects(acquire(), /queue is full/);
  await timedOut;
  release();
  const again = await acquire();
  again();
  again(); // Double release cannot create extra capacity.
  const first = await acquire();
  const second = acquire();
  first();
  (await second)();
});

const fakeTransport = (emitResponse) => {
  let destroyed = false;
  let cleanup = () => {};
  const transport = { request(_options, callback) {
    const req = new EventEmitter();
    req.write = () => {};
    req.destroy = (error) => { destroyed = true; cleanup(); req.emit('error', error); };
    req.end = () => setImmediate(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.destroy = (error) => res.emit('error', error);
      callback(res);
      cleanup = emitResponse(res) || cleanup;
    });
    return req;
  } };
  return { transport, wasDestroyed: () => destroyed };
};

test('JSON upstream responses reject excess bytes and interrupted streams', async () => {
  const oversized = fakeTransport((res) => { res.emit('data', Buffer.alloc(11)); res.emit('end'); });
  const request = createJsonRequester({ maxResponseBytes: 10, transports: { 'http:': oversized.transport } });
  await assert.rejects(request('GET', 'http://local/status'), /size limit/);
  assert.equal(oversized.wasDestroyed(), true);
  const interrupted = fakeTransport((res) => res.emit('aborted'));
  await assert.rejects(createJsonRequester({ transports: { 'http:': interrupted.transport } })('GET', 'http://local/status'), /interrupted/);
});

test('absolute deadline stops slow continuous responses; normal JSON stays compatible', async () => {
  const slow = fakeTransport((res) => {
    const timer = setInterval(() => res.emit('data', Buffer.from(' ')), 2);
    return () => clearInterval(timer);
  });
  await assert.rejects(createJsonRequester({ timeoutMs: 20, transports: { 'http:': slow.transport } })('GET', 'http://local/status'), /timed out/);
  assert.equal(slow.wasDestroyed(), true);
  const normal = fakeTransport((res) => { res.emit('data', Buffer.from('{"status":"OK"}')); res.emit('end'); });
  assert.deepEqual(await createJsonRequester({ transports: { 'http:': normal.transport } })('GET', 'http://local/status'), { status: 'OK' });
  await assert.rejects(createJsonRequester()('GET', 'file:///private'), /Invalid upstream/);
});
