import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Meilisearch Service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  describe('initMeilisearch', () => {
    it('should throw if MEILI_ENV is not set', async () => {
      delete process.env.MEILI_ENV;
      delete process.env.MEILI_API_KEY;

      const { initMeilisearch } = await import('../services/meilisearch');

      await expect(initMeilisearch()).rejects.toThrow(
        'Missing required environment variable: MEILI_ENV'
      );
    });

    it('should throw if MEILI_API_KEY is not set', async () => {
      process.env.MEILI_ENV = 'http://localhost:7700';
      delete process.env.MEILI_API_KEY;

      const { initMeilisearch } = await import('../services/meilisearch');

      await expect(initMeilisearch()).rejects.toThrow(
        'Missing required environment variable: MEILI_API_KEY'
      );
    });
  });

  describe('getMeilisearch', () => {
    it('should throw if not initialized', async () => {
      const { getMeilisearch } = await import('../services/meilisearch');

      expect(() => getMeilisearch()).toThrow(
        'Meilisearch not initialized. Call initMeilisearch() first.'
      );
    });
  });
});
