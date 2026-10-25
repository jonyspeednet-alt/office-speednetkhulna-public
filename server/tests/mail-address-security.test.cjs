const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeMailbox } = require('../utilities/mailAddress');

test('normalizes one ordinary recipient, including an international domain', () => {
  assert.equal(normalizeMailbox(' Billing+invoice@Example.COM '), 'Billing+invoice@example.com');
  assert.equal(normalizeMailbox('billing@bücher.example'), 'billing@xn--bcher-kva.example');
  assert.equal(normalizeMailbox("o'connor@example.com"), "o'connor@example.com");
});

test('rejects parser-complex syntax, recipient lists and header injection', () => {
  for (const input of [
    'a(comment)@example.com', 'a' + '('.repeat(20000) + ')'.repeat(20000) + '@example.com',
    'a@example.com,b@example.com', 'a@example.com;b@example.com',
    'Billing <a@example.com>', '"a"@example.com',
    'a@example.com\r\nBcc: attacker@example.com', '\na@example.com',
    'a@[127.0.0.1]', 'a@example.com/path', 'a@example.com?x=1',
  ]) assert.equal(normalizeMailbox(input), null);
});

test('rejects malformed and oversized mailbox components before parsing', () => {
  for (const input of [null, {}, ['a@example.com'], '', '.a@example.com',
    'a..b@example.com', 'a.@example.com', 'a@@example.com', 'a@localhost',
    'a@-example.com', 'a@example-.com', 'a@' + 'x'.repeat(64) + '.com',
    'x'.repeat(65) + '@example.com', 'a@' + 'x'.repeat(63) + '.' + 'x'.repeat(63) + '.' + 'x'.repeat(63) + '.' + 'x'.repeat(62),
  ]) assert.equal(normalizeMailbox(input), null);
});
