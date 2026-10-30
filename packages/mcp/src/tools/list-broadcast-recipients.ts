import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;

const ListBroadcastRecipientsInputSchema = {
  id: z.string().min(1).max(36).describe('Broadcast id, from list_broadcasts.'),
  status: z
    .enum([
      'pending',
      'queued',
      'sent',
      'delivered',
      'opened',
      'clicked',
      'bounced',
      'complained',
      'suppressed',
      'failed',
      'opted_out',
    ])
    .optional()
    .describe(
      'Only recipients with this outcome. Use failed, bounced or suppressed to find problems.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Recipients per page (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of recipients to skip. Default 0. Pass offset + limit to get the next page.'),
};

const ListBroadcastRecipientsOutputSchema = {
  recipients: z.array(
    z.object({
      id: z.string(),
      recipient: z.string().describe('Email address or phone number.'),
      status: z.string(),
      error: z.string().nullable(),
      bounceType: z.string().nullable(),
      bounceSubType: z.string().nullable(),
      sentAt: z.string().nullable(),
      createdAt: z.string(),
    })
  ),
  limit: z.number(),
  offset: z.number(),
  total: z.number().describe('Recipients matching the status filter across all pages.'),
  hasMore: z
    .boolean()
    .describe(
      'True when more recipients exist. Call again with offset = offset + limit to continue.'
    ),
};

interface ApiRecipientRow {
  id: string;
  recipient: string;
  status: string;
  error: string | null;
  bounceType: string | null;
  bounceSubType: string | null;
  sentAt: string | null;
  createdAt: string;
}

interface ApiRecipientsResponse {
  data: ApiRecipientRow[];
  limit: number;
  offset: number;
  total: number;
}

export function registerListBroadcastRecipients(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_broadcast_recipients',
    {
      description:
        'List the per-recipient outcome of one broadcast: who was sent to, and whether each send was delivered, bounced, suppressed or failed, with the error reason. Use it to find out why specific recipients did not get a broadcast. Pagination: results are paginated with offset and limit (default 50, max 1000 per page). Read hasMore; when it is true, call again with offset = offset + limit. Truncation: each page is capped at limit, so one page is not proof that a recipient is absent; check hasMore. Filter by status to narrow the list.',
      inputSchema: ListBroadcastRecipientsInputSchema,
      outputSchema: ListBroadcastRecipientsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const limit = input.limit ?? DEFAULT_LIMIT;
      const offset = input.offset ?? 0;

      const result = await apiRequest<ApiRecipientsResponse>(resolved.api, {
        method: 'GET',
        path: `/v1/batch/${seg(input.id)}/recipients`,
        query: { status: input.status, limit, offset },
      });
      if (!result.ok) {
        return result.error;
      }

      const { data, total } = result.data;
      const recipients = data.map((row) => ({
        id: row.id,
        recipient: row.recipient,
        status: row.status,
        error: row.error,
        bounceType: row.bounceType,
        bounceSubType: row.bounceSubType,
        sentAt: row.sentAt,
        createdAt: row.createdAt,
      }));
      const hasMore = offset + recipients.length < total;
      const scope = input.status ? ` with status ${input.status}` : '';
      const summary =
        recipients.length === 0
          ? `No recipients${scope} at offset ${offset}. ${total} match in total.`
          : `Returned ${recipients.length} of ${total} recipients${scope} (offset ${offset}).`;
      const next = hasMore
        ? ` More exist: call list_broadcast_recipients again with offset ${offset + limit} to continue.`
        : ' This is the last page.';

      return textResult(`${summary}${next}`, {
        recipients,
        limit,
        offset,
        total,
        hasMore,
      });
    }
  );
}
