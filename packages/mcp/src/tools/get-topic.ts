import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';

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

const GetTopicInput = {
  id: z.string().max(36).describe('The topic id, from list_topics.'),
};

/**
 * Read one subscription topic by id. Read-only. Calls `GET /v1/topics/:id`, which returns a
 * single record and is not paginated.
 */
export function registerGetTopic(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_topic',
    {
      description:
        'Get one subscription topic by id, with its audience counts (subscriberCount, sendableCount, pendingCount) and its creator. Use it after list_topics has given you the id, or to read a topic before update_topic or delete_topic. Returns a single record: pagination does not apply, and nothing is truncated (hasMore is never set). A 404 means no topic with that id exists in this organization. Requires a Pro plan or higher.',
      inputSchema: GetTopicInput,
      outputSchema: TopicRecord,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<z.infer<typeof TopicRecord>>(credential.api, {
        method: 'GET',
        path: `/v1/topics/${seg(input.id)}`,
      });
      if (!result.ok) {
        return result.error;
      }
      const topic = result.data;
      return textResult(
        `Topic "${topic.name}" (${topic.id}): ${topic.subscriberCount} subscribed, ${topic.sendableCount} sendable, ${topic.pendingCount} pending.`,
        topic
      );
    }
  );
}
