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
│   ├── index.ts                    # App entry point: creates Express app, connects Redis, inits Shopify
│   ├── routes/
│   │   ├── health.ts               # GET / -> 200 "OK"
│   │   └── product-inventory.ts    # GET /products/:productId/inventory -> Shopify GraphQL
│   ├── services/
│   │   ├── redis.ts                # ioredis client (lazy connect, env-configured)
│   │   └── shopify.ts              # Shopify API client (reads OAuth token from Redis)
│   ├── tests/
│   │   ├── health.test.ts
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

| Variable              | Used In                          | Default                    | Required |
| --------------------- | -------------------------------- | -------------------------- | -------- |
| `PORT`                | `src/index.ts`                   | `3000`                     | No       |
| `REDISHOST`           | `src/services/redis.ts`          | `localhost`                | No       |
| `REDISPORT`           | `src/services/redis.ts`          | `6379`                     | No       |
| `REDISPASSWORD`       | `src/services/redis.ts`          | `undefined`                | No       |
| `SHOPIFY_API_KEY`     | `src/services/shopify.ts`        | None (crashes if missing)  | **Yes**  |
| `SHOPIFY_API_SECRET`  | `src/services/shopify.ts`        | None (crashes if missing)  | **Yes**  |
| `SHOPIFY_APP_URL`     | `src/services/shopify.ts`        | None (crashes if missing)  | **Yes**  |
| `SHOPIFY_API_VERSION` | `src/services/shopify.ts`        | `2025-01`                  | No       |
| `SHOPIFY_SHOP_DOMAIN` | `src/routes/product-inventory.ts`| `unknown.myshopify.com`    | No       |

Additionally, an OAuth access token must be stored in Redis under key `"oauth"` as JSON: `{"access_token": "..."}`. This is read at startup by `initShopify()`.

## Architecture & Patterns

### Routing

- One route module per file in `src/routes/`.
- Each file creates an Express `Router()`, defines handlers, and exports the router as `default`.
- All routers are mounted at `/` in `src/index.ts` (routes define their own full path patterns).
- Prefix unused parameters with `_` (e.g., `_req`).

### Services

- Services live in `src/services/` as singletons.
- **Redis** (`redis.ts`): exports a default `ioredis` instance with `lazyConnect: true`. Connected explicitly on startup.
- **Shopify** (`shopify.ts`): lazy-initialized singleton pattern. Must call `initShopify()` before using `getShopify()` or `getAdminAccessToken()`. Reads the OAuth token from Redis.

### Startup Sequence (src/index.ts)

1. Create Express app, register routes
2. Start HTTP server on `PORT`
3. `await redis.connect()`
4. `await initShopify()` (reads OAuth from Redis, creates Shopify API client)

### Error Handling

- Route handlers use `try/catch` blocks.
- Differentiated HTTP status codes based on error messages (e.g., "Product not found" -> 404).
- Generic errors return 500.
- `console.error` for server-side logging.
- Express 5 automatically catches rejected promises in async handlers.

### No middleware currently configured

There is no `express.json()`, CORS, auth, or logging middleware. All current routes are GET endpoints. Add body-parsing middleware when POST/PUT/PATCH routes are introduced.

## Coding Conventions

- **TypeScript strict mode** -- all strict checks enabled.
- **Explicit types** on function parameters (e.g., `req: Request, res: Response`).
- **ES6+ syntax**: `const`/`let`, arrow functions, `async`/`await`.
- **Interfaces** for all API response shapes (both raw GraphQL and simplified).
- **`async` route handlers** with `Promise<void>` return type.
- Define GraphQL query strings as `const` assertions.

### Adding a New Route

1. Create `src/routes/<name>.ts`:
   ```typescript
   import { Router, Request, Response } from 'express';

   const router = Router();

   router.get('/your-path', async (_req: Request, res: Response): Promise<void> => {
     res.status(200).json({ ok: true });
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
4. Initialize in `src/index.ts` startup sequence.

## Testing

### Principles

- **All new code must include tests.**
- Tests live in `src/tests/` (not co-located with source).
- Each test file creates its own isolated Express app instance.
- All external services (Redis, Shopify, etc.) must be mocked with `vi.mock()`.
- Use Supertest for HTTP-level assertions.
- Use `beforeAll`/`afterAll` lifecycle hooks for setup and teardown.
- Suppress expected `console.error` output with `vi.spyOn(console, 'error')`.

### Test File Template

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';

// Mock all external services before importing route
vi.mock('../services/redis', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  },
}));

import myRoutes from '../routes/my-route';

describe('My Route', () => {
  let app: Application;

  beforeAll(() => {
    app = express();
    app.use('/', myRoutes);
  });

  it('should return expected response', async () => {
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
- `esModuleInterop: true`, `resolveJsonModule: true`, `declaration: true`, `skipLibCheck: true`

## Vitest Configuration

- `globals: true` -- test functions available without importing
- `environment: 'node'`
- `include: ['src/**/*.test.ts']`
- Path alias: `@` -> `./src` (configured but not currently used in the codebase)
- Coverage: V8 provider with text, JSON, and HTML reporters

## Key Dependencies

| Package                | Version | Notes                                    |
| ---------------------- | ------- | ---------------------------------------- |
| `express`              | ^5.2.1  | Express 5 (not 4) -- async error support |
| `@shopify/shopify-api` | ^12.3.0 | Shopify Admin API client                 |
| `ioredis`              | ^5.9.3  | Redis client                             |
| `vitest`               | ^4.0.18 | Test runner                              |
| `msw`                  | ^2.12.10| Mock Service Worker                      |
| `supertest`            | ^7.2.2  | HTTP testing                             |
| `typescript`           | ^5.9.3  | Compiler                                 |

## Known Issues / Gotchas

1. **Express 5**: This is Express 5, not 4. Route parameter behavior differs (e.g., `/products/:productId/inventory` won't match `/products//inventory` -- it returns 404).
2. **Required env vars use `!` assertion**: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, and `SHOPIFY_APP_URL` use TypeScript non-null assertions without runtime validation. Missing values cause confusing runtime crashes.
3. **OAuth token not managed by this app**: The Shopify OAuth access token must be pre-populated in Redis key `"oauth"`. There is no OAuth flow in this codebase.
4. **No Dockerfile**: A `.dockerignore` exists but no `Dockerfile` is present yet.
5. **MSW browser worker**: `public/mockServiceWorker.js` was auto-generated and is unnecessary for a backend project. Do not delete it (it is referenced in `package.json` msw config).
6. **Path alias `@`**: Configured in `vitest.config.ts` but not used anywhere in the codebase.
