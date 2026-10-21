import { Pool } from 'pg';
import Redis from 'ioredis';
import type { ReadinessDependencies } from './readiness.js';

/** Network probes only. No schema mutation or implicit reconnect loop. */
export function createProbes(env: NodeJS.ProcessEnv = process.env): ReadinessDependencies {
  return {
    database: async () => {
      if (!env.DATABASE_URL) return false;
      const pool = new Pool({
        connectionString: env.DATABASE_URL,
        connectionTimeoutMillis: 1000,
        max: 1,
      });
      try {
        const result = await pool.query('SELECT 1 AS healthy');
        return result.rows[0]?.healthy === 1;
      } finally {
        await pool.end();
      }
    },
    redis: async () => {
      if (!env.REDIS_URL) return false;
      const client = new Redis(env.REDIS_URL, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 0,
        connectTimeout: 1000,
        retryStrategy: () => null,
      });
      try {
        await client.connect();
        return (await client.ping()) === 'PONG';
      } finally {
        client.disconnect();
      }
    },
    nvidiaConfigured: () => Boolean(env.NVIDIA_API_KEY?.trim()),
  };
}
