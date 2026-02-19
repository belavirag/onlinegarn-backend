# Shopify Backend

Node.js/TypeScript REST API for Shopify store integration. Built with Express.js v5, backed by Redis for session/token storage, and connects to the Shopify Admin GraphQL API for product and inventory data.

## Tech Stack

- **Runtime**: Node.js
- **Language**: TypeScript (strict mode)
- **Framework**: Express.js v5
- **Database**: Redis (via ioredis)
- **External API**: Shopify Admin GraphQL API (`@shopify/shopify-api`)
- **Testing**: Vitest + Supertest + MSW

## Prerequisites

- Node.js (v20+)
- Docker (for local Redis)
- A Shopify app with API credentials
- A Shopify OAuth access token (stored in Redis)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Start Redis

```bash
docker-compose up -d
```

### 3. Set environment variables

Export the required variables in your shell:

```bash
export SHOPIFY_API_KEY="your-api-key"
export SHOPIFY_API_SECRET="your-api-secret"
export SHOPIFY_APP_URL="https://your-app-url.com"
export SHOPIFY_SHOP_DOMAIN="your-store.myshopify.com"
```

**Note**: There is no `dotenv` support. Variables must be set in the shell environment.

### 4. Populate the OAuth token in Redis

The app reads the Shopify admin access token from Redis on startup. You must populate it manually:

```bash
redis-cli SET oauth '{"access_token":"shpat_your_access_token"}'
```

### 5. Run the dev server

```bash
npm run dev
```

The server starts on `http://localhost:3000`.

## API Endpoints

### `GET /`

Health check endpoint.

**Response**: `200 OK` (plain text)

### `GET /products`

Fetch a paginated list of products from Shopify.

**Query parameters**:
- `first` (optional) -- Number of products to return (1-50, default: 12)
- `after` (optional) -- Cursor for pagination (from `pageInfo.endCursor` in a previous response)

**Response** (`200`):
```json
{
  "products": [
    {
      "id": "gid://shopify/Product/123456",
      "title": "Product Name",
      "description": "Plain text description",
      "descriptionHtml": "<p>HTML description</p>",
      "handle": "product-name",
      "minPrice": { "amount": "10.0", "currencyCode": "SEK" },
      "images": [
        { "url": "https://...", "altText": "Image alt" }
      ],
      "variants": [
        {
          "id": "gid://shopify/ProductVariant/789",
          "title": "Default",
          "price": "10.0",
          "image": null,
          "inventoryQuantity": 5,
          "selectedOptions": [{ "name": "Title", "value": "Default" }]
        }
      ],
      "options": [{ "name": "Title", "values": ["Default"] }]
    }
  ],
  "pageInfo": {
    "hasNextPage": false,
    "endCursor": null
  }
}
```

**Error responses**:
- `500` -- Shopify API error

### `GET /products/:productId/inventory`

Fetch product inventory levels from Shopify.

**Parameters**:
- `productId` -- Shopify product GID (e.g., `gid://shopify/Product/123456`)

**Response** (`200`):
```json
{
  "id": "gid://shopify/Product/123456",
  "title": "Product Name",
  "variants": [
    {
      "id": "gid://shopify/ProductVariant/789",
      "title": "Default Title",
      "inventoryLevels": [
        {
          "id": "gid://shopify/InventoryLevel/...",
          "locationName": "Warehouse",
          "available": 10
        }
      ]
    }
  ]
}
```

**Error responses**:
- `404` -- Product not found
- `500` -- Shopify API error

## Environment Variables

| Variable              | Description                       | Default                   | Required |
| --------------------- | --------------------------------- | ------------------------- | -------- |
| `PORT`                | Server port                       | `3000`                    | No       |
| `REDISHOST`           | Redis host                        | `localhost`               | No       |
| `REDISPORT`           | Redis port                        | `6379`                    | No       |
| `REDISPASSWORD`       | Redis password                    | (none)                    | No       |
| `SHOPIFY_API_KEY`     | Shopify app API key               | --                        | **Yes**  |
| `SHOPIFY_API_SECRET`  | Shopify app API secret            | --                        | **Yes**  |
| `SHOPIFY_APP_URL`     | Shopify app URL                   | --                        | **Yes**  |
| `SHOPIFY_API_VERSION` | Shopify API version               | `2025-01`                 | No       |
| `SHOPIFY_SHOP_DOMAIN` | Shopify store domain              | `unknown.myshopify.com`   | No       |

Required env vars are validated at startup with clear error messages. The process exits with code 1 if any are missing.

## Available Scripts

| Command              | Description                                |
| -------------------- | ------------------------------------------ |
| `npm run build`      | Compile TypeScript (`tsc`)                 |
| `npm start`          | Run compiled app (`node dist/index.js`)    |
| `npm run dev`        | Dev mode with hot reload (nodemon/ts-node) |
| `npm test`           | Run tests once (`vitest run`)              |
| `npm run test:watch` | Run tests in watch mode (`vitest`)         |

## Production Build

```bash
npm run build
npm start
```

## Project Structure

```
src/
├── index.ts                    # Entry point, Express app setup, startup sequence
├── errors.ts                   # Custom error classes (AppError, NotFoundError)
├── routes/
│   ├── health.ts               # GET /
│   ├── products.ts             # GET /products
│   └── product-inventory.ts    # GET /products/:productId/inventory
├── services/
│   ├── redis.ts                # Redis client (ioredis, lazy connect)
│   └── shopify.ts              # Shopify API client (singleton, OAuth from Redis, GraphQL client factory)
├── tests/
│   ├── health.test.ts
│   ├── products.test.ts
│   └── product-inventory.test.ts
└── mocks/
    ├── handlers.ts             # MSW request handlers
    └── server.ts               # MSW server setup
```

## Testing

```bash
npm test            # Run once
npm run test:watch  # Watch mode
```

Tests use Vitest with Supertest for HTTP assertions. All external services (Redis, Shopify) are mocked. Each test file creates its own isolated Express app instance.

## CI

GitHub Actions runs `npm test` and `npm run build` on every push and pull request to `main`. See `.github/workflows/test.yml`.

## Deployment

For deployment (e.g., Railway), configure the Redis and Shopify environment variables listed above. Ensure the OAuth token is populated in Redis before the app starts.
