const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBundledExecutable, detectBrowserMajor, buildWhatsAppUserAgent, enableClientBrowserCompatibility } = require('../../whatsapp-worker/browserCompatibility');

test('WhatsApp user agent follows the configured Chrome binary version', () => {
  const run = (binary, args, options) => {
    assert.equal(binary, '/browser/chrome');
    assert.deepEqual(args, ['--version']);
    assert.equal(options.timeout, 5000);
    return { status: 0, stdout: 'Google Chrome 154.0.8037.57\n' };
  };
  assert.equal(detectBrowserMajor('/browser/chrome', run), '154');
  assert.equal(detectBrowserMajor('/browser/chrome', () => ({ status: 0, stdout: 'Chrome for Testing 154.0.8037.57' })), '154');
  assert.match(buildWhatsAppUserAgent({ executablePath: '/browser/chrome', detectMajor: () => '154' }), /Chrome\/154\.0\.0\.0/);
  assert.throws(() => buildWhatsAppUserAgent({ executablePath: null }), /Unable to determine/);
  assert.equal(buildWhatsAppUserAgent({ override: 'custom agent', executablePath: null }), 'custom agent');
});

test('bundled browser lookup accepts synchronous and asynchronous executable paths', async () => {
  for (const executablePath of [() => '/browser/chrome', async () => '/browser/chrome']) {
    const checked = [];
    assert.equal(await resolveBundledExecutable({ executablePath }, (value) => { checked.push(value); return true; }), '/browser/chrome');
    assert.deepEqual(checked, ['/browser/chrome']);
  }
  assert.equal(await resolveBundledExecutable({ executablePath: async () => '/missing' }, () => false), null);
  assert.equal(await resolveBundledExecutable({ executablePath: async () => ({}) }, () => { assert.fail('must not stat nonstrings'); }), null);
  await assert.rejects(resolveBundledExecutable({ executablePath: async () => { throw new Error('Browser absent'); } }, () => true), /Browser absent/);
});

test('SDK logout receives isConnected compatibility without modifying legacy browser behavior', async () => {
  const browser = { connected: true };
  const client = { pupBrowser: browser, async logout(value) {
    assert.equal(this, client);
    assert.equal(this.pupBrowser.isConnected(), true);
    this.pupBrowser.connected = false;
    assert.equal(this.pupBrowser.isConnected(), false);
    return value;
  } };
  enableClientBrowserCompatibility(client);
  assert.equal(await client.logout('done'), 'done');
  const original = () => 'legacy';
  const legacy = { pupBrowser: { connected: false, isConnected: original }, logout() { return this.pupBrowser.isConnected(); } };
  enableClientBrowserCompatibility(legacy);
  assert.equal(legacy.logout(), 'legacy');
  assert.equal(legacy.pupBrowser.isConnected, original);
});
