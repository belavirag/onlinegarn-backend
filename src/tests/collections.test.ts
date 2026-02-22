import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';

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

import collectionsRoutes from '../routes/collections';

describe('Collections Routes', () => {
  let app: Application;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    app = express();
    app.use('/', collectionsRoutes);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  describe('GET /collections', () => {
    it('should return collections list', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collections: {
            pageInfo: {
              hasNextPage: false,
              endCursor: null,
            },
            edges: [
              {
                node: {
                  id: 'gid://shopify/Collection/123',
                  title: 'Summer Collection',
                  handle: 'summer-collection',
                  description: 'Best summer items',
                  descriptionHtml: '<p>Best summer items</p>',
                  image: {
                    url: 'https://example.com/collection.jpg',
                    altText: 'Summer collection image',
                  },
                },
              },
            ],
          },
        },
      });

      const response = await request(app).get('/collections').expect(200);

      expect(response.body.collections).toHaveLength(1);
      expect(response.body.collections[0].id).toBe('gid://shopify/Collection/123');
      expect(response.body.collections[0].title).toBe('Summer Collection');
      expect(response.body.collections[0].handle).toBe('summer-collection');
      expect(response.body.collections[0].image).toEqual({
        url: 'https://example.com/collection.jpg',
        altText: 'Summer collection image',
      });
      expect(response.body.pageInfo.hasNextPage).toBe(false);
    });

    it('should handle collections without images', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collections: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [
              {
                node: {
                  id: 'gid://shopify/Collection/123',
                  title: 'No Image Collection',
                  handle: 'no-image',
                  description: 'Collection without image',
                  descriptionHtml: '<p>Collection without image</p>',
                  image: null,
                },
              },
            ],
          },
        },
      });

      const response = await request(app).get('/collections').expect(200);

      expect(response.body.collections[0].image).toBeNull();
    });

    it('should respect the first query parameter', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collections: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [],
          },
        },
      });

      await request(app).get('/collections?first=5').expect(200);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          variables: { first: 5, after: undefined },
        }),
      );
    });

    it('should clamp first to max 50', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collections: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [],
          },
        },
      });

      await request(app).get('/collections?first=100').expect(200);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          variables: { first: 50, after: undefined },
        }),
      );
    });

    it('should pass after cursor for pagination', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collections: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [],
          },
        },
      });

      await request(app).get('/collections?after=somecursor').expect(200);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          variables: { first: 12, after: 'somecursor' },
        }),
      );
    });

    it('should return 500 when Shopify request fails', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Shopify error'));

      const response = await request(app).get('/collections').expect(500);
      expect(response.body.error).toBe('Failed to fetch collections');
    });

    it('should return cached data without calling Shopify', async () => {
      const cachedData = {
        collections: [{ id: 'gid://shopify/Collection/cached', title: 'Cached Collection' }],
        pageInfo: { hasNextPage: false, endCursor: null },
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

      const response = await request(app).get('/collections').expect(200);

      expect(response.body).toEqual(cachedData);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('should cache the response after a fresh fetch', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collections: {
            pageInfo: { hasNextPage: false, endCursor: null },
            edges: [],
          },
        },
      });

      await request(app).get('/collections').expect(200);

      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringContaining('cache:collections'),
        expect.any(String),
        'EX',
        600,
      );
    });
  });

  describe('GET /collections/:handle/products', () => {
    it('should return collection with products', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collectionByHandle: {
            id: 'gid://shopify/Collection/123',
            title: 'Summer Collection',
            handle: 'summer-collection',
            description: 'Best summer items',
            descriptionHtml: '<p>Best summer items</p>',
            image: {
              url: 'https://example.com/collection.jpg',
              altText: 'Summer collection image',
            },
            products: {
              pageInfo: {
                hasNextPage: false,
                endCursor: null,
              },
              edges: [
                {
                  node: {
                    id: 'gid://shopify/Product/456',
                    title: 'Summer T-Shirt',
                    description: 'A cool summer t-shirt',
                    descriptionHtml: '<p>A cool summer t-shirt</p>',
                    handle: 'summer-t-shirt',
                    priceRangeV2: {
                      minVariantPrice: {
                        amount: '29.99',
                        currencyCode: 'USD',
                      },
                    },
                    featuredImage: {
                      url: 'https://example.com/product.jpg',
                      altText: 'Summer t-shirt image',
                    },
                  },
                },
              ],
            },
          },
        },
      });

      const response = await request(app).get('/collections/summer-collection/products').expect(200);

      expect(response.body.collection.id).toBe('gid://shopify/Collection/123');
      expect(response.body.collection.title).toBe('Summer Collection');
      expect(response.body.products).toHaveLength(1);
      expect(response.body.products[0].id).toBe('gid://shopify/Product/456');
      expect(response.body.products[0].title).toBe('Summer T-Shirt');
      expect(response.body.products[0].minPrice.amount).toBe('29.99');
      expect(response.body.products[0].featuredImage).toEqual({
        url: 'https://example.com/product.jpg',
        altText: 'Summer t-shirt image',
      });
      expect(response.body.pageInfo.hasNextPage).toBe(false);
    });

    it('should handle collections without images', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collectionByHandle: {
            id: 'gid://shopify/Collection/123',
            title: 'No Image Collection',
            handle: 'no-image',
            description: 'Collection without image',
            descriptionHtml: '<p>Collection without image</p>',
            image: null,
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [],
            },
          },
        },
      });

      const response = await request(app).get('/collections/no-image/products').expect(200);

      expect(response.body.collection.image).toBeNull();
    });

    it('should handle products without featured images', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collectionByHandle: {
            id: 'gid://shopify/Collection/123',
            title: 'Collection',
            handle: 'collection',
            description: 'A collection',
            descriptionHtml: '<p>A collection</p>',
            image: null,
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: 'gid://shopify/Product/456',
                    title: 'Product Without Image',
                    description: 'No image product',
                    descriptionHtml: '<p>No image product</p>',
                    handle: 'no-image-product',
                    priceRangeV2: {
                      minVariantPrice: {
                        amount: '19.99',
                        currencyCode: 'USD',
                      },
                    },
                    featuredImage: null,
                  },
                },
              ],
            },
          },
        },
      });

      const response = await request(app).get('/collections/collection/products').expect(200);

      expect(response.body.products[0].featuredImage).toBeNull();
    });

    it('should return 404 when collection is not found', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collectionByHandle: null,
        },
      });

      const response = await request(app).get('/collections/non-existent/products').expect(404);
      expect(response.body.error).toBe('Collection not found');
    });

    it('should respect the first query parameter', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collectionByHandle: {
            id: 'gid://shopify/Collection/123',
            title: 'Collection',
            handle: 'collection',
            description: '',
            descriptionHtml: '',
            image: null,
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [],
            },
          },
        },
      });

      await request(app).get('/collections/collection/products?first=5').expect(200);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          variables: { handle: 'collection', first: 5, after: undefined },
        }),
      );
    });

    it('should clamp first to max 50', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collectionByHandle: {
            id: 'gid://shopify/Collection/123',
            title: 'Collection',
            handle: 'collection',
            description: '',
            descriptionHtml: '',
            image: null,
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [],
            },
          },
        },
      });

      await request(app).get('/collections/collection/products?first=100').expect(200);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          variables: { handle: 'collection', first: 50, after: undefined },
        }),
      );
    });

    it('should pass after cursor for pagination', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collectionByHandle: {
            id: 'gid://shopify/Collection/123',
            title: 'Collection',
            handle: 'collection',
            description: '',
            descriptionHtml: '',
            image: null,
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [],
            },
          },
        },
      });

      await request(app).get('/collections/collection/products?after=somecursor').expect(200);

      expect(mockRequest).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          variables: { handle: 'collection', first: 12, after: 'somecursor' },
        }),
      );
    });

    it('should return 500 when Shopify request fails', async () => {
      mockRequest.mockRejectedValueOnce(new Error('Shopify error'));

      const response = await request(app).get('/collections/collection/products').expect(500);
      expect(response.body.error).toBe('Failed to fetch collection products');
    });

    it('should return cached data without calling Shopify', async () => {
      const cachedData = {
        collection: { id: 'gid://shopify/Collection/cached', title: 'Cached Collection' },
        products: [{ id: 'gid://shopify/Product/cached', title: 'Cached Product' }],
        pageInfo: { hasNextPage: false, endCursor: null },
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

      const response = await request(app).get('/collections/cached-collection/products').expect(200);

      expect(response.body).toEqual(cachedData);
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('should cache the response after a fresh fetch', async () => {
      mockRequest.mockResolvedValueOnce({
        data: {
          collectionByHandle: {
            id: 'gid://shopify/Collection/123',
            title: 'Collection',
            handle: 'collection',
            description: '',
            descriptionHtml: '',
            image: null,
            products: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [],
            },
          },
        },
      });

      await request(app).get('/collections/collection/products').expect(200);

      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringContaining('cache:collection-products'),
        expect.any(String),
        'EX',
        600,
      );
    });
  });
});
