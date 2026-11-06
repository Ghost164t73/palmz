const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, validateSignup } = require('../lib/password');

test('correct password verifies, wrong password does not', async () => {
  const hash = await hashPassword('sandals2026');
  assert.equal(await verifyPassword('sandals2026', hash), true);
  assert.equal(await verifyPassword('sandals2027', hash), false);
});

test('missing hash never verifies', async () => {
  assert.equal(await verifyPassword('anything1', undefined), false);
});

test('password must be at least 8 characters', () => {
  assert.ok(validateSignup({ name: 'Ada', email: 'ada@example.com', password: 'abc123' }).error);
});

test('password needs a letter and a number', () => {
  assert.ok(validateSignup({ name: 'Ada', email: 'ada@example.com', password: 'abcdefgh' }).error);
  assert.ok(validateSignup({ name: 'Ada', email: 'ada@example.com', password: '12345678' }).error);
});

test('valid signup is normalized', () => {
  const r = validateSignup({ name: ' Ada ', email: ' Ada@Example.COM ', password: 'palmz123' });
  assert.equal(r.error, undefined);
  assert.equal(r.name, 'Ada');
  assert.equal(r.email, 'ada@example.com');
});

test('invalid email is rejected', () => {
  assert.ok(validateSignup({ name: 'Ada', email: 'not-an-email', password: 'palmz123' }).error);
});
