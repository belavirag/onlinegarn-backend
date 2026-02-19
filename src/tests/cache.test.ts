import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockGet, mockSet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock('../services/redis', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    get: mockGet,
    set: mockSet,
  },
}));

import { buildCacheKey, getCached } from '../services/cache';

describe('Cache Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildCacheKey', () => {
    it('should build a key with prefix only when no params', () => {
      const key = buildCacheKey('products', {});
      expect(key).toBe('cache:products');
    });

    it('should build a key with sorted params', () => {
      const key = buildCacheKey('products', { first: 12, after: 'cursor123' });
      expect(key).toBe('cache:products:after=cursor123&first=12');
    });

    it('should omit undefined values', () => {
      const key = buildCacheKey('products', { first: 12, after: undefined });
      expect(key).toBe('cache:products:first=12');
    });

    it('should produce consistent keys regardless of param order', () => {
      const key1 = buildCacheKey('test', { b: '2', a: '1' });
      const key2 = buildCacheKey('test', { a: '1', b: '2' });
      expect(key1).toBe(key2);
    });

    it('should include string params in the key', () => {
      const key = buildCacheKey('product-inventory', { productId: 'gid://shopify/Product/123' });
      expect(key).toBe('cache:product-inventory:productId=gid://shopify/Product/123');
    });
  });

  describe('getCached', () => {
    it('should return cached data on cache hit', async () => {
      const cachedData = { products: [{ id: '1' }] };
      mockGet.mockResolvedValueOnce(JSON.stringify(cachedData));

      const fetcher = vi.fn();
      const result = await getCached('cache:products', fetcher);

      expect(result).toEqual(cachedData);
      expect(fetcher).not.toHaveBeenCalled();
      expect(mockGet).toHaveBeenCalledWith('cache:products');
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should call fetcher and cache result on cache miss', async () => {
      mockGet.mockResolvedValueOnce(null);
      mockSet.mockResolvedValueOnce('OK');

      const fetchedData = { products: [{ id: '2' }] };
      const fetcher = vi.fn().mockResolvedValueOnce(fetchedData);

      const result = await getCached('cache:products', fetcher);

      expect(result).toEqual(fetchedData);
      expect(fetcher).toHaveBeenCalledOnce();
      expect(mockGet).toHaveBeenCalledWith('cache:products');
      expect(mockSet).toHaveBeenCalledWith(
        'cache:products',
        JSON.stringify(fetchedData),
        'EX',
        600,
      );
    });

    it('should propagate errors from the fetcher', async () => {
      mockGet.mockResolvedValueOnce(null);

      const fetcher = vi.fn().mockRejectedValueOnce(new Error('Shopify error'));

      await expect(getCached('cache:test', fetcher)).rejects.toThrow('Shopify error');
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('should propagate errors from redis.get', async () => {
      mockGet.mockRejectedValueOnce(new Error('Redis connection error'));

      const fetcher = vi.fn();

      await expect(getCached('cache:test', fetcher)).rejects.toThrow('Redis connection error');
      expect(fetcher).not.toHaveBeenCalled();
    });
  });
});
