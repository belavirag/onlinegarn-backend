import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import healthRoutes from '../routes/health';
import redis from '../services/redis';

vi.mock('../services/redis', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  },
}));

describe('Health Routes', () => {
  let app: Application;

  beforeAll(async () => {
    app = express();
    app.use('/', healthRoutes);
  });

  afterAll(async () => {
    // Cleanup if needed
  });

  it('should return OK status', async () => {
    const response = await request(app).get('/').expect(200);
    expect(response.text).toBe('OK');
  });
});
