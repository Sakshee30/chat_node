/** Port of northstar_api/services/rate_limit.py.
 * The same Redis keys and Lua scripts permit mixed Python/Node operation.
 * Inject a Redis client; this module never opens hidden network connections.
 */
export const FIXED_WINDOW_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;
export const ROTATE_REFRESH_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 0 end
if current ~= ARGV[1] then redis.call('DEL', KEYS[1]); return -1 end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return 1
`;
export interface RateLimitResult { allowed: boolean; remaining: number; retryAfter: number }
export interface RedisRateStore {
  eval(script: string, keyCount: number, ...args: (string | number)[]): Promise<unknown>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}
export class SessionStoreUnavailable extends Error {
  constructor() { super('Session store unavailable'); this.name = 'SessionStoreUnavailable'; }
}
export class RedisServices {
  private readonly windows = new Map<string, { count: number; expires: number }>();
  private readonly families = new Map<string, { tokenId: string; expires: number }>();
  constructor(
    private readonly redis: RedisRateStore,
    private readonly options: { failOpen: boolean; nowSeconds?: () => number; monotonicMs?: () => number },
  ) {}
  private epochSeconds() { return this.options.nowSeconds?.() ?? Math.floor(Date.now() / 1000); }
  private monotonicMs() { return this.options.monotonicMs?.() ?? performance.now(); }
  private validPositiveInteger(value: number, field: string) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive integer`);
  }
  async checkRateLimit(key: string, limit: number, windowSeconds = 60): Promise<RateLimitResult> {
    this.validPositiveInteger(limit, 'limit');
    this.validPositiveInteger(windowSeconds, 'windowSeconds');
    const namespace = `northstar:rl:${key}:${Math.floor(this.epochSeconds() / windowSeconds)}`;
    try {
      const response = await this.redis.eval(FIXED_WINDOW_SCRIPT, 1, namespace, windowSeconds);
      if (!Array.isArray(response) || response.length < 2) throw new Error('Invalid Redis rate-limit result');
      const count = Number(response[0]);
      const ttl = Number(response[1]);
      if (!Number.isFinite(count) || !Number.isFinite(ttl)) throw new Error('Invalid Redis rate-limit counters');
      return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: Math.max(1, Math.trunc(ttl)) };
    } catch {
      if (!this.options.failOpen) return { allowed: false, remaining: 0, retryAfter: windowSeconds };
      const now = this.monotonicMs();
      const old = this.windows.get(namespace);
      const count = !old || old.expires <= now ? 1 : old.count + 1;
      const expires = !old || old.expires <= now ? now + windowSeconds * 1000 : old.expires;
      this.windows.set(namespace, { count, expires });
      if (this.windows.size > 10_000) {
        for (const [item, value] of this.windows) if (value.expires <= now) this.windows.delete(item);
      }
      return { allowed: count <= limit, remaining: Math.max(0, limit - count),
        retryAfter: Math.max(1, Math.trunc((expires - now) / 1000)) };
    }
  }
  async rememberRefreshFamily(familyId: string, tokenId: string, ttlSeconds: number): Promise<void> {
    this.validPositiveInteger(ttlSeconds, 'ttlSeconds');
    try { await this.redis.set(`northstar:refresh-family:${familyId}`, tokenId, 'EX', ttlSeconds); }
    catch {
      if (!this.options.failOpen) throw new SessionStoreUnavailable();
      this.families.set(familyId, { tokenId, expires: this.monotonicMs() + ttlSeconds * 1000 });
    }
  }
  async rotateRefreshFamily(familyId: string, currentTokenId: string, nextTokenId: string, ttlSeconds: number): Promise<boolean> {
    this.validPositiveInteger(ttlSeconds, 'ttlSeconds');
    const key = `northstar:refresh-family:${familyId}`;
    try {
      const result = await this.redis.eval(ROTATE_REFRESH_SCRIPT, 1, key, currentTokenId, nextTokenId, ttlSeconds);
      return Number(result) === 1;
    } catch {
      if (!this.options.failOpen) throw new SessionStoreUnavailable();
      const now = this.monotonicMs();
      const previous = this.families.get(familyId);
      if (!previous || previous.expires <= now || previous.tokenId !== currentTokenId) {
        this.families.delete(familyId); return false;
      }
      this.families.set(familyId, { tokenId: nextTokenId, expires: now + ttlSeconds * 1000 });
      return true;
    }
  }
  async revokeRefreshFamily(familyId: string): Promise<void> {
    try { await this.redis.del(`northstar:refresh-family:${familyId}`); }
    catch { if (!this.options.failOpen) throw new SessionStoreUnavailable(); }
    finally { this.families.delete(familyId); }
  }
}
