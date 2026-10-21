import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Port of the Python /metrics operations endpoint to Node.js.
 * Isolated registry for each application instance; never label by raw URL,
 * workspace, tenant, user, API key or any other high-cardinality/private value.
 */
export function createMetrics() {
  const registry = new Registry();
  registry.setDefaultLabels({ service: 'chat_node' });
  collectDefaultMetrics({ register: registry, prefix: 'northstar_node_' });
  const requests = new Counter({
    name: 'northstar_node_http_requests_total',
    help: 'Total HTTP requests, grouped by method and status code',
    labelNames: ['method', 'status_code'] as const,
    registers: [registry],
  });
  const duration = new Histogram({
    name: 'northstar_node_http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });
  return {
    contentType: registry.contentType,
    record(method: string, statusCode: number, seconds: number) {
      const labels = { method: method.toUpperCase(), status_code: String(statusCode) };
      requests.inc(labels);
      duration.observe(labels, seconds);
    },
    async snapshot(): Promise<string> { return registry.metrics(); },
    async close(): Promise<void> { registry.clear(); },
  };
}
