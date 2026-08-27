import { env } from "~/env";

/**
 * A counting semaphore for limiting concurrent operations.
 * Used to prevent overwhelming database connections during bulk operations.
 */
export class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.permits++;
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

/**
 * Check if the database URL points to Turso's hosted service.
 * Turso hosted URLs contain ".turso.io"
 */
export function getDatabaseConcurrencyLimit(databaseUrl: string): number {
  return databaseUrl.includes(".turso.io") ? Number.POSITIVE_INFINITY : 5;
}

/**
 * Global semaphore for database operations.
 *
 * - Local libsql-server: Limited to 5 concurrent connections to prevent
 *   "DbCreateTimeout" errors (the server has a small internal connection pool)
 * - Turso hosted: Unlimited. Hosted Turso enforces no server-side concurrency
 *   limit (probed at 200 concurrent requests and 200 simultaneous connections
 *   without rejection); latency degrades smoothly instead of erroring.
 */
export const dbSemaphore = new Semaphore(
  getDatabaseConcurrencyLimit(env.DATABASE_URL ?? ""),
);
