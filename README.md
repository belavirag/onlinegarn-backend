# Shopify Backend

Node.js/TypeScript REST API built with Express.js.

## Tech Stack

- Node.js
- TypeScript (strict mode)
- Express.js
- Redis (via ioredis)

## Getting Started

### Prerequisites

- Node.js
- Docker (for local Redis)

### Local Development

1. Start Redis:
   ```bash
   docker-compose up -d
   ```

2. Run the development server:
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3000`.

### Production Build

```bash
npm run build
npm start
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `REDISHOST` | Redis host | localhost |
| `REDISPORT` | Redis port | 6379 |
| `REDISPASSWORD` | Redis password | (none) |

For Railway deployment, set `REDISHOST`, `REDISPORT`, and `REDISPASSWORD` in your environment variables.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled application |
| `npm run dev` | Run in development mode with hot reload |
| `docker-compose up -d` | Start local Redis container |
