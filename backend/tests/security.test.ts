import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAccessToken, createRefreshToken, createMfaChallengeToken,
  createWidgetToken, createWhatsappSignupToken, decodeToken,
  generateApiKey, hashPassword, verifyPassword, readTokenSettings, tokenFingerprint,
} from '../src/security.js';

const settings = {
  jwtSecret: 'test-secret-that-is-at-least-32-chars-long-1234567',
  jwtIssuer: 'northstar-api', jwtAudience: 'northstar-web',
  accessTtlMinutes: 30, refreshTtlDays: 14, whatsappSignupTtlSeconds: 600,
};

test('JWT access/refresh/widget/MFA/signup types and Python-compatible claim keys', async () => {
  const access = await createAccessToken('u1', 't1', 'owner', settings, {
    credentialVersion: 3, platformActorId: 'admin', impersonationId: 'i1',
  });
  const payload = await decodeToken(access.token, 'access', settings);
  assert.equal(payload.sub, 'u1');
  assert.equal(payload.tid, 't1');
  assert.equal(payload.role, 'owner');
  assert.equal(payload.cv, 3);
  assert.equal(payload.platformActorId, 'admin');
  assert.equal(payload.impersonationId, 'i1');
  assert.ok(payload.jti);
  assert.ok(payload.exp && payload.iat && payload.nbf);
  assert.ok(access.expiresAt.getTime() > Date.now());

  const refresh = await createRefreshToken('u1', 't1', 'owner', settings, {familyId:'family1'});
  assert.equal((await decodeToken(refresh.token, 'refresh', settings)).fid, 'family1');
  await assert.rejects(decodeToken(refresh.token, 'access', settings), /invalid or expired/);

  const mfa = await createMfaChallengeToken('u1', 't1', 'owner', settings);
  assert.equal((await decodeToken(mfa.token, 'mfa_challenge', settings)).type, 'mfa_challenge');

  const widget = await createWidgetToken('t1', 'a1', 'c1', 'https://example.com', settings);
  assert.equal((await decodeToken(widget.token, 'widget', settings)).origin, 'https://example.com');

  const signup = await createWhatsappSignupToken('u1', 't1', settings);
  assert.equal((await decodeToken(signup.token, 'whatsapp_signup', settings)).tid, 't1');
});

test('JWT bad signature and required JWT issuer are rejected', async () => {
  const access = await createAccessToken('u1', 't1', 'owner', settings);
  await assert.rejects(decodeToken(access.token + 'x', 'access', settings));
  await assert.rejects(decodeToken(access.token, 'access', {...settings, jwtIssuer:'not-northstar'}));
});

test('API key prefix and SHA256 fingerprint match source contract', () => {
  const key = generateApiKey();
  assert.ok(key.plaintext.startsWith('nsk_live_'));
  assert.equal(key.prefix, key.plaintext.slice(0, 16));
  assert.equal(key.fingerprint, tokenFingerprint(key.plaintext));
  assert.equal(key.fingerprint.length, 64);
});

test('Argon2id hashes are verifiable and malformed hashes are rejected', async () => {
  const digest = await hashPassword('passphrase-with-entropy');
  assert.ok(digest.startsWith('$argon2id$v=19$m=65536,t=3,p=4$'));
  assert.equal(await verifyPassword('passphrase-with-entropy', digest), true);
  assert.equal(await verifyPassword('incorrect', digest), false);
  assert.equal(await verifyPassword('secret', null), false);
  assert.equal(await verifyPassword('secret', 'invalid-hash'), false);
});

test('strong JWT configuration is required', () => {
  assert.throws(() => readTokenSettings({JWT_SECRET:'change-me'}));
  assert.equal(readTokenSettings({JWT_SECRET:settings.jwtSecret}).jwtAudience,'northstar-web');
});
