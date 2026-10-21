import { createAccessToken, createRefreshToken, decodeToken, type TokenSettings } from './security.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const REFRESH_COOKIE = 'northstar_refresh';

export class RefreshError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'RefreshError';
  }
}

export interface RefreshIdentity {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  emailVerified: boolean;
  credentialVersion: number;
}

export interface RefreshDependencies {
  /** Must perform an authoritative DB lookup, including active tenant membership,
   * user state, email verification and credential version. Do not infer identity from JWT. */
  findIdentity(userId: string, tenantId: string): Promise<RefreshIdentity | null>;
  /** Must perform the Redis compare-and-rotate atomically; never accept replay. */
  rotateFamily(familyId: string, oldJti: string, newJti: string, ttlSeconds: number): Promise<boolean>;
}

export interface RefreshSession {
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  user: { id: string; name: string; email: string; role: string; email_verified: boolean };
}

export async function refreshSession(
  refreshToken: string | undefined | null,
  deps: RefreshDependencies,
  settings: TokenSettings,
  production: boolean,
): Promise<{ session: RefreshSession; cookieToken: string }> {
  if (!refreshToken) throw new RefreshError(401, 'Invalid or expired refresh token');
  let claims: Awaited<ReturnType<typeof decodeToken>>;
  try { claims = await decodeToken(refreshToken, 'refresh', settings); }
  catch { throw new RefreshError(401, 'Invalid or expired refresh token'); }
  const userId = claims.sub;
  const tenantId = claims.tid;
  const familyId = claims.fid;
  const currentJti = claims.jti;
  if (typeof userId !== 'string' || !UUID.test(userId)
    || typeof tenantId !== 'string' || !UUID.test(tenantId)
    || typeof familyId !== 'string' || !familyId
    || typeof currentJti !== 'string' || !currentJti) {
    throw new RefreshError(401, 'Invalid or expired refresh token');
  }

  const identity = await deps.findIdentity(userId, tenantId);
  if (!identity || !identity.isActive || identity.id !== userId || identity.tenantId !== tenantId) {
    throw new RefreshError(401, 'Account or workspace is unavailable');
  }
  if (!Number.isSafeInteger(identity.credentialVersion) || identity.credentialVersion < 0
      || claims.cv !== identity.credentialVersion) {
    throw new RefreshError(401, 'Session credentials changed; sign in again');
  }
  const access = await createAccessToken(userId, tenantId, identity.role, settings, {
    credentialVersion: identity.credentialVersion,
  });
  const rotated = await createRefreshToken(userId, tenantId, identity.role, settings, {
    familyId, credentialVersion: identity.credentialVersion,
  });
  const rotatedClaims = await decodeToken(rotated.token, 'refresh', settings);
  try {
    const ok = await deps.rotateFamily(familyId, currentJti, String(rotatedClaims.jti),
      settings.refreshTtlDays * 86_400);
    if (!ok) throw new RefreshError(401, 'Invalid or reused refresh token');
  } catch (err) {
    if (err instanceof RefreshError) throw err;
    throw new RefreshError(503, 'Session service unavailable');
  }
  return {
    cookieToken: rotated.token,
    session: {
      access_token: access.token,
      refresh_token: production ? null : rotated.token,
      expires_at: access.expiresAt.toISOString(),
      user: {
        id: identity.id, name: identity.name, email: identity.email,
        role: identity.role, email_verified: identity.emailVerified,
      },
    },
  };
}

export function buildRefreshCookie(token: string, settings: TokenSettings, production: boolean, apiPrefix = '/api/v1'): string {
  const prefix = apiPrefix.replace(/\/+$/, '');
  return [
    `${REFRESH_COOKIE}=${encodeURIComponent(token)}`,
    `Max-Age=${settings.refreshTtlDays * 86_400}`,
    `Path=${prefix}/auth`, 'HttpOnly', 'SameSite=Strict',
    ...(production ? ['Secure'] : []),
  ].join('; ');
}
export function extractRefreshCookie(cookieHeader: string | undefined): string | undefined {
  for (const part of (cookieHeader || '').split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === REFRESH_COOKIE) {
      try { return decodeURIComponent(value.join('=')); }
      catch { return undefined; }
    }
  }
  return undefined;
}
