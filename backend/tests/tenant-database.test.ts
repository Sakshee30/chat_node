import assert from 'node:assert/strict';
import test from 'node:test';
import { quoteRuntimeRole, withTenantTransaction, type TransactionPool, type TransactionClient } from '../src/tenant-database.js';
import { getAgentPurpose } from '../src/agent-purpose.js';

const TENANT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT='cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function fakePool(failOn?: string) {
  const calls: Array<{sql:string;values?:readonly unknown[]}> = [];
  let released=0;
  const client:TransactionClient={
    async query<Row = Record<string,unknown>>(sql:string,values?:readonly unknown[]){
      calls.push({sql,values});
      if (failOn && sql.includes(failOn)) throw new Error('injected error');
      return {rows: [] as Row[]};
    },
    release(){ released++; },
  };
  const pool:TransactionPool={async connect(){return client;}};
  return {pool,calls,get releases(){return released;}};
}
test('every query is inside a tenant-scoped transaction on one connection',async()=>{
  const f=fakePool();
  const result=await withTenantTransaction(f.pool,TENANT,async(db)=>{
    await db.query('SELECT * FROM agents WHERE tenant_id=$1',[TENANT]);
    return 42;
  },{runtimeRole:'northstar_runtime'});
  assert.equal(result,42);
  assert.deepEqual(f.calls.map(c=>c.sql),[
    'BEGIN','SET LOCAL ROLE "northstar_runtime"',
    "SELECT set_config('app.tenant_id', $1, true)",
    'SELECT * FROM agents WHERE tenant_id=$1','COMMIT',
  ]);
  assert.deepEqual(f.calls[2]?.values,[TENANT]);
  assert.equal(f.releases,1);
});
test('business error causes rollback and releases connection',async()=>{
  const f=fakePool();
  await assert.rejects(withTenantTransaction(f.pool,TENANT,async()=>{
    throw new Error('business failed');
  }),/business failed/);
  assert.deepEqual(f.calls.map(c=>c.sql),['BEGIN',"SELECT set_config('app.tenant_id', $1, true)",'ROLLBACK']);
  assert.equal(f.releases,1);
});
test('tenant context initialization failure rolls back rather than running callback',async()=>{
  const f=fakePool('set_config');
  let executed=false;
  await assert.rejects(withTenantTransaction(f.pool,TENANT,async()=>{executed=true;}));
  assert.equal(executed,false);
  assert.equal(f.calls.at(-1)?.sql,'ROLLBACK');
  assert.equal(f.releases,1);
});
test('invalid runtime roles and tenant identifiers never reach database',async()=>{
  const f=fakePool();
  for(const role of ['x"; DROP TABLE tenants; --','runtime-role','']) {
    if(role) assert.throws(()=>quoteRuntimeRole(role),/Invalid/);
  }
  await assert.rejects(withTenantTransaction(f.pool,'not-a-uuid',async()=>false));
  await assert.rejects(withTenantTransaction(f.pool,TENANT,async()=>false,{runtimeRole:'danger;--'}));
  assert.equal(f.calls.length,0);
  assert.equal(f.releases,0);
});
test('agent-purpose repository works within inherited transaction boundary',async()=>{
  const f=fakePool();
  assert.equal(await withTenantTransaction(f.pool,TENANT, db=>
    getAgentPurpose(db,{tenantId:TENANT,workspaceId:WORKSPACE,agentId:AGENT})), 'support');
  assert.equal(f.calls[2]?.sql.includes('tenant_id = $1'),true);
  assert.equal(f.calls.at(-1)?.sql,'COMMIT');
});
