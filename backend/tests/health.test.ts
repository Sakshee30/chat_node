import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';

test('liveness is available', async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
  } finally { await app.close(); }
});

test('readiness fails closed until migration completes', async () => {
  const app = buildApp();
  try {
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().status, 'not_ready');
  } finally { await app.close(); }
});
