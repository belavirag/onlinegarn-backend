import { Router, Request, Response } from 'express';
import { getShopify, getAdminAccessToken } from '../services/shopify';

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
  const shopify = getShopify();
  const accessToken = getAdminAccessToken();
  
  // Create session with the admin access token
  const session = shopify.session.customAppSession(
    process.env.SHOPIFY_SHOP_DOMAIN || 'unknown.myshopify.com'
  );
  session.accessToken = accessToken;

  const client = new shopify.clients.Graphql({ session });
  const response = await client.request<GraphQLResponse>(PRODUCT_AVAILABLE_INVENTORY_QUERY, {
    variables: { productId },
  });

  const product = response.data?.product;

  if (!product) {
    throw new Error('Product not found');
  }

  return {
    id: product.id,
    title: product.title,
    variants: product.variants.edges.map((variantEdge) => ({
      id: variantEdge.node.id,
      title: variantEdge.node.title,
      inventoryLevels: variantEdge.node.inventoryItem?.inventoryLevels.edges.map((levelEdge) => ({
        id: levelEdge.node.id,
        locationName: levelEdge.node.location?.name || 'Unknown',
        available: levelEdge.node.quantities?.find(q => q.name === 'available')?.quantity ?? 0,
      })) || [],
    })),
  };
}

router.get('/products/:productId/inventory', async (req: Request, res: Response): Promise<void> => {
  try {
    const { productId } = req.params;

    if (!productId) {
      res.status(400).json({ error: 'Product ID is required' });
      return;
    }

    const result = await fetchProductInventory(productId as string);
    res.status(200).json(result);
  } catch (error) {
    console.error('Error fetching product inventory:', error);
    if (error instanceof Error && error.message === 'Product not found') {
      res.status(404).json({ error: 'Product not found' });
      return;
    }
    res.status(500).json({ error: 'Failed to fetch product inventory' });
  }
});

export default router;
