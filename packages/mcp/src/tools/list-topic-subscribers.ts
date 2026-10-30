import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';

const SubscriberRecord = z.object({
  id: z.string().describe('The contact id. Same value as contactId.'),
  contactId: z.string(),
  email: z.string(),
  status: z.string(),
  subscribedAt: z.string().nullable(),
  unsubscribedAt: z.string().nullable(),
});

const SubscriberPage = z.object({
  subscribers: z.array(SubscriberRecord),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  hasMore: z.boolean(),
  nextPage: z.number().nullable(),
});

const ListTopicSubscribersInput = {
  id: z.string().max(36).describe('The topic id, from list_topics.'),
  page: z.number().int().min(1).optional().describe('Page number, starting at 1. Default 1.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Subscribers per page, 1 to 100. Default 50.'),
  status: z
    .enum(['subscribed', 'pending', 'unsubscribed'])
    .optional()
    .describe(
      'Filter by subscription status. pending covers double opt-in contacts who have not confirmed yet.'
    ),
};

/**
 * List one topic's subscribers, page by page. Read-only. Calls
 * `GET /v1/topics/:id/subscribers` with `page`, `pageSize` and `status`.
 */
export function registerListTopicSubscribers(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_topic_subscribers',
    {
      description:
        'List the contacts subscribed to one topic, filtered by status (subscribed, pending for double opt-in not yet confirmed, or unsubscribed). Use list_topics or get_topic for the topic itself. Pagination: page-based. Call with page 1 (the default); while hasMore is true, call again with page set to nextPage, keeping the same pageSize and status. Each page holds up to pageSize rows (1 to 100, default 50). Truncation: a page is capped at pageSize, and hasMore is true while later pages exist. A result with hasMore false is the last page; a partial list is not proof that a contact is absent, so check total. Requires a Pro plan or higher.',
      inputSchema: ListTopicSubscribersInput,
      outputSchema: SubscriberPage,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<{
        subscribers: z.infer<typeof SubscriberRecord>[];
        total: number;
        page: number;
        pageSize: number;
      }>(credential.api, {
        method: 'GET',
        path: `/v1/topics/${seg(input.id)}/subscribers`,
        query: {
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
        },
      });
      if (!result.ok) {
        return result.error;
      }
      const { total, page, pageSize } = result.data;
      const subscribers = (result.data.subscribers ?? []).map((s) => ({ ...s, id: s.contactId }));
      const hasMore = page * pageSize < total;
      const shown = subscribers.length;
      return textResult(
        `Showing ${shown} of ${total} subscriber${total === 1 ? '' : 's'} (page ${page}).${
          hasMore ? ` More pages exist: call again with page ${page + 1}.` : ''
        }`,
        {
          subscribers,
          total,
          page,
          pageSize,
          hasMore,
          nextPage: hasMore ? page + 1 : null,
        }
      );
    }
  );
}
