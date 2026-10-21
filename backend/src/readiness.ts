export type ProbeStatus = 'ok' | 'unavailable';
export interface ReadinessDependencies {
  database: () => Promise<boolean>;
  redis: () => Promise<boolean>;
  nvidiaConfigured: () => boolean;
}
export interface ReadinessResult {
  status: 'ready' | 'not-ready';
  checks: { database: ProbeStatus; redis: ProbeStatus; nvidia: 'configured' | 'not-configured' };
}
async function probe(check: () => Promise<boolean>): Promise<ProbeStatus> {
  try { return (await check()) ? 'ok' : 'unavailable'; }
  catch { return 'unavailable'; }
}
/** Port of northstar_api/health.py readiness semantics.
 * This is a pure policy function; it must be supplied with real connectivity probes.
 */
export async function evaluateReadiness(
  dependencies: ReadinessDependencies,
  options: { production: boolean; requireNvidia: boolean },
): Promise<ReadinessResult> {
  const [database, redis] = await Promise.all([
    probe(dependencies.database),
    probe(dependencies.redis),
  ]);
  const nvidia = dependencies.nvidiaConfigured() ? 'configured' : 'not-configured';
  const requiredOk = database === 'ok' &&
    (!options.production || (
      redis === 'ok' && (nvidia === 'configured' || !options.requireNvidia)
    ));
  return { status: requiredOk ? 'ready' : 'not-ready', checks: { database, redis, nvidia } };
}
