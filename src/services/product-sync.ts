import cron, { ScheduledTask } from 'node-cron';
import { createGraphqlClient } from './shopify';
import { getMeilisearch, PRODUCTS_INDEX } from './meilisearch';

// GraphQL response types for the sync query
interface SyncGraphQLCollection {
  title: string;
  handle: string;
}

interface SyncGraphQLCollectionEdge {
  node: SyncGraphQLCollection;
}

interface SyncGraphQLMoney {
  amount: string;
  currencyCode: string;
}

interface SyncGraphQLImage {
  url: string;
  altText: string | null;
}

interface SyncGraphQLMediaNode {
  __typename: string;
  image?: SyncGraphQLImage;
}

interface SyncGraphQLMediaEdge {
  node: SyncGraphQLMediaNode;
}

interface SyncGraphQLSelectedOption {
  name: string;
  value: string;
}

interface SyncGraphQLVariant {
  id: string;
  title: string;
  price: string;
  inventoryQuantity: number;
  selectedOptions: SyncGraphQLSelectedOption[];
}

interface SyncGraphQLVariantEdge {
  node: SyncGraphQLVariant;
}

interface SyncGraphQLOption {
  name: string;
  values: string[];
}

interface SyncGraphQLProduct {
  id: string;
  title: string;
  description: string;
  handle: string;
  priceRangeV2: {
    minVariantPrice: SyncGraphQLMoney;
  };
  media: {
    edges: SyncGraphQLMediaEdge[];
  };
  variants: {
    edges: SyncGraphQLVariantEdge[];
  };
  options: SyncGraphQLOption[];
  collections: {
    edges: SyncGraphQLCollectionEdge[];
  };
}

interface SyncGraphQLProductEdge {
  node: SyncGraphQLProduct;
}

interface SyncGraphQLPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface SyncGraphQLProductsResponse {
  products: {
    pageInfo: SyncGraphQLPageInfo;
    edges: SyncGraphQLProductEdge[];
  };
}

// Meilisearch document shape
export interface MeiliProductDocument {
  id: string;
  title: string;
  description: string;
  handle: string;
  minPriceAmount: number;
  minPriceCurrency: string;
  images: { url: string; altText: string | null }[];
  variants: {
    id: string;
    title: string;
    price: string;
    inventoryQuantity: number;
    selectedOptions: { name: string; value: string }[];
  }[];
  options: { name: string; values: string[] }[];
  variantTitles: string[];
  collections: string[];
  collectionHandles: string[];
}

const SYNC_PRODUCTS_QUERY = `
  query SyncProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          description
          handle
          priceRangeV2 {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          media(first: 10) {
            edges {
              node {
                __typename
                ... on MediaImage {
                  image {
                    url
                    altText
                  }
                }
              }
            }
          }
          variants(first: 100) {
            edges {
              node {
                id
                title
                price
                inventoryQuantity
                selectedOptions {
                  name
                  value
                }
              }
            }
          }
          options {
            name
            values
          }
          collections(first: 50) {
            edges {
              node {
                title
                handle
              }
            }
          }
        }
      }
    }
  }
` as const;

/**
 * Converts a Shopify product GID to a Meilisearch-safe ID.
 * Meilisearch requires IDs to contain only alphanumeric characters, hyphens, and underscores.
 * e.g. "gid://shopify/Product/123" -> "shopify-Product-123"
 */
function sanitizeId(gid: string): string {
  return gid.replace('gid://', '').replace(/\//g, '-');
}

function transformProduct(product: SyncGraphQLProduct): MeiliProductDocument {
  const images = product.media.edges
    .filter((edge: SyncGraphQLMediaEdge) => edge.node.__typename === 'MediaImage' && edge.node.image)
    .map((edge: SyncGraphQLMediaEdge) => ({
      url: edge.node.image!.url,
      altText: edge.node.image!.altText,
    }));

  const variants = product.variants.edges.map((edge: SyncGraphQLVariantEdge) => ({
    id: edge.node.id,
    title: edge.node.title,
    price: edge.node.price,
    inventoryQuantity: edge.node.inventoryQuantity,
    selectedOptions: edge.node.selectedOptions,
  }));

  const collections = product.collections.edges.map(
    (edge: SyncGraphQLCollectionEdge) => edge.node.title
  );

  const collectionHandles = product.collections.edges.map(
    (edge: SyncGraphQLCollectionEdge) => edge.node.handle
  );

  return {
    id: sanitizeId(product.id),
    title: product.title,
    description: product.description,
    handle: product.handle,
    minPriceAmount: parseFloat(product.priceRangeV2.minVariantPrice.amount),
    minPriceCurrency: product.priceRangeV2.minVariantPrice.currencyCode,
    images,
    variants,
    options: product.options,
    variantTitles: variants.map((v: { title: string }) => v.title),
    collections,
    collectionHandles,
  };
}

/**
 * Fetches ALL products from Shopify by paginating through the entire catalog.
 * Each product includes its collection memberships.
 */
export async function fetchAllProducts(): Promise<MeiliProductDocument[]> {
  const allProducts: MeiliProductDocument[] = [];
  let hasNextPage = true;
  let after: string | undefined;

  while (hasNextPage) {
    const client = await createGraphqlClient();
    const response = await client.request<SyncGraphQLProductsResponse>(SYNC_PRODUCTS_QUERY, {
      variables: { first: 50, after },
    });

    const productsData = response.data?.products;
    if (!productsData) {
      throw new Error('Failed to fetch products for Meilisearch sync');
    }

    const products = productsData.edges.map(
      (edge: SyncGraphQLProductEdge) => transformProduct(edge.node)
    );
    allProducts.push(...products);

    hasNextPage = productsData.pageInfo.hasNextPage;
    after = productsData.pageInfo.endCursor || undefined;
  }

  return allProducts;
}

/**
 * Syncs all products to Meilisearch.
 * Uses addDocuments which performs an upsert -- documents with the same
 * primary key are replaced, preventing duplicates.
 */
export async function syncProductsToMeilisearch(): Promise<void> {
  console.log('Starting Meilisearch product sync...');

  const products = await fetchAllProducts();
  const meili = getMeilisearch();
  const index = meili.index(PRODUCTS_INDEX);

  // addDocuments with a primary key performs an upsert:
  // existing documents with the same ID are replaced, new ones are added.
  // This prevents duplicates across cron runs.
  const task = await index.addDocuments(products);

  console.log(
    `Meilisearch sync enqueued: ${products.length} products (task UID: ${task.taskUid})`
  );
}

let scheduledTask: ScheduledTask | null = null;

/**
 * Starts the product sync cron job.
 * Runs every hour at minute 0. Also runs an initial sync immediately.
 */
export function startProductSyncCron(): void {
  // Run an initial sync immediately
  syncProductsToMeilisearch().catch((error: unknown) => {
    console.error('Initial Meilisearch product sync failed:', error);
  });

  // Schedule hourly sync (at minute 0 of every hour)
  scheduledTask = cron.schedule('0 * * * *', () => {
    syncProductsToMeilisearch().catch((error: unknown) => {
      console.error('Scheduled Meilisearch product sync failed:', error);
    });
  });

  console.log('Product sync cron job scheduled (every hour)');
}

/**
 * Stops the product sync cron job. Useful for graceful shutdown.
 */
export function stopProductSyncCron(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('Product sync cron job stopped');
  }
}
