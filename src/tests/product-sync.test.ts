import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';

// Mock node-cron before anything else
const { mockSchedule, mockStop } = vi.hoisted(() => ({
  mockSchedule: vi.fn().mockReturnValue({ stop: vi.fn() }),
  mockStop: vi.fn(),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: mockSchedule,
  },
}));

// Mock Redis
const { mockRedisGet, mockRedisSet } = vi.hoisted(() => ({
  mockRedisGet: vi.fn().mockResolvedValue(null),
  mockRedisSet: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('../services/redis', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    get: mockRedisGet,
    set: mockRedisSet,
  },
}));

// Mock Shopify
const { mockRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
}));

vi.mock('../services/shopify', () => {
  class MockGraphqlClient {
    request = mockRequest;
  }

  return {
    createGraphqlClient: vi.fn(async () => new MockGraphqlClient()),
    getShopify: vi.fn(),
    getAdminAccessToken: vi.fn(async () => 'test_token'),
  };
});

vi.mock('@shopify/shopify-api/adapters/node', () => ({}));

// Mock Meilisearch
const { mockAddDocuments, mockIndex } = vi.hoisted(() => {
  const mockAddDocuments = vi.fn().mockResolvedValue({ taskUid: 42 });
  const mockIndex = vi.fn().mockReturnValue({
    addDocuments: mockAddDocuments,
  });
  return { mockAddDocuments, mockIndex };
});

vi.mock('../services/meilisearch', () => ({
  getMeilisearch: vi.fn(() => ({
    index: mockIndex,
  })),
  PRODUCTS_INDEX: 'products',
}));

import {
  fetchAllProducts,
  syncProductsToMeilisearch,
  startProductSyncCron,
  stopProductSyncCron,
  MeiliProductDocument,
} from '../services/product-sync';

function createMockShopifyProduct(overrides: {
  id?: string;
  title?: string;
  collections?: { title: string; handle: string }[];
} = {}) {
  const id = overrides.id || 'gid://shopify/Product/123';
  const title = overrides.title || 'Test Product';
  const collections = overrides.collections || [
    { title: 'Summer Collection', handle: 'summer' },
  ];

  return {
    id,
    title,
    description: 'A test product',
    handle: 'test-product',
    priceRangeV2: {
      minVariantPrice: {
        amount: '10.0',
        currencyCode: 'SEK',
      },
    },
    media: {
      edges: [
        {
          node: {
            __typename: 'MediaImage',
            image: {
              url: 'https://example.com/image.jpg',
              altText: 'Test image',
            },
          },
        },
      ],
    },
    variants: {
      edges: [
        {
          node: {
            id: 'gid://shopify/ProductVariant/456',
            title: 'Default',
            price: '10.0',
            inventoryQuantity: 5,
            selectedOptions: [{ name: 'Title', value: 'Default' }],
          },
        },
      ],
    },
    options: [{ name: 'Title', values: ['Default'] }],
    collections: {
      edges: collections.map((c: { title: string; handle: string }) => ({
        node: c,
      })),
    },
  };
}

describe('Product Sync Service', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('fetchAllProducts', () => {
    it('should fetch all products with collection info', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [
              { node: createMockShopifyProduct() },
            ],
          },
        },
      });

      const products = await fetchAllProducts();

      expect(products).toHaveLength(1);
      expect(products[0].id).toBe('shopify-Product-123');
      expect(products[0].title).toBe('Test Product');
      expect(products[0].collections).toEqual(['Summer Collection']);
      expect(products[0].collectionHandles).toEqual(['summer']);
      expect(products[0].minPriceAmount).toBe(10.0);
      expect(products[0].images).toHaveLength(1);
      expect(products[0].variants).toHaveLength(1);
      expect(products[0].variantTitles).toEqual(['Default']);
    });

    it('should handle pagination across multiple pages', async () => {
      mockRequest
        .mockResolvedValueOnce({
          data: {
            products: {
              pageInfo: { hasNextPage: true, endCursor: 'cursor1' },
              edges: [
                { node: createMockShopifyProduct({ id: 'gid://shopify/Product/1', title: 'Product 1' }) },
              ],
            },
          },
        })
        .mockResolvedValueOnce({
          data: {
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                { node: createMockShopifyProduct({ id: 'gid://shopify/Product/2', title: 'Product 2' }) },
              ],
            },
          },
        });

      const products = await fetchAllProducts();

      expect(products).toHaveLength(2);
      expect(products[0].title).toBe('Product 1');
      expect(products[1].title).toBe('Product 2');
      expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('should include multiple collections per product', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [
              {
                node: createMockShopifyProduct({
                  collections: [
                    { title: 'Summer', handle: 'summer' },
                    { title: 'Sale', handle: 'sale' },
                    { title: 'New Arrivals', handle: 'new-arrivals' },
                  ],
                }),
              },
            ],
          },
        },
      });

      const products = await fetchAllProducts();

      expect(products[0].collections).toEqual(['Summer', 'Sale', 'New Arrivals']);
      expect(products[0].collectionHandles).toEqual(['summer', 'sale', 'new-arrivals']);
    });

    it('should handle products with no collections', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [
              {
                node: createMockShopifyProduct({ collections: [] }),
              },
            ],
          },
        },
      });

      const products = await fetchAllProducts();

      expect(products[0].collections).toEqual([]);
      expect(products[0].collectionHandles).toEqual([]);
    });

    it('should throw when Shopify returns no data', async () => {
      mockRequest.mockResolvedValueOnce({ data: {} });

      await expect(fetchAllProducts()).rejects.toThrow(
        'Failed to fetch products for Meilisearch sync'
      );
    });

    it('should sanitize Shopify GIDs to Meilisearch-safe IDs', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [
              { node: createMockShopifyProduct({ id: 'gid://shopify/Product/789' }) },
            ],
          },
        },
      });

      const products = await fetchAllProducts();

      // "gid://shopify/Product/789" -> "shopify-Product-789"
      expect(products[0].id).toBe('shopify-Product-789');
    });
  });

  describe('syncProductsToMeilisearch', () => {
    it('should fetch all products and add them to Meilisearch', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [
              { node: createMockShopifyProduct() },
            ],
          },
        },
      });

      await syncProductsToMeilisearch();

      expect(mockIndex).toHaveBeenCalledWith('products');
      expect(mockAddDocuments).toHaveBeenCalledTimes(1);

      const addedProducts = mockAddDocuments.mock.calls[0][0] as MeiliProductDocument[];
      expect(addedProducts).toHaveLength(1);
      expect(addedProducts[0].id).toBe('shopify-Product-123');
      expect(addedProducts[0].collections).toEqual(['Summer Collection']);
    });

    it('should propagate errors from Shopify', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Shopify API error'));

      await expect(syncProductsToMeilisearch()).rejects.toThrow('Shopify API error');
    });

    it('should propagate errors from Meilisearch', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [{ node: createMockShopifyProduct() }],
          },
        },
      });

      mockAddDocuments.mockRejectedValueOnce(new Error('Meilisearch error'));

      await expect(syncProductsToMeilisearch()).rejects.toThrow('Meilisearch error');
    });
  });

  describe('startProductSyncCron', () => {
    it('should schedule a cron job that runs every hour', () => {
      // syncProductsToMeilisearch will be called immediately but we need mock data
      mockRequest.mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [],
          },
        },
      });

      startProductSyncCron();

      expect(mockSchedule).toHaveBeenCalledWith('0 * * * *', expect.any(Function));
    });

    it('should run an initial sync immediately on start', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [],
          },
        },
      });

      startProductSyncCron();

      // Wait for the fire-and-forget initial sync promise to settle
      await vi.waitFor(() => {
        expect(mockRequest).toHaveBeenCalled();
      });
    });
  });

  describe('stopProductSyncCron', () => {
    it('should stop the cron job', () => {
      const mockStopFn = vi.fn();
      mockSchedule.mockReturnValueOnce({ stop: mockStopFn });

      mockRequest.mockResolvedValueOnce({
        data: {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [],
          },
        },
      });

      startProductSyncCron();
      stopProductSyncCron();

      expect(mockStopFn).toHaveBeenCalled();
    });

    it('should be safe to call when no cron job is running', () => {
      // Should not throw
      expect(() => stopProductSyncCron()).not.toThrow();
    });
  });
});
