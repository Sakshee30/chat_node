import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { createRefreshToken, decodeToken, type TokenSettings } from '../src/security.js';
import { type RefreshDependencies } from '../src/auth-refresh.js';

const settings: TokenSettings = {
  jwtSecret:'this-is-a-test-secret-that-exceeds-32-characters',
  jwtIssuer:'northstar-api',jwtAudience:'northstar-web',
  accessTtlMinutes:30,refreshTtlDays:14,whatsappSignupTtlSeconds:600,
};
const userId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tenantId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function dependencies() {
  let storedJti='';
  let rotations=0;
  const deps: RefreshDependencies = {
    findIdentity: async()=>({
      id:userId,tenantId,name:'Test User',email:'test@example.org',
      role:'member',isActive:true,emailVerified:true,credentialVersion:3,
    }),
    rotateFamily: async (_family, oldJti,newJti)=>{
      rotations++;
      if(oldJti !== storedJti)return false;
      storedJti=newJti;
      return true;
    },
  };
  return {deps,initialize:(jti:string)=>{storedJti=jti;},get rotations(){return rotations;}};
}
test('without verified DB and Redis dependencies refresh endpoint fails closed',async()=>{
  const app=buildApp({env:{JWT_SECRET:settings.jwtSecret}});
  try {
    const response=await app.inject({method:'POST',url:'/api/v1/auth/refresh',payload:{}});
    assert.equal(response.statusCode,503);
    assert.equal(response.body.includes('access_token'),false);
  }finally{await app.close();}
});
test('refresh endpoint issues access token and rotates family once, replay rejected',async()=>{
  const deps=dependencies();
  const first=await createRefreshToken(userId,tenantId,'member',settings,{credentialVersion:3,familyId:'f1'});
  const claims=await decodeToken(first.token,'refresh',settings);
  deps.initialize(String(claims.jti));
  const app=buildApp({env:{JWT_SECRET:settings.jwtSecret},authRefresh:deps.deps});
  try {
    const result=await app.inject({method:'POST',url:'/api/v1/auth/refresh',payload:{refresh_token:first.token}});
    assert.equal(result.statusCode,200);
    const session=result.json();
    assert.equal(session.user.id,userId);
    assert.equal(session.user.email_verified,true);
    assert.equal(session.refresh_token !== null,true);
    assert.equal((await decodeToken(session.access_token,'access',settings)).tid,tenantId);
    assert.match(String(result.headers['set-cookie']),/HttpOnly; SameSite=Strict/);
    assert.equal(result.headers['cache-control'],'no-store');
    const replay=await app.inject({method:'POST',url:'/auth/refresh',payload:{refresh_token:first.token}});
    assert.equal(replay.statusCode,401);
    assert.equal(deps.rotations,2);
  }finally{await app.close();}
});
test('production refresh hides refresh token in body and uses Secure cookie',async()=>{
  const deps=dependencies();
  const first=await createRefreshToken(userId,tenantId,'member',settings,{credentialVersion:3});
  deps.initialize(String((await decodeToken(first.token,'refresh',settings)).jti));
  const app=buildApp({env:{JWT_SECRET:settings.jwtSecret,APP_ENV:'production'},authRefresh:deps.deps});
  try {
    const response=await app.inject({method:'POST',url:'/api/v1/auth/refresh',headers:{cookie:'northstar_refresh='+encodeURIComponent(first.token)}});
    assert.equal(response.statusCode,200);
    assert.equal(response.json().refresh_token,null);
    assert.match(String(response.headers['set-cookie']),/Secure/);
  }finally{await app.close();}
});
test('credential-version mismatch returns 401 without rotating anything',async()=>{
  const deps=dependencies();
  const first=await createRefreshToken(userId,tenantId,'member',settings,{credentialVersion:0});
  const app=buildApp({env:{JWT_SECRET:settings.jwtSecret},authRefresh:deps.deps});
  try {
    const response=await app.inject({method:'POST',url:'/api/v1/auth/refresh',payload:{refresh_token:first.token}});
    assert.equal(response.statusCode,401);
    assert.equal(deps.rotations,0);
  }finally{await app.close();}
});
test('malformed refresh JWT does not query DB or issue tokens',async()=>{
  let calls=0;
  const app=buildApp({env:{JWT_SECRET:settings.jwtSecret},authRefresh:{
    findIdentity:async()=>{calls++;return null;},rotateFamily:async()=>{calls++;return true;},
  }});
  try {
    const response=await app.inject({method:'POST',url:'/api/v1/auth/refresh',payload:{refresh_token:'invalid'}});
    assert.equal(response.statusCode,401);
    assert.equal(calls,0);
  }finally{await app.close();}
});
