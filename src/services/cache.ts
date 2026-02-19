import redis from './redis';

const CACHE_TTL_SECONDS = 600; // 10 minutes

/**
 * Builds a deterministic cache key from a prefix and a params object.
 * Keys are sorted alphabetically so the same params always produce the same key.
 * Undefined/null values are omitted.
 */
export function buildCacheKey(prefix: string, params: Record<string, string | number | undefined>): string {
  const filtered = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b));

  if (filtered.length === 0) {
    return `cache:${prefix}`;
  }

  const paramString = filtered.map(([k, v]) => `${k}=${v}`).join('&');
  return `cache:${prefix}:${paramString}`;
}

/**
 * Attempts to read a cached response from Redis. On cache miss, calls the
 * fetcher function, stores the result in Redis with a 10-minute TTL, and
 * returns it.
 */
export async function getCached<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
): Promise<T> {
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached) as T;
  }

  const result = await fetcher();
  await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
  return result;
}
