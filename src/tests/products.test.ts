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

import productsRoutes from '../routes/products';

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

});

describe('Product By Handle Route', () => {
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

  const mockProductNode = {
    id: 'gid://shopify/Product/123',
    title: 'Test Product',
    description: 'A test product',
    descriptionHtml: '<p>A test product</p>',
    handle: 'test-product',
    priceRangeV2: {
      minVariantPrice: { amount: '10.0', currencyCode: 'SEK' },
    },
    media: {
      edges: [
        {
          node: {
            __typename: 'MediaImage',
            image: { url: 'https://example.com/image.jpg', altText: 'Test image' },
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
            media: { edges: [] },
            inventoryQuantity: 5,
            selectedOptions: [{ name: 'Title', value: 'Default' }],
          },
        },
      ],
    },
    options: [{ name: 'Title', values: ['Default'] }],
  };

  it('should return a product by handle', async () => {
    mockRequest.mockResolvedValueOnce({
      data: { productByHandle: mockProductNode },
    });

    const response = await request(app).get('/products/test-product').expect(200);

    expect(response.body.id).toBe('gid://shopify/Product/123');
    expect(response.body.title).toBe('Test Product');
    expect(response.body.handle).toBe('test-product');
    expect(response.body.minPrice.amount).toBe('10.0');
    expect(response.body.images).toHaveLength(1);
    expect(response.body.images[0].url).toBe('https://example.com/image.jpg');
    expect(response.body.variants).toHaveLength(1);
    expect(response.body.variants[0].image).toBeNull();
    expect(response.body.options).toEqual([{ name: 'Title', values: ['Default'] }]);
  });

  it('should pass the handle to the Shopify query', async () => {
    mockRequest.mockResolvedValueOnce({
      data: { productByHandle: mockProductNode },
    });

    await request(app).get('/products/my-handle').expect(200);

    expect(mockRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ variables: { handle: 'my-handle' } }),
    );
  });

  it('should return 404 when product handle does not exist', async () => {
    mockRequest.mockResolvedValueOnce({ data: { productByHandle: null } });

    const response = await request(app).get('/products/nonexistent').expect(404);
    expect(response.body.error).toContain('nonexistent');
  });

  it('should return 500 when Shopify request fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Shopify error'));

    const response = await request(app).get('/products/test-product').expect(500);
    expect(response.body.error).toBe('Failed to fetch product');
  });

  it('should return cached data without calling Shopify', async () => {
    const cachedProduct = { id: 'gid://shopify/Product/cached', title: 'Cached Product' };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedProduct));

    const response = await request(app).get('/products/cached-handle').expect(200);

    expect(response.body).toEqual(cachedProduct);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('should cache the response after a fresh fetch', async () => {
    mockRequest.mockResolvedValueOnce({
      data: { productByHandle: mockProductNode },
    });

    await request(app).get('/products/test-product').expect(200);

    expect(mockRedisSet).toHaveBeenCalledWith(
      expect.stringContaining('cache:product-by-handle'),
      expect.any(String),
      'EX',
      600,
    );
  });
});
