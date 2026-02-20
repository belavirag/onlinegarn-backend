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
    createGraphqlClient: vi.fn(() => new MockGraphqlClient()),
    refreshAccessToken: vi.fn().mockResolvedValue(undefined),
    getShopify: vi.fn(),
    getAdminAccessToken: vi.fn(() => 'test_token'),
  };
});

vi.mock('@shopify/shopify-api/adapters/node', () => ({}));

import productsRoutes from '../routes/products';
import { refreshAccessToken } from '../services/shopify';

describe('Products Routes', () => {
  let app: Application;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    app = express();
    app.use('/', productsRoutes);
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

  it('should return products list', async () => {
    mockRequest.mockResolvedValueOnce({
      data: {
        products: {
          pageInfo: {
            hasNextPage: false,
            endCursor: null,
          },
          edges: [
            {
              node: {
                id: 'gid://shopify/Product/123',
                title: 'Test Product',
                description: 'A test product',
                descriptionHtml: '<p>A test product</p>',
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
                        media: {
                          edges: [],
                        },
                        inventoryQuantity: 5,
                        selectedOptions: [
                          { name: 'Title', value: 'Default' },
                        ],
                      },
                    },
                  ],
                },
                options: [{ name: 'Title', values: ['Default'] }],
              },
            },
          ],
        },
      },
    });

    const response = await request(app).get('/products').expect(200);

    expect(response.body.products).toHaveLength(1);
    expect(response.body.products[0].id).toBe('gid://shopify/Product/123');
    expect(response.body.products[0].title).toBe('Test Product');
    expect(response.body.products[0].minPrice.amount).toBe('10.0');
    expect(response.body.products[0].images).toHaveLength(1);
    expect(response.body.products[0].images[0].url).toBe('https://example.com/image.jpg');
    expect(response.body.products[0].variants).toHaveLength(1);
    expect(response.body.products[0].variants[0].image).toBeNull();
    expect(response.body.pageInfo.hasNextPage).toBe(false);
  });

  it('should respect the first query parameter', async () => {
    mockRequest.mockResolvedValueOnce({
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [],
        },
      },
    });

    await request(app).get('/products?first=5').expect(200);

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
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [],
        },
      },
    });

    await request(app).get('/products?first=100').expect(200);

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
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [],
        },
      },
    });

    await request(app).get('/products?after=somecursor').expect(200);

    expect(mockRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        variables: { first: 12, after: 'somecursor' },
      }),
    );
  });

  it('should return 500 when Shopify request fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Shopify error'));

    const response = await request(app).get('/products').expect(500);
    expect(response.body.error).toBe('Failed to fetch products');
  });

  it('should return cached data without calling Shopify', async () => {
    const cachedData = {
      products: [{ id: 'gid://shopify/Product/cached', title: 'Cached Product' }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const response = await request(app).get('/products').expect(200);

    expect(response.body).toEqual(cachedData);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('should cache the response after a fresh fetch', async () => {
    mockRequest.mockResolvedValueOnce({
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [],
        },
      },
    });

    await request(app).get('/products').expect(200);

    expect(mockRedisSet).toHaveBeenCalledWith(
      expect.stringContaining('cache:products'),
      expect.any(String),
      'EX',
      600,
    );
  });

  it('should refresh access token on cache miss', async () => {
    mockRequest.mockResolvedValueOnce({
      data: {
        products: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [],
        },
      },
    });

    await request(app).get('/products').expect(200);

    expect(refreshAccessToken).toHaveBeenCalledOnce();
  });

  it('should not refresh access token on cache hit', async () => {
    const cachedData = {
      products: [{ id: 'gid://shopify/Product/cached', title: 'Cached' }],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    await request(app).get('/products').expect(200);

    expect(refreshAccessToken).not.toHaveBeenCalled();
  });
});
