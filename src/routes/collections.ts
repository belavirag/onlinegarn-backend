import { Router, Request, Response } from 'express';
import { createGraphqlClient } from '../services/shopify';
import { buildCacheKey, getCached } from '../services/cache';
import { AppError, NotFoundError } from '../errors';

const router = Router();

// Types matching Shopify Admin GraphQL API response structure
interface GraphQLCollection {
  id: string;
  title: string;
  handle: string;
  description: string;
  descriptionHtml: string;
  image?: {
    url: string;
    altText: string | null;
  } | null;
}

interface GraphQLCollectionEdge {
  node: GraphQLCollection;
}

interface GraphQLPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GraphQLCollectionsResponse {
  collections: {
    pageInfo: GraphQLPageInfo;
    edges: GraphQLCollectionEdge[];
  };
}

interface GraphQLProduct {
  id: string;
  title: string;
  description: string;
  descriptionHtml: string;
  handle: string;
  priceRangeV2: {
    minVariantPrice: {
      amount: string;
      currencyCode: string;
    };
  };
  featuredImage?: {
    url: string;
    altText: string | null;
  } | null;
}

interface GraphQLProductEdge {
  node: GraphQLProduct;
}

interface GraphQLCollectionByHandleResponse {
  collectionByHandle?: {
    id: string;
    title: string;
    handle: string;
    description: string;
    descriptionHtml: string;
    image?: {
      url: string;
      altText: string | null;
    } | null;
    products: {
      pageInfo: GraphQLPageInfo;
      edges: GraphQLProductEdge[];
    };
  } | null;
}

// Simplified types for API response
interface Collection {
  id: string;
  title: string;
  handle: string;
  description: string;
  descriptionHtml: string;
  image: {
    url: string;
    altText: string | null;
  } | null;
}

interface CollectionsListResponse {
  collections: Collection[];
  pageInfo: GraphQLPageInfo;
}

interface ProductSummary {
  id: string;
  title: string;
  description: string;
  descriptionHtml: string;
  handle: string;
  minPrice: {
    amount: string;
    currencyCode: string;
  };
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
}

interface CollectionProductsResponse {
  collection: Collection;
  products: ProductSummary[];
  pageInfo: GraphQLPageInfo;
}

const ADMIN_COLLECTIONS_QUERY = `
  query AdminCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          description
          descriptionHtml
          image {
            url
            altText
          }
        }
      }
    }
  }
` as const;

const COLLECTION_PRODUCTS_QUERY = `
  query CollectionProducts($handle: String!, $first: Int!, $after: String) {
    collectionByHandle(handle: $handle) {
      id
      title
      handle
      description
      descriptionHtml
      image {
        url
        altText
      }
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
            descriptionHtml
            handle
            priceRangeV2 {
              minVariantPrice {
                amount
                currencyCode
              }
            }
            featuredImage {
              url
              altText
            }
          }
        }
      }
    }
  }
` as const;

export async function fetchCollections(first: number, after?: string): Promise<CollectionsListResponse> {
  const client = await createGraphqlClient();
  const response = await client.request<GraphQLCollectionsResponse>(ADMIN_COLLECTIONS_QUERY, {
    variables: { first, after },
  });

  const collectionsData = response.data?.collections;

  if (!collectionsData) {
    throw new Error('Failed to fetch collections');
  }

  return {
    collections: collectionsData.edges.map((edge: GraphQLCollectionEdge) => ({
      id: edge.node.id,
      title: edge.node.title,
      handle: edge.node.handle,
      description: edge.node.description,
      descriptionHtml: edge.node.descriptionHtml,
      image: edge.node.image
        ? {
            url: edge.node.image.url,
            altText: edge.node.image.altText,
          }
        : null,
    })),
    pageInfo: collectionsData.pageInfo,
  };
}

export async function fetchCollectionProducts(
  handle: string,
  first: number,
  after?: string
): Promise<CollectionProductsResponse> {
  const client = await createGraphqlClient();
  const response = await client.request<GraphQLCollectionByHandleResponse>(COLLECTION_PRODUCTS_QUERY, {
    variables: { handle, first, after },
  });

  const collection = response.data?.collectionByHandle;

  if (!collection) {
    throw new NotFoundError('Collection not found');
  }

  return {
    collection: {
      id: collection.id,
      title: collection.title,
      handle: collection.handle,
      description: collection.description,
      descriptionHtml: collection.descriptionHtml,
      image: collection.image
        ? {
            url: collection.image.url,
            altText: collection.image.altText,
          }
        : null,
    },
    products: collection.products.edges.map((edge: GraphQLProductEdge) => ({
      id: edge.node.id,
      title: edge.node.title,
      description: edge.node.description,
      descriptionHtml: edge.node.descriptionHtml,
      handle: edge.node.handle,
      minPrice: edge.node.priceRangeV2.minVariantPrice,
      featuredImage: edge.node.featuredImage
        ? {
            url: edge.node.featuredImage.url,
            altText: edge.node.featuredImage.altText,
          }
        : null,
    })),
    pageInfo: collection.products.pageInfo,
  };
}

router.get('/collections', async (req: Request, res: Response): Promise<void> => {
  try {
    const first = Math.min(Math.max(parseInt(req.query.first as string) || 12, 1), 50);
    const after = req.query.after as string | undefined;

    const cacheKey = buildCacheKey('collections', { first, after });
    const result = await getCached(cacheKey, () => fetchCollections(first, after));
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching collections:', error);
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch collections' });
  }
});

router.get('/collections/:handle/products', async (req: Request<{ handle: string }>, res: Response): Promise<void> => {
  try {
    const { handle } = req.params;
    const first = Math.min(Math.max(parseInt(req.query.first as string) || 12, 1), 50);
    const after = req.query.after as string | undefined;

    const cacheKey = buildCacheKey('collection-products', { handle, first, after });
    const result = await getCached(cacheKey, () => fetchCollectionProducts(handle, first, after));
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching collection products:', error);
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch collection products' });
  }
});

export default router;
