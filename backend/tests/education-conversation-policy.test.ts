import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EDUCATION_WORKFLOW_MESSAGE, isEducationLead, isEducationConversation, conversationPurpose,
} from '../src/education-conversation-policy.js';
import type { SqlSession } from '../src/agent-purpose.js';

const tenantId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const agentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const conversationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const leadId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

test('education conversations are recognized without relying only on the current agent purpose', async () => {
  const statements: string[] = [];
  const db: SqlSession = { query: async (sql) => {
    statements.push(sql);
    return { rows: [{ found: true }] as never[] };
  }};
  assert.equal(await conversationPurpose(db, { tenantId, workspaceId, agentId, id: conversationId }), 'education');
  assert.equal(statements.length, 1);
  assert.match(statements[0]!, /education_conversation_contexts/);
  assert.match(statements[0]!, /agent_purpose_settings/);
});
test('non-education chats fall back to the agent purpose with explicit scope', async () => {
  const params: unknown[][] = [];
  const db: SqlSession = { query: async (sql, values) => {
    params.push([...(values ?? [])]);
    return { rows: sql.includes('AS found') ? [{ found: false }] : [{ purpose: 'lead_generation' }] } as never;
  }};
  assert.equal(await conversationPurpose(db, { tenantId, workspaceId, agentId, id: conversationId }), 'lead_generation');
  assert.deepEqual(params[0], [conversationId, tenantId, workspaceId, agentId]);
  assert.deepEqual(params[1], [tenantId, workspaceId, agentId]);
});
test('leads are guarded using historical education context and scoped SQL EXISTS clauses', async () => {
  let statement = ''; let argumentsSeen: readonly unknown[] | undefined;
  const db: SqlSession = { query: async (sql, params) => {
    statement = sql; argumentsSeen = params;
    return { rows: [{ found: true }] as never[] };
  }};
  assert.equal(await isEducationLead(db, { id: leadId, tenantId, workspaceId }), true);
  assert.match(statement, /l\.tenant_id = \$2 AND l\.workspace_id = \$3/);
  assert.match(statement, /ecc\.conversation_id = l\.conversation_id/);
  assert.deepEqual(argumentsSeen, [leadId, tenantId, workspaceId]);
});
test('malformed tenant or entity IDs never reach the database', async () => {
  let requests = 0;
  const db: SqlSession = { query: async () => { requests++; return { rows: [] }; }};
  await assert.rejects(isEducationLead(db, { id: leadId, tenantId: 'not-a-uuid', workspaceId }), /UUID/);
  await assert.rejects(isEducationConversation(db, { id: conversationId, agentId:'bad', tenantId, workspaceId }), /UUID/);
  assert.equal(requests, 0);
});
test('unknown records fail closed without being mistaken for education records', async () => {
  const db: SqlSession = { query: async () => ({ rows: [] }) };
  assert.equal(await isEducationLead(db, { id: leadId, tenantId, workspaceId }), false);
  assert.match(EDUCATION_WORKFLOW_MESSAGE, /cannot be resolved or converted to leads/);
});
