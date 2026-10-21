import { isIP } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';

export interface TelegramManagerConfiguration {
  token: string;
  username: string;
  webhookSecret: string;
  publicBaseUrl: string;
}
export class TelegramManagerError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'TelegramManagerError';
  }
}
const unavailable = 'The platform Telegram manager is not configured. Contact the platform owner.';
const malformedOrigin = 'Configure a public HTTPS TELEGRAM_PUBLIC_BASE_URL before connecting Telegram';
const privateIpV4 = (host: string): boolean => {
  const v = host.split('.').map(Number);
  const [a,b,c] = v;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2))))
    || (a === 198 && ((b === 18 || b === 19) || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || (a === 198 && b === 51 && c === 100);
};

export function publicTelegramBase(raw: string): string {
  const normalized = raw.trim().replace(/\/+$/, '');
  let parsed: URL;
  try { parsed = new URL(normalized); }
  catch { throw new TelegramManagerError(503, malformedOrigin); }
  let host = parsed.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  const ipVersion = isIP(host);
  const ipIsPrivate = ipVersion === 4 ? privateIpV4(host)
    : ipVersion === 6; // Intentionally conservative: deny all IPv6 literals until global-range validation is audited
  const localName = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local');
  if (parsed.protocol !== 'https:' || !host || localName || ipIsPrivate
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || parsed.pathname !== '/' || (parsed.port && parsed.port !== '443')) {
    throw new TelegramManagerError(503, malformedOrigin);
  }
  return normalized;
}

/** Matches the Python Telegram manager provisioning configuration prerequisites. */
export function telegramManagerConfig(env: NodeJS.ProcessEnv): TelegramManagerConfiguration {
  const token = env.TELEGRAM_MANAGER_BOT_TOKEN || '';
  const username = (env.TELEGRAM_MANAGER_BOT_USERNAME || '').trim();
  const webhookSecret = env.TELEGRAM_MANAGER_WEBHOOK_SECRET || '';
  if (!token || !/^[A-Za-z0-9_]{5,32}$/.test(username) || !/^[A-Za-z0-9_-]{32,256}$/.test(webhookSecret)) {
    throw new TelegramManagerError(503, unavailable);
  }
  return { token, username, webhookSecret, publicBaseUrl: publicTelegramBase(env.TELEGRAM_PUBLIC_BASE_URL || '') };
}

/** Fixed-size digest comparisons avoid leaking the expected secret length or bytes. */
export function verifyTelegramWebhookSecret(expected: string, supplied: string | undefined): boolean {
  const lhs = createHash('sha256').update(expected, 'utf8').digest();
  const rhs = createHash('sha256').update(supplied || '', 'utf8').digest();
  return Boolean(expected) && timingSafeEqual(lhs, rhs);
}

export interface TelegramManagerUpdate { update_id: number; [key: string]: unknown }
export function validateTelegramManagerUpdate(rawBody: Uint8Array): TelegramManagerUpdate {
  if (rawBody.byteLength > 65_536) {
    throw new TelegramManagerError(413, 'Manager webhook payload is too large');
  }
  let decoded: unknown;
  try { decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody)); }
  catch { throw new TelegramManagerError(400, 'Invalid webhook JSON'); }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)
      || !Object.hasOwn(decoded, 'update_id')
      || typeof (decoded as Record<string,unknown>).update_id !== 'number'
      || !Number.isSafeInteger((decoded as Record<string,unknown>).update_id)) {
    throw new TelegramManagerError(400, 'Invalid Telegram update');
  }
  return decoded as TelegramManagerUpdate;
}
