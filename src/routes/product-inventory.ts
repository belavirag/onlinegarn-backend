import { Router, Request, Response } from 'express';
import { createGraphqlClient } from '../services/shopify';
import { NotFoundError, AppError } from '../errors';
import { buildCacheKey, getCached } from '../services/cache';

const router = Router();

// Types matching Shopify Admin GraphQL API response structure
interface GraphQLQuantity {
  name: string;
  quantity: number;
}

interface GraphQLLocation {
  id: string;
  name: string;
}

interface GraphQLInventoryLevel {
  id: string;
  location: GraphQLLocation;
  quantities: GraphQLQuantity[];
}

interface GraphQLInventoryLevelEdge {
  node: GraphQLInventoryLevel;
}

interface GraphQLInventoryItem {
  id: string;
  inventoryLevels: {
    edges: GraphQLInventoryLevelEdge[];
  };
}

interface GraphQLProductVariant {
  id: string;
  title: string;
  inventoryItem: GraphQLInventoryItem;
}

interface GraphQLVariantEdge {
  node: GraphQLProductVariant;
}

interface GraphQLProduct {
  id: string;
  title: string;
  variants: {
    edges: GraphQLVariantEdge[];
  };
}

interface GraphQLResponse {
  product?: GraphQLProduct;
}

// Simplified types for API response
interface InventoryLevel {
  id: string;
  locationName: string;
  available: number;
}

interface VariantInventory {
  id: string;
  title: string;
  inventoryLevels: InventoryLevel[];
}

interface ProductInventory {
  id: string;
  title: string;
  variants: VariantInventory[];
}

const PRODUCT_AVAILABLE_INVENTORY_QUERY = `
  query ProductAvailableInventory($productId: ID!) {
    product(id: $productId) {
      id
      title
      variants(first: 50) {
        edges {
          node {
            id
            title
            inventoryItem {
              id
              inventoryLevels(first: 10) {
                edges {
                  node {
                    id
                    location {
                      id
                      name
                    }
                    quantities(names: ["available"]) {
                      name
                      quantity
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
` as const;

export async function fetchProductInventory(productId: string): Promise<ProductInventory> {
  const client = createGraphqlClient();
  const response = await client.request<GraphQLResponse>(PRODUCT_AVAILABLE_INVENTORY_QUERY, {
    variables: { productId },
  });

  const product = response.data?.product;

  if (!product) {
    throw new NotFoundError('Product not found');
  }

  return {
    id: product.id,
    title: product.title,
    variants: product.variants.edges.map((variantEdge: GraphQLVariantEdge) => ({
      id: variantEdge.node.id,
      title: variantEdge.node.title,
      inventoryLevels: variantEdge.node.inventoryItem?.inventoryLevels.edges.map((levelEdge: GraphQLInventoryLevelEdge) => ({
        id: levelEdge.node.id,
        locationName: levelEdge.node.location?.name || 'Unknown',
        available: levelEdge.node.quantities?.find((q: GraphQLQuantity) => q.name === 'available')?.quantity ?? 0,
      })) || [],
    })),
  };
}

router.get('/products/:productId/inventory', async (req: Request<{ productId: string }>, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;
    const gid = productId.startsWith('gid://') ? productId : `gid://shopify/Product/${productId}`;
    const cacheKey = buildCacheKey('product-inventory', { productId: gid });
    const result = await getCached(cacheKey, () => fetchProductInventory(gid));
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching product inventory:', error);
    if (error instanceof AppError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch product inventory' });
  }
});

export default router;
