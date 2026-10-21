import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';

test('Prometheus metrics endpoint serves the proper format', async () => {
  const app=buildApp({probes:{
    database:async()=>false,redis:async()=>false,nvidiaConfigured:()=>false,
  }});
  try {
    const health=await app.inject({method:'GET',url:'/health/live'});
    assert.equal(health.statusCode,200);
    const metrics=await app.inject({method:'GET',url:'/metrics'});
    assert.equal(metrics.statusCode,200);
    assert.match(String(metrics.headers['content-type']),/text\/plain/);
    assert.match(metrics.body,/northstar_node_http_requests_total/);
    assert.match(metrics.body,/method="GET",status_code="200"/);
    assert.match(metrics.body,/northstar_node_http_request_duration_seconds/);
    assert.match(metrics.body,/northstar_node_process_cpu_user_seconds_total/);
  } finally { await app.close(); }
});

test('Metrics do not include tenant identifiers or request path labels',async()=>{
  const app=buildApp();
  try {
    const secret='tenant-private-12345';
    await app.inject({method:'GET',url:'/no-route?workspace='+secret});
    const result=await app.inject({method:'GET',url:'/metrics'});
    assert.equal(result.statusCode,200);
    assert.equal(result.body.includes(secret),false);
    assert.equal(result.body.includes('/no-route'),false);
    assert.match(result.body,/status_code="404"/);
  }finally{await app.close();}
});
