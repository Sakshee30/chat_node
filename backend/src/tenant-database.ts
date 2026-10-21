import type { QueryResult, SqlSession } from './agent-purpose.js';

/**
 * PostgreSQL RLS transaction boundary from northstar_api/database.py.
 * Keeps one pooled connection for BEGIN, SET LOCAL ROLE and tenant context,
 * and all callback queries. The session cannot outlive its callback.
 */
export interface TransactionClient {
  query<Row = Record<string, unknown>>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
  release(): void;
}
export interface TransactionPool {
  connect(): Promise<TransactionClient>;
}
export interface TenantDatabaseConfig {
  runtimeRole?: string;
}

/** Validate and quote the database role identifier; never interpolate untrusted SQL. */
export function quoteRuntimeRole(role: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(role)) {
    throw new TypeError('Invalid PostgreSQL runtime role');
  }
  return '"' + role + '"';
}
function validateTenantId(value: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new TypeError('Tenant ID must be a UUID');
  }
}
export async function withTenantTransaction<T>(
  pool: TransactionPool,
  tenantId: string,
  fn: (db: SqlSession) => Promise<T>,
  config: TenantDatabaseConfig = {},
): Promise<T> {
  validateTenantId(tenantId);
  const quotedRole = config.runtimeRole ? quoteRuntimeRole(config.runtimeRole) : null;
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    await client.query('BEGIN');
    transactionStarted = true;
    if (quotedRole) await client.query('SET LOCAL ROLE ' + quotedRole);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    // The scoped client remains valid only within this callback, until COMMIT.
    const result = await fn(client);
    await client.query('COMMIT');
    transactionStarted = false;
    return result;
  } catch (error) {
    if (transactionStarted) {
      try { await client.query('ROLLBACK'); }
      catch { /* Preserve the original error; a failed connection cannot be reused safely. */ }
    }
    throw error;
  } finally {
    client.release();
  }
}
