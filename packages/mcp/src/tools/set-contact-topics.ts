import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

interface TopicSubscriptionApi {
  topicId: string;
  topicName: string;
  status: string;
  subscribedAt: string | null;
}

interface SetContactTopicsApiResponse {
  topics: TopicSubscriptionApi[];
  pendingTopics?: string[];
}

const SetContactTopicsInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe(
      'The contact UUID only (not an email or externalId). Get it from list_contacts or get_contact.'
    ),
  topicIds: z
    .array(z.string().max(36))
    .optional()
    .describe('Topic ids the contact should end up subscribed to.'),
  topicSlugs: z
    .array(z.string().max(100))
    .optional()
    .describe('Topic slugs the contact should end up subscribed to. Combined with topicIds.'),
};

const SetContactTopicsOutputSchema = {
  id: z.string().describe('The contact id that was changed.'),
  topics: z
    .array(
      z.object({
        topicId: z.string(),
        topicName: z.string(),
        status: z.string().describe('Subscription status after the replace.'),
        subscribedAt: z.string().nullable(),
      })
    )
    .describe("The contact's full topic list after the replace."),
  pendingTopics: z
    .array(z.string())
    .optional()
    .describe('Topic ids that need double opt-in and are not active until the contact confirms.'),
};

export function registerSetContactTopics(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'set_contact_topics',
    {
      description:
        "REPLACE the full topic subscription list of one contact. Whatever topicIds and topicSlugs you pass become the complete list, and every other subscription is removed. Omitting both, or passing empty lists, removes ALL topic subscriptions from the contact. To add topics and keep the rest, use update_contact instead. Give the contact UUID as id (email and externalId are not accepted here). Pagination does not apply: the response is one contact's topic list. Truncation: nothing is truncated; topics lists the full result. Writes are gated: this needs WRAPS_WRITE_ENABLED=true.",
      inputSchema: SetContactTopicsInputSchema,
      outputSchema: SetContactTopicsOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const gated = requireWrite(config);
      if (gated) {
        return gated;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<SetContactTopicsApiResponse>(resolved.api, {
        method: 'PUT',
        path: `/v1/contacts/${seg(input.id)}/topics`,
        body: { topicIds: input.topicIds, topicSlugs: input.topicSlugs },
      });
      if (!res.ok) {
        return res.error;
      }

      const pending = res.data.pendingTopics ?? [];
      const lines = res.data.topics.map((t) => `- ${t.topicName}: ${t.status}`);
      const head =
        res.data.topics.length === 0
          ? `Contact ${input.id} now has no topic subscriptions.`
          : `Contact ${input.id} now has ${res.data.topics.length} topic subscription(s):`;
      const pendingNote =
        pending.length > 0
          ? `\n${pending.length} topic(s) await the contact's confirmation (pendingTopics).`
          : '';

      return textResult(`${head}\n${lines.join('\n')}${pendingNote}`, {
        id: input.id,
        topics: res.data.topics,
        ...(pending.length > 0 ? { pendingTopics: pending } : {}),
      });
    }
  );
}
