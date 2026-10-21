import Fastify from 'fastify';
import { evaluateReadiness, type ReadinessDependencies } from './readiness.js';
import { createProbes } from './probes.js';
import { createMetrics } from './metrics.js';
import { buildRefreshCookie, extractRefreshCookie, refreshSession, RefreshError, type RefreshDependencies } from './auth-refresh.js';
import { readTokenSettings } from './security.js';

export interface AppOptions {
  probes?: ReadinessDependencies;
  env?: NodeJS.ProcessEnv;
  authRefresh?: RefreshDependencies;
}

/** API gateway migration in progress: only the operations routes are implemented. */
export function buildApp(options: AppOptions = {}) {
  const env = options.env ?? process.env;
  const app = Fastify({ logger: true });
  const probes = options.probes ?? createProbes(env);
  const metrics = createMetrics();
  const started = new WeakMap<object, bigint>();
  app.addHook('onRequest', async (request) => {
    started.set(request, process.hrtime.bigint());
  });
  app.addHook('onResponse', async (request, reply) => {
    const start = started.get(request);
    if (start !== undefined) {
      const elapsedSeconds = Math.max(0, Number(process.hrtime.bigint() - start) / 1e9);
      metrics.record(request.method, reply.statusCode, elapsedSeconds);
    }
  });
  app.addHook('onClose', async () => { await metrics.close(); });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
    if (env.APP_ENV === 'production') {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    return payload;
  });

  app.get('/health/live', async () => ({ status: 'ok' }));

  // Account validation and atomic Redis rotation MUST be configured for
  // refresh to operate; never issue sessions from an unchecked JWT alone.
  for (const route of ['/api/v1/auth/refresh', '/auth/refresh']) {
    app.post<{ Body?: { refresh_token?: string } }>(route, async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      reply.header('Pragma', 'no-cache');
      if (!options.authRefresh) {
        return reply.code(503).send({ detail: 'Authentication migration is not configured' });
      }
      const body = request.body;
      const token = (body && typeof body.refresh_token === 'string' ? body.refresh_token : undefined)
        || extractRefreshCookie(request.headers.cookie);
      try {
        const settings = readTokenSettings(env);
        const result = await refreshSession(token, options.authRefresh, settings, env.APP_ENV === 'production');
        reply.header('Set-Cookie', buildRefreshCookie(result.cookieToken, settings, env.APP_ENV === 'production'));
        return result.session;
      } catch (error) {
        if (error instanceof RefreshError) return reply.code(error.statusCode).send({ detail: error.message });
        request.log.error({ errorType: error instanceof Error ? error.name : 'unknown' }, 'Refresh failed');
        return reply.code(503).send({ detail: 'Session service unavailable' });
      }
    });
  }

  // Source-compatible Prometheus endpoint. No raw paths or sensitive user labels.
  app.get('/metrics', async (_request, reply) => {
    return reply.type(metrics.contentType).send(await metrics.snapshot());
  });

  app.get('/health/ready', async (_request, reply) => {
    const result = await evaluateReadiness(probes, {
      production: env.APP_ENV === 'production',
      requireNvidia: env.REQUIRE_NVIDIA === 'true',
    });
    // Readiness must not return 200 before the rest of the platform is migrated.
    return reply.code(503).send({
      ...result,
      status: 'not-ready',
      migration: 'incomplete',
    });
  });

  app.setNotFoundHandler(async (request, reply) => reply.code(404).send({
    error: { code: 'http_404', message: 'Route not implemented', requestId: request.id },
  }));

  return app;
}
