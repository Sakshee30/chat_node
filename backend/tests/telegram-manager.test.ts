import assert from 'node:assert/strict';
import test from 'node:test';
import { publicTelegramBase, telegramManagerConfig, validateTelegramManagerUpdate, verifyTelegramWebhookSecret, TelegramManagerError } from '../src/telegram-manager.js';
const secret = 'ThisIsALongTelegramWebhookSecret1234567';
const env = {
  TELEGRAM_MANAGER_BOT_TOKEN: '1234567:bot-secret',
  TELEGRAM_MANAGER_BOT_USERNAME: 'Northstar_Manage_Bot',
  TELEGRAM_MANAGER_WEBHOOK_SECRET: secret,
  TELEGRAM_PUBLIC_BASE_URL: 'https://tutor.example.org/',
};

test('valid Telegram configuration requires public HTTPS and bot manager secrets', () => {
  const config = telegramManagerConfig(env);
  assert.equal(config.publicBaseUrl, 'https://tutor.example.org');
  assert.equal(config.username, 'Northstar_Manage_Bot');
});
test('Telegram config fails closed without token or sufficiently long webhook secret', () => {
  assert.throws(() => telegramManagerConfig({...env,TELEGRAM_MANAGER_BOT_TOKEN:''}), /not configured/);
  assert.throws(() => telegramManagerConfig({...env,TELEGRAM_MANAGER_WEBHOOK_SECRET:'short'}), /not configured/);
  assert.throws(() => telegramManagerConfig({...env,TELEGRAM_MANAGER_BOT_USERNAME:'a'}), /not configured/);
});
test('public Telegram origins refuse localhost, private networks, and URL credentials', () => {
  for (const value of [
    'http://tutor.example.org','https://localhost','https://10.0.0.1',
    'https://192.168.1.2','https://127.0.0.1','https://169.254.1.1',
    'https://[::1]','https://tutor.local','https://user:pass@tutor.example.org',
    'https://tutor.example.org/path','https://tutor.example.org?token=abc',
    'https://tutor.example.org:8443', 'not-a-url',
  ]) {
    assert.throws(() => publicTelegramBase(value), TelegramManagerError, value);
  }
});
test('webhook secret comparison checks exact token without leaking it', () => {
  assert.equal(verifyTelegramWebhookSecret(secret,secret),true);
  assert.equal(verifyTelegramWebhookSecret(secret,secret+'x'),false);
  assert.equal(verifyTelegramWebhookSecret(secret,undefined),false);
  assert.equal(verifyTelegramWebhookSecret('', ''),false);
});
test('Telegram body rejects invalid JSON, non-object and non-integer updates', () => {
  const bytes = (s:string)=>new TextEncoder().encode(s);
  for(const bad of ['{','null','[]','{"update_id":true}','{"update_id":"1"}','{"update_id":1.5}','{"update_id":9007199254740993}']) {
    assert.throws(()=>validateTelegramManagerUpdate(bytes(bad)),/Invalid/);
  }
  assert.deepEqual(validateTelegramManagerUpdate(bytes('{"update_id":42,"message":{"text":"hi"}}')).update_id,42);
});
test('webhook request bodies over 64 KiB are rejected', () => {
  assert.throws(()=>validateTelegramManagerUpdate(new Uint8Array(65537)), (e: unknown) =>
    e instanceof TelegramManagerError && e.statusCode===413);
});
