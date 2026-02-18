# AGENTS.md

This document provides guidance for AI agents working on this project.

## Project Overview

- **Project Name**: shopify-backend
- **Type**: Node.js/TypeScript/Express REST API
- **Core Functionality**: Backend API service

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript (strict mode)
- **Framework**: Express.js
- **Package Manager**: npm
- **Testing**: Vitest + Supertest + MSW

## Project Structure

```
├── src/
│   ├── index.ts          # Application entry point
│   ├── routes/           # Route handlers (one file per route)
│   │   └── health.ts     # GET / route
│   ├── services/         # Services (Redis, etc.)
│   │   └── redis.ts      # Redis client
│   ├── tests/           # Test files
│   │   └── health.test.ts
│   └── mocks/            # MSW mocks for external APIs
├── dist/                 # Compiled JavaScript output
├── docker-compose.yml    # Local development services
├── vitest.config.ts      # Vitest configuration
├── package.json
├── tsconfig.json
└── AGENTS.md
```

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled application |
| `npm run dev` | Run in development mode with hot reload (nodemon + ts-node) |
| `docker-compose up -d` | Start local development services (Redis) |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |

## Development Workflow

1. **Start local services**: `docker-compose up -d`
2. **Run in development**: `npm run dev`
3. **Build for production**: `npm run build`
4. **Start production server**: `npm start`

### General Principles

- Use strict TypeScript with strict mode enabled
- Prefer explicit types over type inference for function parameters
- Use ES6+ syntax (const/let, arrow functions, async/await)
- One route per file, co-located in `src/routes/`
- Use Router from express for modular route definitions

### Route File Structure

Each route file should:
- Import `Router`, `Request`, `Response` from express
- Export the router as default
- Use `_` prefix for unused parameters (e.g., `_req`)

Example (`src/routes/health.ts`):
```typescript
import { Router, Request, Response } from 'express';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.status(200).send('OK');
});

export default router;
```

### Application Entry Point

The entry point (`src/index.ts`) should:
- Create the Express application
- Register middleware and routes
- Import and connect services (Redis, etc.)
- Read port from environment or default to 3000

Example:
```typescript
import express, { Application } from 'express';
import healthRoutes from './routes/health';
import redis from './services/redis';

const app: Application = express();

app.use('/', healthRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  await redis.connect();
});
```

## Services

Services are stored in `src/services/` and should:
- Export a default instance
- Handle connection lifecycle
- Use environment variables with sensible defaults

Example (`src/services/redis.ts`):
```typescript
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDISHOST || 'localhost',
  port: parseInt(process.env.REDISPORT || '6379', 10),
  password: process.env.REDISPASSWORD || undefined,
  lazyConnect: true,
});

redis.on('connect', () => {
  console.log('Connected to Redis');
});

export default redis;
```

## Testing

All new code must include tests. This project uses Vitest with Supertest for HTTP testing and MSW for mocking external APIs.

### Running Tests

```bash
npm test          # Run tests once
npm run test:watch  # Run tests in watch mode
```

### Writing Tests

Tests go in `src/tests/` and should follow this pattern:

```typescript
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express, { Application } from 'express';
import healthRoutes from '../routes/health';

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

  it('should return OK status', async () => {
    const response = await request(app).get('/').expect(200);
    expect(response.text).toBe('OK');
  });
});
```

### Mocking Services

Always mock external services (Redis, databases, etc.) using `vi.mock`:

```typescript
vi.mock('../services/redis', () => ({
  default: {
    connect: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  },
}));
```

### Using MSW for External APIs

For mocking external HTTP APIs, use MSW handlers in `src/mocks/handlers.ts`:

```typescript
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('https://api.example.com/health', () => {
    return HttpResponse.json({ status: 'OK' });
  }),
];
```

Then use the server in tests:
```typescript
import { server } from '../mocks/server';

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## TypeScript Configuration

Strict mode is enabled with these key settings:
- `strict: true` - Enable all strict type checking
- `esModuleInterop: true` - Allow default imports from CommonJS
- `declaration: true` - Generate .d.ts files

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `REDISHOST` | Redis host | localhost |
| `REDISPORT` | Redis port | 6379 |
| `REDISPASSWORD` | Redis password | (none) |
