import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import redis from './redis';

let shopify: ReturnType<typeof shopifyApi> | null = null;
let adminAccessToken: string | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function initShopify(): Promise<void> {
  const oauthData = await redis.get('oauth');
  if (!oauthData) {
    throw new Error('OAuth token not found in Redis');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(oauthData);
  } catch {
    throw new Error('Failed to parse OAuth data from Redis: invalid JSON');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('access_token' in parsed) ||
    typeof (parsed as Record<string, unknown>).access_token !== 'string'
  ) {
    throw new Error('Invalid OAuth data in Redis: missing or invalid "access_token" field');
  }

  adminAccessToken = (parsed as { access_token: string }).access_token;

  const apiVersion: ApiVersion =
    (process.env.SHOPIFY_API_VERSION as ApiVersion) || ApiVersion.April25;

  const apiKey = getRequiredEnv('SHOPIFY_API_KEY');
  const apiSecretKey = getRequiredEnv('SHOPIFY_API_SECRET');
  const appUrl = getRequiredEnv('SHOPIFY_APP_URL');

  shopify = shopifyApi({
    apiKey,
    apiSecretKey,
    adminApiAccessToken: adminAccessToken,
    hostName: appUrl.replace(/https?:\/\//, ''),
    apiVersion,
    scopes: [],
    isEmbeddedApp: false,
  });
}

export function getShopify(): ReturnType<typeof shopifyApi> {
  if (!shopify) {
    throw new Error('Shopify API not initialized. Call initShopify() first.');
  }
  return shopify;
}

export function getAdminAccessToken(): string {
  if (!adminAccessToken) {
    throw new Error('Admin access token not available. Call initShopify() first.');
  }
  return adminAccessToken;
}

/**
 * Creates a Shopify GraphQL client with the admin access token.
 * Extracts the duplicated session/client creation pattern from route handlers.
 */
export function createGraphqlClient(): InstanceType<ReturnType<typeof shopifyApi>['clients']['Graphql']> {
  const shop = getShopify();
  const accessToken = getAdminAccessToken();

  const session = shop.session.customAppSession(
    process.env.SHOPIFY_SHOP_DOMAIN || 'unknown.myshopify.com'
  );
  session.accessToken = accessToken;

  return new shop.clients.Graphql({ session });
}
