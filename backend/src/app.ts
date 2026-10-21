import Fastify from 'fastify';

/** Initial Node.js contract scaffold. Domain APIs are not migrated yet. */
export function buildApp() {
  const app = Fastify({ logger: true });

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), geolocation=(), payment=()');
    return payload;
  });

  app.get('/health/live', async () => ({ status: 'ok' }));
  // Fail closed: readiness must not report success until PostgreSQL,
  // Redis, queue consumers and required integration checks are implemented.
  app.get('/health/ready', async (_request, reply) => {
    return reply.code(503).send({ status: 'not_ready', reason: 'migration_incomplete' });
  });

  app.setNotFoundHandler(async (request, reply) => {
    return reply.code(404).send({
      error: { code: 'http_404', message: 'Route not implemented', requestId: request.id },
    });
  });

  return app;
}
