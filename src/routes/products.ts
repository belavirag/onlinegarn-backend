import { Router, Request, Response } from 'express';
import { createGraphqlClient, refreshAccessToken } from '../services/shopify';
import { buildCacheKey, getCached } from '../services/cache';

const router = Router();

// Types matching Shopify Admin GraphQL API response structure
interface GraphQLImage {
  url: string;
  altText: string | null;
}

interface GraphQLMediaImage {
  __typename: 'MediaImage';
  image: GraphQLImage;
}

interface GraphQLMediaNode {
  __typename: string;
  image?: GraphQLImage;
}

interface GraphQLMediaEdge {
  node: GraphQLMediaNode;
}

interface GraphQLMoney {
  amount: string;
  currencyCode: string;
}

interface GraphQLSelectedOption {
  name: string;
  value: string;
}

interface GraphQLVariant {
  id: string;
  title: string;
  price: string;
  media: {
    edges: GraphQLMediaEdge[];
  };
  inventoryQuantity: number;
  selectedOptions: GraphQLSelectedOption[];
}

interface GraphQLVariantEdge {
  node: GraphQLVariant;
}

interface GraphQLOption {
  name: string;
  values: string[];
}

interface GraphQLProduct {
  id: string;
  title: string;
  description: string;
  descriptionHtml: string;
  handle: string;
  priceRangeV2: {
    minVariantPrice: GraphQLMoney;
  };
  media: {
    edges: GraphQLMediaEdge[];
  };
  variants: {
    edges: GraphQLVariantEdge[];
  };
  options: GraphQLOption[];
}

interface GraphQLProductEdge {
  node: GraphQLProduct;
}

interface GraphQLPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GraphQLProductsResponse {
  products: {
    pageInfo: GraphQLPageInfo;
    edges: GraphQLProductEdge[];
  };
}

// Simplified types for API response
interface ProductImage {
  url: string;
  altText: string | null;
}

interface ProductVariant {
  id: string;
  title: string;
  price: string;
  image: ProductImage | null;
  inventoryQuantity: number;
  selectedOptions: GraphQLSelectedOption[];
}

interface Product {
  id: string;
  title: string;
  description: string;
  descriptionHtml: string;
  handle: string;
  minPrice: GraphQLMoney;
  images: ProductImage[];
  variants: ProductVariant[];
  options: GraphQLOption[];
}

interface ProductsListResponse {
  products: Product[];
  pageInfo: GraphQLPageInfo;
}

const ADMIN_PRODUCTS_QUERY = `
  query AdminProducts($first: Int!, $after: String) {
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
          media(first: 50) {
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
          variants(first: 10) {
            edges {
              node {
                id
                title
                price
                media(first: 1) {
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
        }
      }
    }
  }
` as const;

function extractImagesFromMedia(edges: GraphQLMediaEdge[]): ProductImage[] {
  return edges
    .filter((edge: GraphQLMediaEdge): edge is { node: GraphQLMediaImage } => edge.node.__typename === 'MediaImage')
    .map((edge: { node: GraphQLMediaImage }) => ({
      url: edge.node.image.url,
      altText: edge.node.image.altText,
    }));
}

export async function fetchProducts(first: number, after?: string): Promise<ProductsListResponse> {
  await refreshAccessToken();
  const client = createGraphqlClient();
  const response = await client.request<GraphQLProductsResponse>(ADMIN_PRODUCTS_QUERY, {
    variables: { first, after },
  });

  const productsData = response.data?.products;

  if (!productsData) {
    throw new Error('Failed to fetch products');
  }

  return {
    products: productsData.edges.map((edge: GraphQLProductEdge) => {
      const variantImages = extractImagesFromMedia(edge.node.media.edges);

      return {
        id: edge.node.id,
        title: edge.node.title,
        description: edge.node.description,
        descriptionHtml: edge.node.descriptionHtml,
        handle: edge.node.handle,
        minPrice: edge.node.priceRangeV2.minVariantPrice,
        images: variantImages,
        variants: edge.node.variants.edges.map((varEdge: GraphQLVariantEdge) => {
          const variantImage = extractImagesFromMedia(varEdge.node.media.edges);
          return {
            id: varEdge.node.id,
            title: varEdge.node.title,
            price: varEdge.node.price,
            image: variantImage.length > 0 ? variantImage[0] : null,
            inventoryQuantity: varEdge.node.inventoryQuantity,
            selectedOptions: varEdge.node.selectedOptions,
          };
        }),
        options: edge.node.options,
      };
    }),
    pageInfo: productsData.pageInfo,
  };
}

router.get('/products', async (req: Request, res: Response): Promise<void> => {
  try {
    const first = Math.min(Math.max(parseInt(req.query.first as string) || 12, 1), 50);
    const after = req.query.after as string | undefined;

    const cacheKey = buildCacheKey('products', { first, after });
    const result = await getCached(cacheKey, () => fetchProducts(first, after));
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

export default router;
