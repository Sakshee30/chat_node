import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReadiness } from '../src/readiness.js';

test('development requires database but not redis or nvidia', async () => {
 const result = await evaluateReadiness(
  {database:async()=>true,redis:async()=>false,nvidiaConfigured:()=>false},
  {production:false,requireNvidia:false});
 assert.deepEqual(result,{status:'ready',checks:{database:'ok',redis:'unavailable',nvidia:'not-configured'}});
});
test('production requires redis and optional nvidia per source rules', async () => {
 const deps={database:async()=>true,redis:async()=>true,nvidiaConfigured:()=>false};
 assert.equal((await evaluateReadiness(deps,{production:true,requireNvidia:true})).status,'not-ready');
 assert.equal((await evaluateReadiness(deps,{production:true,requireNvidia:false})).status,'ready');
});
test('database failures are not disclosed and readiness fails closed', async () => {
 const result=await evaluateReadiness(
  {database:async()=>{throw Error('credentials secret')},redis:async()=>true,nvidiaConfigured:()=>true},
  {production:true,requireNvidia:true});
 assert.equal(result.status,'not-ready');
 assert.equal(result.checks.database,'unavailable');
});
