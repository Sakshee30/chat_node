import assert from 'node:assert/strict';
import test from 'node:test';
import {TelegramBotClient,TelegramAPIError,splitTelegramText,COURSE_SWITCH_HINT} from '../src/telegram-client.js';
function fake(answer:unknown,status=200) {
 const calls:Array<{url:string;payload:Record<string,unknown>}>=[];
 const http=async(input:string|URL|Request,init?:RequestInit)=>{
   calls.push({url:String(input),payload:JSON.parse(String(init?.body)) as Record<string,unknown>});
   return new Response(JSON.stringify(answer),{status,headers:{'content-type':'application/json'}});
 };
 return {client:new TelegramBotClient({http:http as typeof fetch}),calls};
}
test('getMe maps Telegram API response and method URL',async()=>{
 const {client,calls}=fake({ok:true,result:{id:5,username:'bot'}});
 assert.equal((await client.getMe('token')).username,'bot');
 assert.equal(calls[0]?.url,'https://api.telegram.org/bottoken/getMe');
});
test('empty bot token is rejected without a network request',async()=>{
 const {client,calls}=fake({ok:true,result:{}});
 await assert.rejects(client.getMe(' '),(e:unknown)=>e instanceof TelegramAPIError&&e.requiresReconnect);
 assert.equal(calls.length,0);
});
test('retry-after and reconnect flags match source error behavior',async()=>{
 const rate=fake({ok:false,error_code:429,parameters:{retry_after:7}},429).client;
 await assert.rejects(rate.getMe('token'),(e:unknown)=>e instanceof TelegramAPIError&&e.retryable&&e.retryAfterSeconds===7);
 const invalid=fake({ok:false,error_code:401},401).client;
 await assert.rejects(invalid.getMe('token'),(e:unknown)=>e instanceof TelegramAPIError&&e.requiresReconnect&&!e.retryable);
});
test('network failure does not expose secrets',async()=>{
 const http=async()=>{throw Error('private token');};
 const client=new TelegramBotClient({http:http as typeof fetch});
 await assert.rejects(client.getMe('private-token'),(e:unknown)=>e instanceof TelegramAPIError&&e.retryable&&!e.message.includes('private-token'));
});
test('splitting respects Unicode codepoints and whitespace boundaries',()=>{
 assert.deepEqual(splitTelegramText('  hello world  ',7),['hello','world']);
 assert.deepEqual(splitTelegramText('😀😀😀😀😀',2),['😀😀','😀😀','😀']);
 assert.deepEqual(splitTelegramText(''),[]);
 assert.throws(()=>splitTelegramText('abc',0),/positive/);
});
test('setWebhook keeps configured update allowlist',async()=>{
 const {client,calls}=fake({ok:true,result:true});
 await client.setWebhook('token',{url:'https://domain.example/hook',secretToken:'secret',allowedUpdates:['message','edited_message']});
 assert.deepEqual(calls[0]?.payload,{url:'https://domain.example/hook',secret_token:'secret',allowed_updates:['message','edited_message']});
});
test('sendText escapes HTML when fixed switch-course hint is present',async()=>{
 const {client,calls}=fake({ok:true,result:{message_id:42}});
 assert.equal(await client.sendText('token',{chatId:'12',text:'<tag> & '+COURSE_SWITCH_HINT}),'42');
 assert.equal(calls[0]?.payload.parse_mode,'HTML');
 assert.equal(calls[0]?.payload.text,'&lt;tag&gt; &amp; Send <b>switch course</b> anytime to see this menu again.');
});
test('plain text does not enable HTML formatting',async()=>{
 const {client,calls}=fake({ok:true,result:{message_id:43}});
 await client.sendText('token',{chatId:'12',text:'<plain>'});
 assert.equal(calls[0]?.payload.parse_mode,undefined);
 assert.equal(calls[0]?.payload.text,'<plain>');
});
test('missing Telegram delivery message id is rejected',async()=>{
 const {client}=fake({ok:true,result:{}});
 await assert.rejects(client.sendText('token',{chatId:'12',text:'hello'}),/message ID/);
});
