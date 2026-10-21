import { randomBytes, createHash } from 'node:crypto';
import argon2 from 'argon2';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

export type TokenType = 'access' | 'refresh' | 'widget' | 'whatsapp_signup' | 'mfa_challenge';
export interface TokenSettings {
  jwtSecret: string;
  jwtIssuer: string;
  jwtAudience: string;
  accessTtlMinutes: number;
  refreshTtlDays: number;
  whatsappSignupTtlSeconds: number;
}

export function readTokenSettings(env: NodeJS.ProcessEnv = process.env): TokenSettings {
  const jwtSecret = env.JWT_SECRET || '';
  if (jwtSecret.length < 32 || /change-me|replace-/i.test(jwtSecret)) {
    throw new Error('A strong JWT_SECRET of at least 32 characters is required');
  }
  return {
    jwtSecret,
    jwtIssuer: env.JWT_ISSUER || 'northstar-api',
    jwtAudience: env.JWT_AUDIENCE || 'northstar-web',
    accessTtlMinutes: Number(env.JWT_ACCESS_TTL_MINUTES || 30),
    refreshTtlDays: Number(env.JWT_REFRESH_TTL_DAYS || 14),
    whatsappSignupTtlSeconds: Number(env.META_SIGNUP_SESSION_TTL_SECONDS || 600),
  };
}

export function tokenFingerprint(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function randomToken(length: number): string {
  return randomBytes(length).toString('base64url');
}

export function generateApiKey(): { plaintext: string; prefix: string; fingerprint: string } {
  const plaintext = 'nsk_live_' + randomToken(32);
  return { plaintext, prefix: plaintext.slice(0, 16), fingerprint: tokenFingerprint(plaintext) };
}

/** Match Python argon2-cffi PasswordHasher policy; verify stored Python hashes. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, {
    type: argon2.argon2id, timeCost: 3, memoryCost: 65536,
    parallelism: 4, hashLength: 32, saltLength: 16,
  });
}
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) return false;
  try { return await argon2.verify(hash, password); }
  catch { return false; }
}

function secret(settings: TokenSettings): Uint8Array {
  return new TextEncoder().encode(settings.jwtSecret);
}

/** Python PyJWT-compatible HS256 claims and expiry semantics. */
export async function createToken(
  subject: string, type: TokenType, ttlSeconds: number,
  claims: Record<string, string | number | boolean>,
  settings: TokenSettings,
): Promise<{ token: string; expiresAt: Date }> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) throw new Error('TTL must be positive');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + Math.ceil(ttlSeconds);
  const token = await new SignJWT({ ...claims, type })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(subject)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(exp)
    .setIssuer(settings.jwtIssuer)
    .setAudience(settings.jwtAudience)
    .setJti(randomToken(18))
    .sign(secret(settings));
  return { token, expiresAt: new Date(exp * 1000) };
}

export async function createAccessToken(
  userId: string, tenantId: string, role: string,
  settings: TokenSettings, options: {
    credentialVersion?: number; platformActorId?: string;
    impersonationId?: string; ttlMinutes?: number;
  } = {},
) {
  return createToken(userId, 'access', (options.ttlMinutes || settings.accessTtlMinutes) * 60, {
    tid: tenantId, role, cv: options.credentialVersion ?? 0,
    ...(options.platformActorId ? { platformActorId: options.platformActorId } : {}),
    ...(options.impersonationId ? { impersonationId: options.impersonationId } : {}),
  }, settings);
}

export async function createRefreshToken(
  userId: string, tenantId: string, role: string, settings: TokenSettings,
  options: { familyId?: string; credentialVersion?: number } = {},
) {
  return createToken(userId, 'refresh', settings.refreshTtlDays * 86400, {
    tid: tenantId, role, fid: options.familyId || randomToken(18), cv: options.credentialVersion ?? 0,
  }, settings);
}

export async function createMfaChallengeToken(
  userId: string, tenantId: string, role: string, settings: TokenSettings, credentialVersion = 0,
) {
  return createToken(userId, 'mfa_challenge', 5 * 60, {
    tid: tenantId, role, cv: credentialVersion,
  }, settings);
}

export async function createWidgetToken(
  tenantId: string, agentId: string, conversationId: string, origin: string, settings: TokenSettings,
) {
  return createToken(conversationId, 'widget', 12 * 3600, {
    tid: tenantId, aid: agentId, origin,
  }, settings);
}

export async function createWhatsappSignupToken(
  userId: string, tenantId: string, settings: TokenSettings,
) {
  return createToken(userId, 'whatsapp_signup', settings.whatsappSignupTtlSeconds, {
    tid: tenantId,
  }, settings);
}

export async function decodeToken(
  token: string, expectedType: TokenType, settings: TokenSettings,
): Promise<JWTPayload & { type: TokenType }> {
  try {
    const { payload } = await jwtVerify(token, secret(settings), {
      algorithms: ['HS256'], issuer: settings.jwtIssuer, audience: settings.jwtAudience,
      requiredClaims: ['exp', 'iat', 'nbf', 'iss', 'aud', 'sub', 'jti', 'type'],
    });
    if (payload.type !== expectedType) throw new Error('unexpected token type');
    return payload as JWTPayload & { type: TokenType };
  } catch {
    throw new Error('invalid or expired token');
  }
}
