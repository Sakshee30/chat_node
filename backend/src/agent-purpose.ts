/** Port of northstar_api/agent_purpose.py.
 * Data access uses the existing PostgreSQL schema; database migrations and
 * auth-aware API routes are separate migration work.
 */
export const AGENT_PURPOSE = {
  SUPPORT: 'support',
  LEAD_GENERATION: 'lead_generation',
  EDUCATION: 'education',
} as const;

export type AgentPurpose = typeof AGENT_PURPOSE[keyof typeof AGENT_PURPOSE];
export type QueryResult<Row> = { rows: Row[] };
export interface SqlSession {
  query<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}
export interface AgentScope { id: string; tenantId: string; workspaceId: string }
export interface AgentPurposeSetting {
  agent_id: string;
  tenant_id: string;
  workspace_id: string;
  purpose: AgentPurpose;
  created_at: Date;
  updated_at: Date;
}

export function normalizeAgentPurpose(value: unknown): AgentPurpose {
  return value === AGENT_PURPOSE.LEAD_GENERATION || value === AGENT_PURPOSE.EDUCATION
    ? value
    : AGENT_PURPOSE.SUPPORT;
}

function validateUuid(value: string, field: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError(`${field} must be a UUID`);
  }
}

/** Safe fallback matches Python when an agent has no setting or a bad legacy value. */
export async function getAgentPurpose(
  db: SqlSession,
  scope: { tenantId: string; workspaceId: string; agentId: string },
): Promise<AgentPurpose> {
  validateUuid(scope.tenantId, 'tenantId');
  validateUuid(scope.workspaceId, 'workspaceId');
  validateUuid(scope.agentId, 'agentId');
  const result = await db.query<{ purpose: unknown }>(
    `SELECT purpose FROM agent_purpose_settings
     WHERE tenant_id = $1 AND workspace_id = $2 AND agent_id = $3`,
    [scope.tenantId, scope.workspaceId, scope.agentId],
  );
  return normalizeAgentPurpose(result.rows[0]?.purpose);
}

/** Atomic upsert; the caller owns transaction commit/rollback and must supply
 * a verified agent scope from the authorized tenant/workspace.
 */
export async function setAgentPurpose(
  db: SqlSession, agent: AgentScope, purpose: AgentPurpose,
): Promise<AgentPurposeSetting> {
  validateUuid(agent.id, 'agentId');
  validateUuid(agent.tenantId, 'tenantId');
  validateUuid(agent.workspaceId, 'workspaceId');
  if (![AGENT_PURPOSE.SUPPORT, AGENT_PURPOSE.LEAD_GENERATION, AGENT_PURPOSE.EDUCATION].includes(purpose)) {
    throw new TypeError('Unsupported agent purpose');
  }
  const result = await db.query<AgentPurposeSetting>(
    `INSERT INTO agent_purpose_settings (agent_id, tenant_id, workspace_id, purpose)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (agent_id)
     DO UPDATE SET tenant_id = EXCLUDED.tenant_id,
                   workspace_id = EXCLUDED.workspace_id,
                   purpose = EXCLUDED.purpose,
                   updated_at = CURRENT_TIMESTAMP
     RETURNING agent_id, tenant_id, workspace_id, purpose, created_at, updated_at`,
    [agent.id, agent.tenantId, agent.workspaceId, purpose],
  );
  if (!result.rows[0]) throw new Error('Agent purpose write returned no row');
  return result.rows[0];
}
