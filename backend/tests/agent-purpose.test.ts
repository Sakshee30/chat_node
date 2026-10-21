import assert from 'node:assert/strict';
import test from 'node:test';
import { AGENT_PURPOSE, getAgentPurpose, normalizeAgentPurpose, setAgentPurpose, type SqlSession } from '../src/agent-purpose.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const agentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('fallback from missing and malformed legacy agent purpose is support', async () => {
  assert.equal(normalizeAgentPurpose(null), AGENT_PURPOSE.SUPPORT);
  assert.equal(normalizeAgentPurpose('injected_purpose'), AGENT_PURPOSE.SUPPORT);
  const db: SqlSession = { query: async () => ({ rows: [] }) };
  assert.equal(await getAgentPurpose(db, { tenantId, workspaceId, agentId }), 'support');
});

test('read uses parameterized tenant, workspace and agent identifiers', async () => {
  let values: readonly unknown[] = [];
  let statement = '';
  const db: SqlSession = { query: async (sql, params) => {
    statement = sql; values = params || [];
    return { rows: [{ purpose: 'education' }] as never[] };
  } };
  assert.equal(await getAgentPurpose(db, { tenantId, workspaceId, agentId }), 'education');
  assert.deepEqual(values, [tenantId, workspaceId, agentId]);
  assert.match(statement, /tenant_id = \$1 AND workspace_id = \$2 AND agent_id = \$3/);
});

test('upsert retains agent scope and is atomic using existing database conflict constraint', async () => {
  let values: readonly unknown[] = [];
  let statement = '';
  const row = { agent_id: agentId, tenant_id: tenantId, workspace_id: workspaceId,
    purpose: 'lead_generation', created_at: new Date(), updated_at: new Date() };
  const db: SqlSession = { query: async (sql, params) => {
    statement = sql; values = params || []; return { rows: [row] as never[] };
  } };
  assert.deepEqual(await setAgentPurpose(db, { id: agentId, tenantId, workspaceId }, 'lead_generation'), row);
  assert.deepEqual(values, [agentId, tenantId, workspaceId, 'lead_generation']);
  assert.match(statement, /ON CONFLICT \(agent_id\)/);
  assert.match(statement, /updated_at = CURRENT_TIMESTAMP/);
});

test('rejects unscoped IDs and unsupported purposes before writing', async () => {
  let count = 0;
  const db: SqlSession = { query: async () => { count++; return { rows: [] }; } };
  await assert.rejects(getAgentPurpose(db, { tenantId: 'not-a-uuid', workspaceId, agentId }), /UUID/);
  await assert.rejects(setAgentPurpose(db, { id: agentId, tenantId, workspaceId }, 'admin' as never), /Unsupported/);
  assert.equal(count, 0);
});
