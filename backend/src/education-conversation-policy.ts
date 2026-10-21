import { AGENT_PURPOSE, getAgentPurpose, type AgentPurpose, type SqlSession } from './agent-purpose.js';

/**
 * Port of northstar_api/services/education_conversation_policy.py.
 * Historical education conversations remain protected even if their agent
 * purpose changes. These helpers must be called inside an authorized,
 * tenant-scoped transaction; they do not grant authentication.
 */
export const EDUCATION_WORKFLOW_MESSAGE =
  'Education chats stay in Conversations and cannot be resolved or converted to leads.';

export interface EducationScope {
  tenantId: string;
  workspaceId: string;
}
export interface ScopedConversation extends EducationScope {
  id: string;
  agentId: string;
}
export interface ScopedLead extends EducationScope {
  id: string;
}
function validateUuid(value: string, name: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(name + ' must be a UUID');
  }
}
function validateScope(scope: EducationScope): void {
  validateUuid(scope.tenantId, 'tenantId');
  validateUuid(scope.workspaceId, 'workspaceId');
}

/** Both original SQL EXISTS guards: current education purpose OR persisted
 * education conversation context. Queries are tenant + workspace scoped.
 */
export async function isEducationConversation(
  db: SqlSession, conversation: ScopedConversation,
): Promise<boolean> {
  validateScope(conversation);
  validateUuid(conversation.id, 'conversationId');
  validateUuid(conversation.agentId, 'agentId');
  const found = await db.query<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM conversations AS c
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.workspace_id = $3 AND c.agent_id = $4
         AND (
           EXISTS (
             SELECT 1 FROM agent_purpose_settings AS aps
             WHERE aps.tenant_id = c.tenant_id AND aps.workspace_id = c.workspace_id
               AND aps.agent_id = c.agent_id AND aps.purpose = 'education'
           )
           OR EXISTS (
             SELECT 1 FROM education_conversation_contexts AS ecc
             WHERE ecc.tenant_id = c.tenant_id AND ecc.workspace_id = c.workspace_id
               AND ecc.conversation_id = c.id
           )
         )
     ) AS found`,
    [conversation.id, conversation.tenantId, conversation.workspaceId, conversation.agentId],
  );
  return found.rows[0]?.found === true;
}

/** Lead records can point at historical education conversations; the agent's
 * current purpose alone must not re-enable a lead conversion.
 */
export async function isEducationLead(db: SqlSession, lead: ScopedLead): Promise<boolean> {
  validateScope(lead);
  validateUuid(lead.id, 'leadId');
  const found = await db.query<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM leads AS l
       WHERE l.id = $1 AND l.tenant_id = $2 AND l.workspace_id = $3
         AND (
           EXISTS (
             SELECT 1 FROM agent_purpose_settings AS aps
             WHERE aps.tenant_id = l.tenant_id AND aps.workspace_id = l.workspace_id
               AND aps.agent_id = l.agent_id AND aps.purpose = 'education'
           )
           OR EXISTS (
             SELECT 1 FROM education_conversation_contexts AS ecc
             WHERE ecc.tenant_id = l.tenant_id AND ecc.workspace_id = l.workspace_id
               AND ecc.conversation_id = l.conversation_id
           )
         )
     ) AS found`,
    [lead.id, lead.tenantId, lead.workspaceId],
  );
  return found.rows[0]?.found === true;
}

export async function conversationPurpose(
  db: SqlSession, conversation: ScopedConversation,
): Promise<AgentPurpose> {
  if (await isEducationConversation(db, conversation)) return AGENT_PURPOSE.EDUCATION;
  return getAgentPurpose(db, {
    tenantId: conversation.tenantId,
    workspaceId: conversation.workspaceId,
    agentId: conversation.agentId,
  });
}
