import Fastify from 'fastify';
import { evaluateReadiness, type ReadinessDependencies } from './readiness.js';
import { createProbes } from './probes.js';
import { createMetrics } from './metrics.js';

export interface AppOptions {
  probes?: ReadinessDependencies;
  env?: NodeJS.ProcessEnv;
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
