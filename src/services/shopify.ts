import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import redis from './redis';

let shopify: ReturnType<typeof shopifyApi> | null = null;

export async function initShopify(): Promise<void> {
  const oauthData = await redis.get('oauth');
  if (!oauthData) {
    throw new Error('OAuth token not found in Redis');
  }

  const { access_token: accessToken } = JSON.parse(oauthData);

  const apiVersion: ApiVersion = (process.env.SHOPIFY_API_VERSION as ApiVersion) || '2025-01';

  shopify = shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY!,
    apiSecretKey: process.env.SHOPIFY_API_SECRET!,
    adminApiAccessToken: accessToken,
    hostName: process.env.SHOPIFY_APP_URL!.replace(/https?:\/\//, ''),
    apiVersion,
    scopes: [],
    isEmbeddedApp: false,
  });
}

export function getShopify() {
  if (!shopify) {
    throw new Error('Shopify API not initialized. Call initShopify() first.');
  }
  return shopify;
}
