import assert from 'node:assert/strict';
import test from 'node:test';
import { effectivePermissions, permits, validateDelegatedPermissions, ORGANIZATION_GRANTS, WORKSPACE_GRANTS } from '../src/access-policy.js';

test('organization owner permission is never sufficient for workspace access', () => {
  const grants = effectivePermissions('owner',null);
  assert.equal(permits('agents.view','owner',grants,true),false);
  assert.equal(permits('organization.view','owner',grants,false),true);
});
test('unknown capabilities and wildcard grants deny access', () => {
  const grants = new Set(['*','agents.*','organization.*']);
  for (const name of ['agents.view','organization.view','not.real']) {
    assert.equal(permits(name,'owner',grants,true),false);
  }
});
test('workspace permissions require workspace context and delegated grants', () => {
  const grants = effectivePermissions('member','viewer');
  assert.equal(permits('agents.read','member',grants,true),true);
  assert.equal(permits('agents.read','member',grants,false),false);
  assert.equal(permits('agents.delete','member',grants,true),false);
});
test('aliases authorize canonical names in both directions', () => {
  assert.equal(permits('channels.connect','member',new Set(['channels.connections.manage']),true),true);
  assert.equal(permits('channels.connections.manage','member',new Set(['channels.connect']),true),true);
  assert.equal(permits('channels.connect','member',new Set(['channels.view']),true),false);
});
test('organization admin cannot transfer ownership even with forged explicit grant', () => {
  const forged = new Set(['organization.ownership.transfer']);
  assert.equal(permits('organization.ownership.transfer','admin',forged,true),false);
  assert.equal(permits('organization.ownership.transfer','owner',ORGANIZATION_GRANTS.owner,true),true);
});
test('workspace manager cannot delegate workspace admin privileges', () => {
  assert.throws(() => validateDelegatedPermissions(['agents.delete'],WORKSPACE_GRANTS.manager),/Cannot delegate/);
  assert.deepEqual([...validateDelegatedPermissions(['agents.read'],WORKSPACE_GRANTS.viewer)],['agents.read']);
});
test('empty, unknown and cross-namespace delegation is forbidden', () => {
  const grants=WORKSPACE_GRANTS.workspace_admin;
  assert.throws(() => validateDelegatedPermissions([],grants),/known workspace/);
  assert.throws(() => validateDelegatedPermissions(['organization.view'],grants),/known workspace/);
  assert.throws(() => validateDelegatedPermissions(['totally-unknown'],grants),/known workspace/);
});
test('operator, analyst and viewer grant boundaries',()=>{
  assert.equal(WORKSPACE_GRANTS.operator.has('analytics.view'),false);
  assert.equal(WORKSPACE_GRANTS.analyst.has('leads.export'),true);
  assert.equal(WORKSPACE_GRANTS.viewer.has('conversations.reply'),false);
});
