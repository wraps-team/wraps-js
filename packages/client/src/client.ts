import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './schema.d.ts';

export interface TrackOptions {
  /** Contact ID */
  contactId?: string;
  /** Contact email (alternative to contactId) */
  contactEmail?: string;
  /** Contact externalId (alternative to contactId/contactEmail) */
  contactExternalId?: string;
  /** Contact name (used when createIfMissing is true) */
  contactName?: string;
  /** If true and contact doesn't exist, create a new contact */
  createIfMissing?: boolean;
  /** Event properties */
  properties?: Record<string, unknown>;
}

export interface TrackResult {
  success: boolean;
  /** Whether a new contact was created */
  contactCreated: boolean;
  /** Number of workflows triggered */
  workflowsTriggered: number;
  /** Number of executions resumed */
  executionsResumed: number;
}

export interface BatchTrackEvent {
  /** Event name (e.g., 'purchase.completed') */
  name: string;
  /** Contact ID */
  contactId?: string;
  /** Contact email (alternative to contactId) */
  contactEmail?: string;
  /** Contact externalId (alternative to contactId/contactEmail) */
  contactExternalId?: string;
  /** Event properties */
  properties?: Record<string, unknown>;
}

export interface BatchTrackResult {
  success: boolean;
  /** Number of events processed */
  processed: number;
  /** Total workflows triggered */
  workflowsTriggered: number;
  /** Total executions resumed */
  executionsResumed: number;
  /** Error messages if any */
  errors: string[];
}

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

  /**
   * Track a single event for a contact.
   *
   * @param name - Event name (e.g., 'purchase.completed')
   * @param options - Contact identifiers and event properties
   * @returns Result including workflowsTriggered, contactCreated, etc.
   * @throws {Error} If the API returns an error
   *
   * @example
   * ```ts
   * const result = await client.track('purchase.completed', {
   *   contactEmail: 'alice@example.com',
   *   properties: { orderId: 'ord_123', amount: 99 },
   * });
   * ```
   */
  async function track(name: string, options?: TrackOptions): Promise<TrackResult> {
    const { data, error } = await client.POST('/v1/events/', {
      body: {
        name,
        ...options,
      },
    });

    if (error) {
      throw new Error('error' in error ? error.error : 'Unknown error');
    }

    return data;
  }

  /**
   * Track multiple events in a single batch request.
   *
   * @param events - Array of events to track
   * @returns Batch result including processed count and any errors
   * @throws {Error} If the API returns an error
   *
   * @example
   * ```ts
   * const result = await client.trackBatch([
   *   { name: 'page.viewed', contactEmail: 'alice@example.com', properties: { page: '/pricing' } },
   *   { name: 'feature.used', contactId: 'con_abc', properties: { feature: 'api-keys' } },
   * ]);
   * ```
   */
  async function trackBatch(events: BatchTrackEvent[]): Promise<BatchTrackResult> {
    const { data, error } = await client.POST('/v1/events/batch', {
      body: { events },
    });

    if (error) {
      throw new Error(((error as Record<string, unknown>).error as string) ?? 'Unknown error');
    }

    return data;
  }

  return Object.assign(client, { track, trackBatch });
}

export type PlatformClient = ReturnType<typeof createPlatformClient>;
