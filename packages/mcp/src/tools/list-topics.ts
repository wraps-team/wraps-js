import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
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

const ListTopicsOutput = z.object({
  topics: z.array(TopicRecord),
});

/**
 * List every subscription topic in the organization, with its audience counts. Read-only.
 * Calls `GET /v1/topics`, which is not paginated and is not truncated.
 */
export function registerListTopics(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_topics',
    {
      description:
        "List the organization's subscription topics with live audience counts: subscriberCount (opted in), sendableCount (a broadcast would reach now) and pendingCount (waiting on double opt-in). Use this to find a topic id for get_topic, list_topic_subscribers, update_topic or delete_topic, or to check whether a topic already exists before create_topic. Pagination: none. The route returns every topic in one response, so there is no cursor to pass. Truncation: nothing is cut and hasMore is never set, so a short list is complete. Requires a Pro plan or higher.",
      inputSchema: {},
      outputSchema: ListTopicsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<z.infer<typeof ListTopicsOutput>>(credential.api, {
        method: 'GET',
        path: '/v1/topics',
      });
      if (!result.ok) {
        return result.error;
      }
      const topics = result.data.topics ?? [];
      return textResult(`Found ${topics.length} topic${topics.length === 1 ? '' : 's'}.`, {
        topics,
      });
    }
  );
}
