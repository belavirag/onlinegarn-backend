# AGENTS.md

Guidance for AI agents working on this codebase.

## Project Overview

- **Package name**: `shopify-backend`
- **Type**: Node.js/TypeScript REST API for Shopify store integration
- **Framework**: Express.js v5 (note: Express 5, not 4 -- promises in route handlers are properly handled)
- **Runtime**: Node.js
- **Language**: TypeScript with `strict: true`
- **Package Manager**: npm
- **Testing**: Vitest + Supertest + MSW
- **CI**: GitHub Actions (`.github/workflows/test.yml`)

## Project Structure

```
├── .github/workflows/
│   └── test.yml                    # CI: test + build on push/PR to main
├── public/
│   └── mockServiceWorker.js        # MSW browser worker (auto-generated, do not edit)
├── src/
│   ├── index.ts                    # App entry point: creates Express app, inits services, starts server
│   ├── errors.ts                   # Custom error classes (AppError, NotFoundError)
│   ├── routes/
│   │   ├── health.ts               # GET / -> 200 "OK"
│   │   ├── products.ts             # GET /products -> paginated product list from Shopify GraphQL
│   │   └── product-inventory.ts    # GET /products/:productId/inventory -> Shopify GraphQL
│   ├── services/
│   │   ├── redis.ts                # ioredis client (lazy connect, env-configured)
│   │   └── shopify.ts              # Shopify API client (reads OAuth token from Redis, shared GraphQL client factory)
│   ├── tests/
│   │   ├── health.test.ts
│   │   ├── products.test.ts
│   │   └── product-inventory.test.ts
│   └── mocks/
│       ├── handlers.ts             # MSW request handlers (placeholder)
│       └── server.ts               # MSW server setup
├── dist/                           # Compiled output (gitignored)
├── docker-compose.yml              # Local Redis (redis:7-alpine)
├── vitest.config.ts
├── tsconfig.json
├── package.json
└── AGENTS.md
```

## Scripts

| Command              | Description                                |
| -------------------- | ------------------------------------------ |
| `npm run build`      | Compile TypeScript (`tsc`)                 |
| `npm start`          | Run compiled app (`node dist/index.js`)    |
| `npm run dev`        | Dev mode with hot reload (nodemon/ts-node) |
| `npm test`           | Run tests once (`vitest run`)              |
| `npm run test:watch` | Run tests in watch mode (`vitest`)         |

## Development Workflow

1. `docker-compose up -d` -- start local Redis
2. Set required environment variables (see below)
3. Populate Redis key `"oauth"` with `{"access_token": "shpat_..."}` (required for Shopify)
4. `npm run dev` -- start dev server on port 3000

## Environment Variables

| Variable              | Used In                    | Default                    | Required |
| --------------------- | -------------------------- | -------------------------- | -------- |
| `PORT`                | `src/index.ts`             | `3000`                     | No       |
| `REDISHOST`           | `src/services/redis.ts`    | `localhost`                | No       |
| `REDISPORT`           | `src/services/redis.ts`    | `6379`                     | No       |
| `REDISPASSWORD`       | `src/services/redis.ts`    | `undefined`                | No       |
| `SHOPIFY_API_KEY`     | `src/services/shopify.ts`  | None (validated at startup)| **Yes**  |
| `SHOPIFY_API_SECRET`  | `src/services/shopify.ts`  | None (validated at startup)| **Yes**  |
| `SHOPIFY_APP_URL`     | `src/services/shopify.ts`  | None (validated at startup)| **Yes**  |
| `SHOPIFY_API_VERSION` | `src/services/shopify.ts`  | `2025-01`                  | No       |
| `SHOPIFY_SHOP_DOMAIN` | `src/services/shopify.ts`  | `unknown.myshopify.com`    | No       |

Required env vars (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`) are validated at startup with clear error messages via `getRequiredEnv()`. The process exits with code 1 if any are missing.

Additionally, an OAuth access token must be stored in Redis under key `"oauth"` as JSON: `{"access_token": "..."}`. This is read at startup by `initShopify()`, which validates the JSON structure.

**Note**: There is no `dotenv` package installed. Environment variables must be exported in the shell (e.g., `export SHOPIFY_API_KEY=...`).

## Architecture & Patterns

### Routing

- One route module per file in `src/routes/`.
- Each file creates an Express `Router()`, defines handlers, and exports the router as `default`.
- All routers are mounted at `/` in `src/index.ts` (routes define their own full path patterns).
- Prefix unused parameters with `_` (e.g., `_req`).

### Services

- Services live in `src/services/` as singletons.
- **Redis** (`redis.ts`): exports a default `ioredis` instance with `lazyConnect: true`. Connected explicitly on startup.
- **Shopify** (`shopify.ts`): lazy-initialized singleton pattern. Must call `initShopify()` before using `getShopify()`, `getAdminAccessToken()`, or `createGraphqlClient()`. Reads the OAuth token from Redis.
  - `createGraphqlClient()`: shared factory that creates a Shopify GraphQL client with the admin access token and session. Used by all route handlers instead of duplicating session/client creation logic.

### Error Handling

- **Custom error classes** (`src/errors.ts`): `AppError` (base, carries `statusCode`) and `NotFoundError` (extends `AppError`, 404).
- Route handlers use `try/catch` blocks and check `instanceof AppError` for structured error responses.
- A **global error handler middleware** in `src/index.ts` catches any unhandled errors and returns JSON (`{ error: "..." }`) instead of Express's default HTML error page.
- Generic errors return 500.
- `console.error` for server-side logging.
- Express 5 automatically catches rejected promises in async handlers.

### Middleware

- **CORS**: `cors()` middleware is enabled globally (allows all origins by default).
- **Global error handler**: registered after all routes, returns JSON error responses.
- There is no `express.json()`, auth, or logging middleware. All current routes are GET endpoints. Add body-parsing middleware when POST/PUT/PATCH routes are introduced.

### Startup Sequence (src/index.ts)

1. Create Express app, register CORS middleware and routes
2. Register global error handler
3. `await redis.connect()` -- fails fast with `process.exit(1)` on error
4. `await initShopify()` -- validates env vars, parses/validates OAuth from Redis, creates Shopify API client; fails fast with `process.exit(1)` on error
5. Start HTTP server on `PORT` (only after services are initialized)

## Coding Conventions

- **TypeScript strict mode** -- all strict checks enabled.
- **Explicit types** on function parameters (e.g., `req: Request, res: Response`), return types, and `.map()` callbacks.
- **ES6+ syntax**: `const`/`let`, arrow functions, `async`/`await`.
- **Interfaces** for all API response shapes (both raw GraphQL and simplified).
- **`async` route handlers** with `Promise<void>` return type.
- Define GraphQL query strings as `const` assertions.
- Use `AppError`/`NotFoundError` for errors with HTTP status codes; never match errors by message strings.
- Use `createGraphqlClient()` from the shopify service instead of creating sessions/clients inline.

### Adding a New Route

1. Create `src/routes/<name>.ts`:
   ```typescript
   import { Router, Request, Response } from 'express';
   import { createGraphqlClient } from '../services/shopify';
   import { AppError } from '../errors';

   const router = Router();

   router.get('/your-path', async (_req: Request, res: Response): Promise<void> => {
     try {
       const client = createGraphqlClient();
       // ... use client to query Shopify
       res.status(200).json({ ok: true });
     } catch (error) {
       console.error('Error:', error);
       if (error instanceof AppError) {
         res.status(error.statusCode).json({ error: error.message });
         return;
       }
       res.status(500).json({ error: 'Internal server error' });
     }
   });

   export default router;
   ```
2. Register in `src/index.ts`:
   ```typescript
   import newRoutes from './routes/<name>';
   app.use('/', newRoutes);
   ```
3. Add tests in `src/tests/<name>.test.ts`.

### Adding a New Service

1. Create `src/services/<name>.ts`.
2. Export a default instance or init/getter functions.
3. Use environment variables for configuration with sensible defaults.
4. Validate required env vars with clear error messages (see `getRequiredEnv()` pattern in `shopify.ts`).
5. Initialize in `src/index.ts` startup sequence (inside the `start()` function's try/catch).

## Testing

### Principles

- **All new code must include tests.**
- Tests live in `src/tests/` (not co-located with source).
- Each test file creates its own isolated Express app instance.
- All external services (Redis, Shopify, etc.) must be mocked with `vi.mock()`.
- Use Supertest for HTTP-level assertions.
- Use `beforeAll`/`afterAll` lifecycle hooks for setup and teardown.
- Suppress expected `console.error` output with `vi.spyOn(console, 'error')`.
- Tests must cover happy-path, error-path, and edge cases.

### Test File Template

```typescript
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';

// Mock all external services before importing route
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
    createGraphqlClient: vi.fn(() => new MockGraphqlClient()),
    getShopify: vi.fn(),
    getAdminAccessToken: vi.fn(() => 'test_token'),
  };
});

vi.mock('@shopify/shopify-api/adapters/node', () => ({}));

import myRoutes from '../routes/my-route';

describe('My Route', () => {
  let app: Application;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    app = express();
    app.use('/', myRoutes);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should return expected response', async () => {
    mockRequest.mockResolvedValueOnce({
      data: { /* mock GraphQL response */ },
    });

    const response = await request(app).get('/my-path').expect(200);
    expect(response.body).toEqual({ ok: true });
  });
});
```

### MSW Setup (for external HTTP APIs)

MSW infrastructure is set up in `src/mocks/` but currently has only a placeholder handler. To add real handlers:

1. Define handlers in `src/mocks/handlers.ts` using `http` and `HttpResponse` from `msw`.
2. Use the server in tests:
   ```typescript
   import { server } from '../mocks/server';

   beforeAll(() => server.listen());
   afterEach(() => server.resetHandlers());
   afterAll(() => server.close());
   ```

### Running Tests

```bash
npm test            # Single run
npm run test:watch  # Watch mode
```

CI runs `npm test` and `npm run build` on every push/PR to `main`.

## TypeScript Configuration

- **Target**: ES2020
- **Module**: CommonJS
- **Strict**: `true`
- **Output**: `./dist`
- **Root**: `./src`
- `esModuleInterop: true`, `resolveJsonModule: true`, `skipLibCheck: true`
- Test and mock files (`src/tests/`, `src/mocks/`) are excluded from the build output

## Vitest Configuration

- `globals: true` -- test functions available without importing
- `environment: 'node'`
- `include: ['src/**/*.test.ts']`
- Path alias: `@` -> `./src` (configured but not currently used in the codebase)
- Coverage: V8 provider with text, JSON, and HTML reporters

## Key Dependencies

| Package                | Version  | Notes                                    |
| ---------------------- | -------- | ---------------------------------------- |
| `express`              | ^5.2.1   | Express 5 (not 4) -- async error support |
| `@shopify/shopify-api` | ^12.3.0  | Shopify Admin API client                 |
| `ioredis`              | ^5.9.3   | Redis client (ships its own types)       |
| `cors`                 | ^2.8.6   | CORS middleware                          |
| `vitest`               | ^4.0.18  | Test runner                              |
| `msw`                  | ^2.12.10 | Mock Service Worker                      |
| `supertest`            | ^7.2.2   | HTTP testing                             |
| `typescript`           | ^5.9.3   | Compiler                                 |

## Known Issues / Gotchas

1. **Express 5**: This is Express 5, not 4. Route parameter behavior differs (e.g., `/products/:productId/inventory` won't match `/products//inventory` -- it returns 404).
2. **OAuth token not managed by this app**: The Shopify OAuth access token must be pre-populated in Redis key `"oauth"`. There is no OAuth flow in this codebase.
3. **No Dockerfile**: A `.dockerignore` exists but no `Dockerfile` is present yet.
4. **MSW browser worker**: `public/mockServiceWorker.js` was auto-generated and is unnecessary for a backend project. Do not delete it (it is referenced in `package.json` msw config).
5. **Path alias `@`**: Configured in `vitest.config.ts` but not used anywhere in the codebase.
6. **No `dotenv`**: There is no `dotenv` package. Environment variables must be set in the shell.
