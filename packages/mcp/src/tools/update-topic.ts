import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
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

const UpdateTopicInput = {
  id: z.string().max(36).describe('The topic id, from list_topics.'),
  name: z.string().min(1).max(200).optional().describe('New display name.'),
  slug: z.string().min(1).max(200).optional().describe('New slug. Unique per organization.'),
  description: z.string().nullable().optional().describe('New description. Pass null to clear it.'),
  public: z.boolean().optional().describe('Whether the topic is shown on the preference center.'),
  doubleOptIn: z
    .boolean()
    .optional()
    .describe('Whether new subscribers must confirm before they count as subscribed.'),
};

/**
 * Partially update a subscription topic. Mutating but reversible, so it is a W tool: it needs
 * `WRAPS_WRITE_ENABLED=true`. Calls `PATCH /v1/topics/:id` with only the fields passed.
 */
export function registerUpdateTopic(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'update_topic',
    {
      description:
        "Change a subscription topic's name, slug, description, public flag or double opt-in setting. Only the fields you pass are changed; read the topic with get_topic first if you need its current values. Needs WRAPS_WRITE_ENABLED=true. Returns a single record: pagination does not apply, and nothing is truncated (hasMore is never set). A 409 means the slug is already used by another topic in this organization. Requires a Pro plan or higher.",
      inputSchema: UpdateTopicInput,
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
      const { id, ...fields } = input;
      const result = await apiRequest<z.infer<typeof TopicRecord>>(credential.api, {
        method: 'PATCH',
        path: `/v1/topics/${seg(id)}`,
        body: fields,
      });
      if (!result.ok) {
        return result.error;
      }
      const topic = result.data;
      return textResult(`Updated topic "${topic.name}" (${topic.id}).`, topic);
    }
  );
}
