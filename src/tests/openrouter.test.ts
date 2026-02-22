import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockOpenRouterConstructor, mockOpenRouterInstance } = vi.hoisted(() => {
  const mockInstance = { chat: { send: vi.fn() } };
  // Must use a real class (not an arrow fn) so `new OpenRouter()` works
  class MockOpenRouter {
    chat = mockInstance.chat;
  }
  return {
    mockOpenRouterConstructor: MockOpenRouter,
    mockOpenRouterInstance: mockInstance,
  };
});

vi.mock('@openrouter/sdk', () => ({
  OpenRouter: mockOpenRouterConstructor,
}));

import { getOpenRouterClient } from '../services/openrouter';

describe('OpenRouter service', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it('should throw if OPENROUTER_API_KEY is missing', async () => {
    delete process.env.OPENROUTER_API_KEY;

    vi.resetModules();
    const { getOpenRouterClient: freshGetClient } = await import('../services/openrouter');

    await expect(freshGetClient()).rejects.toThrow(
      'Missing required environment variable: OPENROUTER_API_KEY',
    );
  });

  it('should create a client with the API key from env', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-123';

    vi.resetModules();
    const { getOpenRouterClient: freshGetClient } = await import('../services/openrouter');
    const client = await freshGetClient();

    expect(client).toBeInstanceOf(mockOpenRouterConstructor);
    expect(client.chat).toBe(mockOpenRouterInstance.chat);
  });

  it('should return the same instance on repeated calls (singleton)', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key-456';

    vi.resetModules();
    const { getOpenRouterClient: freshGetClient } = await import('../services/openrouter');

    const first = await freshGetClient();
    const second = await freshGetClient();

    expect(first).toBe(second);
  });
});
