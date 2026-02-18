import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import productInventoryRoutes from '../routes/product-inventory';

vi.mock('../services/redis', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('../services/shopify', () => {
  const mockQuery = vi.fn();
  
  class MockGraphqlClient {
    query = mockQuery;
  }
  
  return {
    getShopify: vi.fn(() => ({
      config: {
        adminApiAccessToken: 'test_token',
      },
      clients: {
        Graphql: MockGraphqlClient,
      },
    })),
    __mockQuery: mockQuery,
  };
});

describe('Product Inventory Routes', () => {
  let app: Application;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    app = express();
    app.use('/', productInventoryRoutes);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should return 500 when Shopify is not initialized', async () => {
    const response = await request(app).get('/products/123/inventory').expect(500);
    expect(response.body.error).toBe('Failed to fetch product inventory');
  });

  it('should return 400 when productId is empty', async () => {
    const response = await request(app).get('/products//inventory').expect(404);
  });
});
