import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

const ListBroadcastsInputSchema = {
  page: z.number().int().min(1).optional().describe('Page number, starting at 1. Default 1.'),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(`Records per page (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}).`),
  status: z
    .enum(['draft', 'scheduled', 'queued', 'processing', 'completed', 'failed', 'cancelled'])
    .optional()
    .describe('Only broadcasts in this status.'),
  channel: z.enum(['email', 'sms']).optional().describe('Only broadcasts on this channel.'),
  search: z
    .string()
    .max(200)
    .optional()
    .describe('Text to search broadcasts for, applied by the API.'),
};

const BroadcastSummarySchema = z.object({
  id: z
    .string()
    .describe('Broadcast id. Pass it to get_broadcast, list_broadcast_recipients, etc.'),
  name: z.string().nullable(),
  status: z.string(),
  channel: z.string(),
  subject: z.string().nullable(),
  totalRecipients: z.number(),
  processedRecipients: z.number(),
  sent: z.number(),
  delivered: z.number(),
  opened: z.number(),
  clicked: z.number(),
  bounced: z.number(),
  complained: z.number(),
  suppressed: z.number(),
  failed: z.number(),
  scheduledFor: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
  template: z.object({ id: z.string(), name: z.string() }).nullable(),
  awsAccount: z.object({ id: z.string(), name: z.string(), region: z.string() }).nullable(),
});

const ListBroadcastsOutputSchema = {
  broadcasts: z.array(BroadcastSummarySchema),
  page: z.number().describe('The page returned.'),
  pageSize: z.number().describe('Records per page used for this page.'),
  total: z.number().describe('Broadcasts matching the filters across all pages.'),
  hasMore: z
    .boolean()
    .describe('True when another page exists. Call again with page = page + 1 to continue.'),
};

interface ApiBroadcastRow {
  id: string;
  name: string | null;
  status: string;
  channel: string;
  subject: string | null;
  totalRecipients: number;
  processedRecipients: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  suppressed: number;
  failed: number;
  scheduledFor: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  template: { id: string; name: string } | null;
  awsAccount: { id: string; name: string; region: string } | null;
}

interface ApiListResponse {
  data: ApiBroadcastRow[];
  page: number;
  pageSize: number;
  total: number;
}

export function registerListBroadcasts(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_broadcasts',
    {
      description:
        'List broadcasts (email or SMS batch sends) for your organization, with their status and delivery counts. Use this to find a broadcast id, or to see which broadcasts are drafts, scheduled, queued, processing, completed, failed or cancelled. For the full detail of one broadcast, use get_broadcast with its id. Pagination: results are paginated, 20 per page by default (pageSize up to 100). Read hasMore in the result; when it is true, call again with page set to the next page number. Truncation: each page is capped at pageSize, so a single page is not proof that no other broadcast matches; only hasMore = false means this is the last page. Filter with status, channel or search.',
      inputSchema: ListBroadcastsInputSchema,
      outputSchema: ListBroadcastsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const page = input.page ?? 1;
      const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;

      const result = await apiRequest<ApiListResponse>(resolved.api, {
        method: 'GET',
        path: '/v1/batch',
        query: {
          page,
          pageSize,
          status: input.status,
          channel: input.channel,
          search: input.search,
        },
      });
      if (!result.ok) {
        return result.error;
      }

      const { data, total } = result.data;
      const broadcasts = data.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        channel: row.channel,
        subject: row.subject,
        totalRecipients: row.totalRecipients,
        processedRecipients: row.processedRecipients,
        sent: row.sent,
        delivered: row.delivered,
        opened: row.opened,
        clicked: row.clicked,
        bounced: row.bounced,
        complained: row.complained,
        suppressed: row.suppressed,
        failed: row.failed,
        scheduledFor: row.scheduledFor,
        startedAt: row.startedAt,
        completedAt: row.completedAt,
        createdAt: row.createdAt,
        template: row.template,
        awsAccount: row.awsAccount,
      }));
      const hasMore = page * pageSize < total;

      const summary =
        broadcasts.length === 0
          ? `No broadcasts on page ${page}. ${total} match the filters.`
          : `Returned ${broadcasts.length} of ${total} broadcasts (page ${page}).`;
      const next = hasMore
        ? ` More exist: call list_broadcasts again with page ${page + 1} to continue.`
        : ' This is the last page.';

      return textResult(`${summary}${next}`, {
        broadcasts,
        page,
        pageSize,
        total,
        hasMore,
      });
    }
  );
}
