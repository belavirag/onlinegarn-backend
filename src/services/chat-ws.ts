import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { getMeilisearch, PRODUCTS_INDEX } from './meilisearch';
import { getOpenRouterClient } from './openrouter';

// Inline types matching the OpenRouter SDK shapes (avoids sub-path import issues with CommonJS moduleResolution)
interface ReasoningDetail {
  type: string;
  text?: string | null;
  data?: string;
  summary?: string;
  id?: string | null;
  index?: number;
}

interface SystemMessage {
  role: 'system';
  content: string;
}

interface UserMessage {
  role: 'user';
  content: string;
}

interface AssistantMessage {
  role: 'assistant';
  content?: string | null;
  reasoning?: string | null;
  reasoningDetails?: ReasoningDetail[];
}

type ChatMessage = SystemMessage | UserMessage | AssistantMessage;

// Message types sent over WebSocket to/from client
interface ClientMessage {
  type: 'message';
  content: string;
}

interface ServerTokenEvent {
  type: 'token';
  content: string;
}

interface ServerDoneEvent {
  type: 'done';
}

interface ServerErrorEvent {
  type: 'error';
  message: string;
}

type ServerEvent = ServerTokenEvent | ServerDoneEvent | ServerErrorEvent;

// A conversation turn in our internal history
interface ConversationMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  reasoning?: string | null;
  reasoningDetails?: ReasoningDetail[];
}

const MODEL = 'openrouter/optimus-alpha';

const SYSTEM_PROMPT = `Du är en hjälpsam shoppingassistent för en svensk garnanaffär. \
Din uppgift är att hjälpa kunder att hitta rätt garn och tillbehör baserat på deras behov och projekt.

Ställ frågor för att förstå kundens behov: vad de ska sticka/virka, önskad kvalitet, budget och färgpreferenser. \
Ge sedan personliga produktrekommendationer från butikens sortiment.

Svara alltid på svenska om inte kunden skriver på engelska – i så fall är det okej att svara på engelska.

Nedan följer butikens aktuella produktsortiment i JSON-format:
{PRODUCTS}`;

/**
 * Fetches a condensed product list from Meilisearch to use as AI context.
 * We limit to 200 products and trim fields to keep the prompt manageable.
 */
async function fetchProductContext(): Promise<string> {
  try {
    const meili = getMeilisearch();
    const index = meili.index(PRODUCTS_INDEX);
    const result = await index.getDocuments({ limit: 200, fields: ['title', 'description', 'minPriceAmount', 'minPriceCurrency', 'collections', 'options', 'variantTitles', 'handle'] });

    const products = result.results.map((p) => ({
      title: p.title,
      description: p.description ? (p.description as string).slice(0, 200) : '',
      price: `${p.minPriceAmount} ${p.minPriceCurrency}`,
      collections: p.collections,
      options: p.options,
      variants: p.variantTitles,
      handle: p.handle,
    }));

    return JSON.stringify(products, null, 0);
  } catch (error) {
    console.error('Failed to fetch product context for chat:', error);
    return '[]';
  }
}

function send(ws: WebSocket, event: ServerEvent): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

async function handleConnection(ws: WebSocket): Promise<void> {
  const history: ConversationMessage[] = [];
  let productContext: string | null = null;

  ws.on('message', async (raw) => {
    let parsed: ClientMessage;
    try {
      parsed = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      send(ws, { type: 'error', message: 'Invalid message format. Expected JSON with type and content.' });
      return;
    }

    if (parsed.type !== 'message' || typeof parsed.content !== 'string' || !parsed.content.trim()) {
      send(ws, { type: 'error', message: 'Message must have type "message" and a non-empty content string.' });
      return;
    }

    // Lazy-load product context on first message
    if (productContext === null) {
      productContext = await fetchProductContext();
    }

    // Add user message to history
    history.push({ role: 'user', content: parsed.content.trim() });

    // Build messages array for the API call
    const systemMessage: ChatMessage = {
      role: 'system',
      content: SYSTEM_PROMPT.replace('{PRODUCTS}', productContext),
    };

    const apiMessages: ChatMessage[] = [
      systemMessage,
      ...history.map((turn): ChatMessage => {
        if (turn.role === 'user') {
          return { role: 'user', content: turn.content };
        }
        // Preserve reasoning_details on assistant messages so the model can
        // continue reasoning from where it left off
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: turn.content,
        };
        if (turn.reasoning != null) {
          assistantMsg.reasoning = turn.reasoning;
        }
        if (turn.reasoningDetails && turn.reasoningDetails.length > 0) {
          assistantMsg.reasoningDetails = turn.reasoningDetails;
        }
        return assistantMsg;
      }),
    ];

    try {
      const client = await getOpenRouterClient();
      // Cast our local ChatMessage type to the SDK's Message type. The shapes are
      // compatible at runtime; the cast is needed because our ReasoningDetail uses
      // a wider `string` type for the discriminant instead of the SDK's narrow literals.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stream = await client.chat.send({
        chatGenerationParams: {
          model: MODEL,
          messages: apiMessages as unknown as Parameters<typeof client.chat.send>[0]['chatGenerationParams']['messages'],
          stream: true,
          reasoning: { effort: 'high' },
        },
      });

      let assistantContent = '';
      let assistantReasoning: string | null = null;
      let assistantReasoningDetails: ReasoningDetail[] = [];

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // Stream content tokens to client
        if (delta.content) {
          assistantContent += delta.content;
          send(ws, { type: 'token', content: delta.content });
        }

        // Accumulate reasoning for history preservation
        if (delta.reasoning) {
          assistantReasoning = (assistantReasoning ?? '') + delta.reasoning;
        }
        if (delta.reasoningDetails && delta.reasoningDetails.length > 0) {
          assistantReasoningDetails = assistantReasoningDetails.concat(delta.reasoningDetails);
        }
      }

      // Store the complete assistant turn in history, preserving reasoning details
      const assistantTurn: ConversationMessage = {
        role: 'assistant',
        content: assistantContent,
      };
      if (assistantReasoning != null) {
        assistantTurn.reasoning = assistantReasoning;
      }
      if (assistantReasoningDetails.length > 0) {
        assistantTurn.reasoningDetails = assistantReasoningDetails;
      }
      history.push(assistantTurn);

      send(ws, { type: 'done' });
    } catch (error) {
      console.error('OpenRouter chat error:', error);
      send(ws, { type: 'error', message: 'Failed to get a response from the AI. Please try again.' });
    }
  });
}

/**
 * Attaches a WebSocket server to an existing HTTP server.
 * The WebSocket endpoint is available at ws://host/chat
 */
export function attachChatWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/chat' });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    console.log(`WebSocket connection opened: ${req.socket.remoteAddress}`);

    handleConnection(ws).catch((error: unknown) => {
      console.error('WebSocket handler error:', error);
      send(ws, { type: 'error', message: 'Internal server error.' });
      ws.close();
    });

    ws.on('close', () => {
      console.log(`WebSocket connection closed: ${req.socket.remoteAddress}`);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  return wss;
}
