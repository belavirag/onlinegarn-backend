import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import { createServer, Server } from 'http';
import WebSocket from 'ws';

// Hoist mock setup before any vi.mock() calls
const { mockMeiliGetDocuments, mockChatSend } = vi.hoisted(() => ({
  mockMeiliGetDocuments: vi.fn().mockResolvedValue({ results: [] }),
  mockChatSend: vi.fn(),
}));

vi.mock('../services/meilisearch', () => ({
  getMeilisearch: vi.fn(() => ({
    index: vi.fn(() => ({
      getDocuments: mockMeiliGetDocuments,
    })),
  })),
  PRODUCTS_INDEX: 'products',
}));

vi.mock('../services/openrouter', () => ({
  getOpenRouterClient: vi.fn(async () => ({
    chat: { send: mockChatSend },
  })),
}));

import { attachChatWebSocket } from '../services/chat-ws';

// Helper: create an async iterable from an array of chunks (simulates streaming)
function makeStream(chunks: Array<{ choices?: Array<{ delta: { content?: string; reasoning?: string | null; reasoningDetails?: unknown[] } }> }>): AsyncIterable<typeof chunks[number]> {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        async next() {
          if (i < chunks.length) {
            return { value: chunks[i++], done: false };
          }
          return { value: undefined as unknown as typeof chunks[number], done: true };
        },
      };
    },
  };
}

// Helper: connect a WS client and collect all messages until 'done' or 'error'
function collectMessages(ws: WebSocket): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const messages: Array<Record<string, unknown>> = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      messages.push(msg);
      if (msg.type === 'done' || msg.type === 'error') {
        resolve(messages);
      }
    });
    ws.on('error', reject);
    ws.on('close', () => resolve(messages));
  });
}

describe('Chat WebSocket handler', () => {
  let httpServer: Server;
  let port: number;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    httpServer = createServer();
    attachChatWebSocket(httpServer);

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => resolve());
    });

    const addr = httpServer.address();
    port = typeof addr === 'object' && addr !== null ? addr.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockMeiliGetDocuments.mockResolvedValue({ results: [] });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  function connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat`);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
    });
  }

  it('should stream tokens and emit done on a valid message', async () => {
    mockChatSend.mockResolvedValueOnce(
      makeStream([
        { choices: [{ delta: { content: 'Hej' } }] },
        { choices: [{ delta: { content: '!' } }] },
        { choices: [{ delta: {} }] }, // final chunk with no content
      ]),
    );

    const ws = await connect();
    const collecting = collectMessages(ws);

    ws.send(JSON.stringify({ type: 'message', content: 'Vad har ni för garn?' }));

    const messages = await collecting;
    ws.close();

    const tokens = messages.filter((m) => m.type === 'token');
    const done = messages.find((m) => m.type === 'done');

    expect(tokens).toHaveLength(2);
    expect(tokens[0].content).toBe('Hej');
    expect(tokens[1].content).toBe('!');
    expect(done).toBeDefined();
  });

  it('should return an error event on invalid JSON', async () => {
    const ws = await connect();
    const collecting = collectMessages(ws);

    ws.send('not json at all');

    const messages = await collecting;
    ws.close();

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('error');
    expect(messages[0].message).toMatch(/invalid message format/i);
  });

  it('should return an error event on missing content field', async () => {
    const ws = await connect();
    const collecting = collectMessages(ws);

    ws.send(JSON.stringify({ type: 'message', content: '   ' }));

    const messages = await collecting;
    ws.close();

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('error');
  });

  it('should return an error event on wrong message type', async () => {
    const ws = await connect();
    const collecting = collectMessages(ws);

    ws.send(JSON.stringify({ type: 'ping' }));

    const messages = await collecting;
    ws.close();

    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe('error');
  });

  it('should return an error event when OpenRouter throws', async () => {
    mockChatSend.mockRejectedValueOnce(new Error('OpenRouter API down'));

    const ws = await connect();
    const collecting = collectMessages(ws);

    ws.send(JSON.stringify({ type: 'message', content: 'Hjälp mig hitta garn' }));

    const messages = await collecting;
    ws.close();

    const errorEvent = messages.find((m) => m.type === 'error');
    expect(errorEvent).toBeDefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith('OpenRouter chat error:', expect.any(Error));
  });

  it('should include product context in the system message', async () => {
    mockMeiliGetDocuments.mockResolvedValueOnce({
      results: [
        {
          title: 'Merino Ull',
          description: 'Mjukt garn',
          minPriceAmount: 89,
          minPriceCurrency: 'SEK',
          collections: ['Ull'],
          options: [],
          variantTitles: ['Röd', 'Blå'],
          handle: 'merino-ull',
        },
      ],
    });

    mockChatSend.mockResolvedValueOnce(makeStream([]));

    const ws = await connect();
    const collecting = collectMessages(ws);

    ws.send(JSON.stringify({ type: 'message', content: 'Vad har ni?' }));

    await collecting;
    ws.close();

    expect(mockChatSend).toHaveBeenCalled();
    const callArgs = mockChatSend.mock.calls[0][0] as { chatGenerationParams: { messages: Array<{ role: string; content: string }> } };
    const systemMessage = callArgs.chatGenerationParams.messages.find((m) => m.role === 'system');
    expect(systemMessage?.content).toContain('Merino Ull');
  });

  it('should preserve conversation history across multiple messages', async () => {
    mockChatSend
      .mockResolvedValueOnce(makeStream([{ choices: [{ delta: { content: 'Jag kan hjälpa!' } }] }]))
      .mockResolvedValueOnce(makeStream([{ choices: [{ delta: { content: 'Självklart!' } }] }]));

    const ws = await connect();

    // First message
    let collecting = collectMessages(ws);
    ws.send(JSON.stringify({ type: 'message', content: 'Hej!' }));
    await collecting;

    // Second message
    collecting = collectMessages(ws);
    ws.send(JSON.stringify({ type: 'message', content: 'Kan du rekommendera något?' }));
    await collecting;

    ws.close();

    // Second call should include the full history (system + user1 + assistant1 + user2)
    const secondCallArgs = mockChatSend.mock.calls[1][0] as { chatGenerationParams: { messages: Array<{ role: string; content: string }> } };
    const msgs = secondCallArgs.chatGenerationParams.messages;

    expect(msgs.some((m) => m.role === 'system')).toBe(true);
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(2);
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(msgs.find((m) => m.role === 'assistant')?.content).toBe('Jag kan hjälpa!');
  });
});
