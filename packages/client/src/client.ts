import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema.d.ts';

export interface WrapsPlatformConfig {
  /** API key for authentication */
  apiKey: string;
  /** Base URL for the API (defaults to https://api.wraps.dev) */
  baseUrl?: string;
}

/**
 * Creates a type-safe API client for the Wraps Platform.
 *
 * @example
 * ```ts
 * const client = createPlatformClient({
 *   apiKey: 'your-api-key',
 * });
 *
 * // List contacts with type safety
 * const { data, error } = await client.GET('/v1/contacts/', {
 *   params: {
 *     query: { page: '1', pageSize: '10' },
 *   },
 * });
 *
 * // Create a contact
 * const { data, error } = await client.POST('/v1/contacts/', {
 *   body: {
 *     email: 'user@example.com',
 *     emailStatus: 'active',
 *   },
 * });
 * ```
 */
export function createPlatformClient(config: WrapsPlatformConfig) {
  const { apiKey, baseUrl = 'https://api.wraps.dev' } = config;

  const authMiddleware: Middleware = {
    async onRequest({ request }) {
      request.headers.set('Authorization', `Bearer ${apiKey}`);
      return request;
    },
  };

  const client = createClient<paths>({
    baseUrl,
  });

  client.use(authMiddleware);

  return client;
}

export type PlatformClient = ReturnType<typeof createPlatformClient>;
