import assert from 'node:assert/strict';
import test from 'node:test';
import { RedisServices, SessionStoreUnavailable, FIXED_WINDOW_SCRIPT, ROTATE_REFRESH_SCRIPT, type RedisRateStore } from '../src/rate-limit.js';

function rejectingRedis(): RedisRateStore {
  return {
    eval:async()=>{throw new Error('Redis unavailable');},
    set:async()=>{throw new Error('Redis unavailable');},
    del:async()=>{throw new Error('Redis unavailable');},
  };
}
test('source-compatible redis window key and atomic Lua script', async()=>{
 let args: unknown[] = [];
 const db:RedisRateStore={
   eval:async(...inputs)=>{args=inputs;return [3,27]},
   set:async()=>undefined,del:async()=>undefined,
 };
 const svc=new RedisServices(db,{failOpen:false,nowSeconds:()=>180});
 assert.deepEqual(await svc.checkRateLimit('telegram-manager',5,60),{allowed:true,remaining:2,retryAfter:27});
 assert.equal(args[0],FIXED_WINDOW_SCRIPT);
 assert.equal(args[1],1);
 assert.equal(args[2],'northstar:rl:telegram-manager:3');
 assert.equal(args[3],60);
});
test('Redis down denies instead of granting when failOpen is disabled',async()=>{
 const svc=new RedisServices(rejectingRedis(),{failOpen:false,nowSeconds:()=>60});
 assert.deepEqual(await svc.checkRateLimit('login',3,60),{allowed:false,remaining:0,retryAfter:60});
 await assert.rejects(svc.rememberRefreshFamily('f','jti',30),SessionStoreUnavailable);
 await assert.rejects(svc.rotateRefreshFamily('f','jti','next',30),SessionStoreUnavailable);
 await assert.rejects(svc.revokeRefreshFamily('f'),SessionStoreUnavailable);
});
test('source-compatible in-memory fallback limits requests within window',async()=>{
 let now=50;
 const svc=new RedisServices(rejectingRedis(),{failOpen:true,nowSeconds:()=>60,monotonicMs:()=>now});
 assert.equal((await svc.checkRateLimit('chat',2)).allowed,true);
 assert.equal((await svc.checkRateLimit('chat',2)).remaining,0);
 assert.deepEqual(await svc.checkRateLimit('chat',2),{allowed:false,remaining:0,retryAfter:60});
 now=60100;
 assert.equal((await svc.checkRateLimit('chat',2)).allowed,true);
});
test('refresh family rotation denies replay and revokes the family in fallback',async()=>{
 let now=20;
 const svc=new RedisServices(rejectingRedis(),{failOpen:true,monotonicMs:()=>now});
 await svc.rememberRefreshFamily('family','first',60);
 assert.equal(await svc.rotateRefreshFamily('family','first','second',60),true);
 assert.equal(await svc.rotateRefreshFamily('family','first','third',60),false);
 assert.equal(await svc.rotateRefreshFamily('family','second','third',60),false);
 await svc.rememberRefreshFamily('family','new',1);
 now=2000;
 assert.equal(await svc.rotateRefreshFamily('family','new','next',60),false);
});
test('uses Lua compare-and-rotate result exactly without local rewrites',async()=>{
 const calls:unknown[][]=[];
 const db:RedisRateStore={
   eval:async(...args)=>{calls.push(args);return 1;},
   set:async()=>undefined,del:async()=>undefined,
 };
 const svc=new RedisServices(db,{failOpen:false});
 assert.equal(await svc.rotateRefreshFamily('family','a','b',100),true);
 assert.deepEqual(calls[0],[ROTATE_REFRESH_SCRIPT,1,'northstar:refresh-family:family','a','b',100]);
});
test('invalid parameters cannot create immortal counters or sessions',async()=>{
 const svc=new RedisServices(rejectingRedis(),{failOpen:true});
 await assert.rejects(svc.checkRateLimit('x',0),/positive integer/);
 await assert.rejects(svc.rememberRefreshFamily('x','y',0),/positive integer/);
});
