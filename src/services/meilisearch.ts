import { MeiliSearch } from 'meilisearch';

let client: MeiliSearch | null = null;

export const PRODUCTS_INDEX = 'products';

/**
 * Initializes the Meilisearch client.
 * Requires MEILI_ENV (host URL) and MEILI_API_KEY environment variables.
 * Validates connectivity by checking health.
 */
export async function initMeilisearch(): Promise<void> {
  const host = process.env.MEILI_ENDPOINT;
  if (!host) {
    throw new Error('Missing required environment variable: MEILI_ENDPOINT');
  }

  const apiKey = process.env.MEILI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing required environment variable: MEILI_API_KEY');
  }

  client = new MeiliSearch({ host, apiKey });

  // Validate connectivity
  const health = await client.health();
  if (health.status !== 'available') {
    throw new Error(`Meilisearch is not healthy: ${health.status}`);
  }

  // Ensure the products index exists with the correct primary key.
  // Using Shopify's product ID as the primary key prevents duplicates --
  // subsequent additions with the same ID will update (replace) the document.
  await client.createIndex(PRODUCTS_INDEX, { primaryKey: 'id' });

  // Configure searchable and filterable attributes
  const index = client.index(PRODUCTS_INDEX);
  await index.updateSearchableAttributes([
    'title',
    'description',
    'handle',
    'collections',
    'options',
    'variantTitles',
  ]);
  await index.updateFilterableAttributes([
    'collections',
    'collectionHandles',
    'minPriceAmount',
    'handle',
  ]);
  await index.updateSortableAttributes([
    'title',
    'minPriceAmount',
  ]);

  console.log('Meilisearch initialized successfully');
}

export function getMeilisearch(): MeiliSearch {
  if (!client) {
    throw new Error('Meilisearch not initialized. Call initMeilisearch() first.');
  }
  return client;
}
