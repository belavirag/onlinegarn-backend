import '@shopify/shopify-api/adapters/node';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import redis from './redis';

let shopify: ReturnType<typeof shopifyApi> | null = null;
let cachedToken: string | null = null;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function createShopifyInstance(token: string): Promise<ReturnType<typeof shopifyApi>> {
  const apiVersion: ApiVersion =
    (process.env.SHOPIFY_API_VERSION as ApiVersion) || ApiVersion.April25;

  const apiKey = getRequiredEnv('SHOPIFY_API_KEY');
  const apiSecretKey = getRequiredEnv('SHOPIFY_API_SECRET');
  const appUrl = getRequiredEnv('SHOPIFY_APP_URL');

  return shopifyApi({
    apiKey,
    apiSecretKey,
    adminApiAccessToken: token,
    hostName: appUrl.replace(/https?:\/\//, ''),
    apiVersion,
    scopes: [],
    isEmbeddedApp: false,
  });
}

export async function initShopify(): Promise<void> {
  const token = await getAdminAccessToken();
  shopify = await createShopifyInstance(token);
  cachedToken = token;
}

export function getShopify(): ReturnType<typeof shopifyApi> {
  if (!shopify) {
    throw new Error('Shopify API not initialized. Call initShopify() first.');
  }
  return shopify;
}

export async function getAdminAccessToken(): Promise<string> {
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

  return (parsed as { access_token: string }).access_token;
}

/**
 * Creates a Shopify GraphQL client with the admin access token.
 * Re-initializes the Shopify instance if the token has changed.
 */
export async function createGraphqlClient(): Promise<InstanceType<ReturnType<typeof shopifyApi>['clients']['Graphql']>> {
  const accessToken = await getAdminAccessToken();

  if (!shopify || cachedToken !== accessToken) {
    shopify = await createShopifyInstance(accessToken);
    cachedToken = accessToken;
  }

  const session = shopify.session.customAppSession(
    process.env.SHOPIFY_SHOP_DOMAIN || 'unknown.myshopify.com'
  );
  session.accessToken = accessToken;

  return new shopify.clients.Graphql({ session });
}
