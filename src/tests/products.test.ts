import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';

vi.mock('../services/redis', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    get: vi.fn(),
  },
}));

const mockRequest = vi.fn();

vi.mock('../services/shopify', () => {
  class MockGraphqlClient {
    request = mockRequest;
  }

  return {
    getShopify: vi.fn(() => ({
      session: {
        customAppSession: vi.fn(() => ({
          accessToken: null,
        })),
      },
      clients: {
        Graphql: MockGraphqlClient,
      },
    })),
    getAdminAccessToken: vi.fn(() => 'test_token'),
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
                images: {
                  edges: [
                    {
                      node: {
                        url: 'https://example.com/image.jpg',
                        altText: 'Test image',
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
                        image: null,
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
    expect(response.body.products[0].variants).toHaveLength(1);
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
});
