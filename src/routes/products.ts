import { Router, Request, Response } from 'express';
import { createGraphqlClient } from '../services/shopify';

const router = Router();

// Types matching Shopify Admin GraphQL API response structure
interface GraphQLImage {
  url: string;
  altText: string | null;
}

interface GraphQLImageEdge {
  node: GraphQLImage;
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
  image: GraphQLImage | null;
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
  images: {
    edges: GraphQLImageEdge[];
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
          images(first: 5) {
            edges {
              node {
                url
                altText
              }
            }
          }
          variants(first: 10) {
            edges {
              node {
                id
                title
                price
                image {
                  url
                  altText
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

export async function fetchProducts(first: number, after?: string): Promise<ProductsListResponse> {
  const client = createGraphqlClient();
  const response = await client.request<GraphQLProductsResponse>(ADMIN_PRODUCTS_QUERY, {
    variables: { first, after },
  });

  const productsData = response.data?.products;

  if (!productsData) {
    throw new Error('Failed to fetch products');
  }

  return {
    products: productsData.edges.map((edge: GraphQLProductEdge) => ({
      id: edge.node.id,
      title: edge.node.title,
      description: edge.node.description,
      descriptionHtml: edge.node.descriptionHtml,
      handle: edge.node.handle,
      minPrice: edge.node.priceRangeV2.minVariantPrice,
      images: edge.node.images.edges.map((imgEdge: GraphQLImageEdge) => ({
        url: imgEdge.node.url,
        altText: imgEdge.node.altText,
      })),
      variants: edge.node.variants.edges.map((varEdge: GraphQLVariantEdge) => ({
        id: varEdge.node.id,
        title: varEdge.node.title,
        price: varEdge.node.price,
        image: varEdge.node.image,
        inventoryQuantity: varEdge.node.inventoryQuantity,
        selectedOptions: varEdge.node.selectedOptions,
      })),
      options: edge.node.options,
    })),
    pageInfo: productsData.pageInfo,
  };
}

router.get('/products', async (req: Request, res: Response): Promise<void> => {
  try {
    const first = Math.min(Math.max(parseInt(req.query.first as string) || 12, 1), 50);
    const after = req.query.after as string | undefined;

    const result = await fetchProducts(first, after);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

export default router;
