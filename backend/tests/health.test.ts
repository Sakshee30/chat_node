import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';

test('liveness is available with source-compatible response and security headers', async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  } finally { await app.close(); }
});

test('readiness returns probe diagnostics but never reports migrated app as ready', async () => {
  const app = buildApp({
    env: { APP_ENV: 'production', REQUIRE_NVIDIA: 'true' },
    probes: {
      database: async () => true,
      redis: async () => true,
      nvidiaConfigured: () => true,
    },
  });
  try {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      status: 'not-ready',
      checks: { database: 'ok', redis: 'ok', nvidia: 'configured' },
      migration: 'incomplete',
    });
    assert.equal(response.headers['strict-transport-security'], 'max-age=31536000; includeSubDomains');
  } finally { await app.close(); }
});

test('readiness reports unavailable services without leaking errors', async () => {
  const app = buildApp({
    probes: {
      database: async () => { throw Error('DB_PASSWORD=secret'); },
      redis: async () => false,
      nvidiaConfigured: () => false,
    },
  });
  try {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json().checks, {
      database: 'unavailable', redis: 'unavailable', nvidia: 'not-configured',
    });
    assert.equal(response.body.includes('DB_PASSWORD'), false);
  } finally { await app.close(); }
});
