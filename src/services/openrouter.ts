let openrouterModule: typeof import('@openrouter/sdk') | null = null;

async function getOpenRouterModule(): Promise<typeof import('@openrouter/sdk')> {
  if (!openrouterModule) {
    openrouterModule = await import('@openrouter/sdk');
  }
  return openrouterModule;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

let clientInstance: import('@openrouter/sdk').OpenRouter | null = null;

export async function getOpenRouterClient(): Promise<import('@openrouter/sdk').OpenRouter> {
  if (!clientInstance) {
    const apiKey = getRequiredEnv('OPENROUTER_API_KEY');
    const { OpenRouter } = await getOpenRouterModule();
    clientInstance = new OpenRouter({ apiKey });
  }
  return clientInstance;
}
