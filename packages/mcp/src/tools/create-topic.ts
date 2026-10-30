import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

const TopicRecord = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  public: z.boolean(),
  doubleOptIn: z.boolean(),
  subscriberCount: z.number(),
  sendableCount: z.number(),
  pendingCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.object({ id: z.string(), name: z.string(), email: z.string() }).nullable(),
});

const CreateTopicInput = {
  name: z.string().min(1).max(200).describe('Display name, shown to subscribers.'),
  slug: z
    .string()
    .min(1)
    .max(200)
    .optional()
    .describe('Slug. Generated from the name when omitted. Unique per organization.'),
  description: z.string().optional().describe('Optional description.'),
  public: z.boolean().optional().describe('Whether the topic is shown on the preference center.'),
  doubleOptIn: z
    .boolean()
    .optional()
    .describe('Whether new subscribers must confirm before they count as subscribed.'),
};

/**
 * Create a subscription topic. Mutating but reversible, so it is a W tool: it needs
 * `WRAPS_WRITE_ENABLED=true`. Calls `POST /v1/topics`.
 */
export function registerCreateTopic(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'create_topic',
    {
      description:
        'Create a subscription topic that contacts can subscribe to and broadcasts can target. Use list_topics first to check that a topic with the same name or slug does not already exist. The slug is generated from the name unless you pass one, and slugs are unique per organization. Needs WRAPS_WRITE_ENABLED=true. Returns the single created record: pagination does not apply, and nothing is truncated (hasMore is never set). A 409 means the slug is already taken. Requires a Pro plan or higher.',
      inputSchema: CreateTopicInput,
      outputSchema: TopicRecord,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const writeRefusal = requireWrite(config);
      if (writeRefusal) {
        return writeRefusal;
      }
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<z.infer<typeof TopicRecord>>(credential.api, {
        method: 'POST',
        path: '/v1/topics',
        body: input,
      });
      if (!result.ok) {
        return result.error;
      }
      const topic = result.data;
      return textResult(`Created topic "${topic.name}" (${topic.id}, slug ${topic.slug}).`, topic);
    }
  );
}
