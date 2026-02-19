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
    getShopify: vi.fn(),
    getAdminAccessToken: vi.fn(() => 'test_token'),
  };
});

// Mock the node adapter import
vi.mock('@shopify/shopify-api/adapters/node', () => ({}));

import productInventoryRoutes from '../routes/product-inventory';

describe('Product Inventory Routes', () => {
  let app: Application;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = express();
    app.use('/', productInventoryRoutes);
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

  it('should return product inventory data', async () => {
    mockRequest.mockResolvedValueOnce({
      data: {
        product: {
          id: 'gid://shopify/Product/123',
          title: 'Test Product',
          variants: {
            edges: [
              {
                node: {
                  id: 'gid://shopify/ProductVariant/456',
                  title: 'Default',
                  inventoryItem: {
                    id: 'gid://shopify/InventoryItem/789',
                    inventoryLevels: {
                      edges: [
                        {
                          node: {
                            id: 'gid://shopify/InventoryLevel/101',
                            location: {
                              id: 'gid://shopify/Location/1',
                              name: 'Warehouse',
                            },
                            quantities: [
                              { name: 'available', quantity: 10 },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    });

    const response = await request(app)
      .get('/products/123/inventory')
      .expect(200);

    expect(response.body.id).toBe('gid://shopify/Product/123');
    expect(response.body.title).toBe('Test Product');
    expect(response.body.variants).toHaveLength(1);
    expect(response.body.variants[0].id).toBe('gid://shopify/ProductVariant/456');
    expect(response.body.variants[0].inventoryLevels).toHaveLength(1);
    expect(response.body.variants[0].inventoryLevels[0].locationName).toBe('Warehouse');
    expect(response.body.variants[0].inventoryLevels[0].available).toBe(10);
  });

  it('should return 404 when product is not found', async () => {
    mockRequest.mockResolvedValueOnce({
      data: { product: null },
    });

    const response = await request(app)
      .get('/products/nonexistent/inventory')
      .expect(404);

    expect(response.body.error).toBe('Product not found');
  });

  it('should return 500 when Shopify request fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Shopify API error'));

    const response = await request(app)
      .get('/products/123/inventory')
      .expect(500);

    expect(response.body.error).toBe('Failed to fetch product inventory');
  });

  it('should return 404 when productId is empty (Express 5 behavior)', async () => {
    await request(app).get('/products//inventory').expect(404);
  });

  it('should return cached data without calling Shopify', async () => {
    const cachedData = {
      id: 'gid://shopify/Product/123',
      title: 'Cached Product',
      variants: [],
    };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedData));

    const response = await request(app)
      .get('/products/123/inventory')
      .expect(200);

    expect(response.body).toEqual(cachedData);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('should cache the response after a fresh fetch', async () => {
    mockRequest.mockResolvedValueOnce({
      data: {
        product: {
          id: 'gid://shopify/Product/123',
          title: 'Test Product',
          variants: { edges: [] },
        },
      },
    });

    await request(app).get('/products/123/inventory').expect(200);

    expect(mockRedisSet).toHaveBeenCalledWith(
      expect.stringContaining('cache:product-inventory'),
      expect.any(String),
      'EX',
      600,
    );
  });
});
