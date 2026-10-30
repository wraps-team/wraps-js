import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const GetBroadcastInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('Broadcast id, from list_broadcasts or create/duplicate results.'),
};

const GetBroadcastOutputSchema = {
  id: z.string(),
  name: z.string().nullable(),
  status: z
    .string()
    .describe('draft, scheduled, queued, processing, completed, failed or cancelled.'),
  channel: z.string(),
  totalRecipients: z.number(),
  processedRecipients: z.number(),
  sent: z.number(),
  delivered: z.number(),
  failed: z.number(),
  opened: z.number(),
  clicked: z.number(),
  bounced: z.number(),
  complained: z.number(),
  suppressed: z.number(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
};

interface ApiBroadcast {
  id: string;
  status: string;
  channel: string;
  name: string | null;
  totalRecipients: number;
  processedRecipients: number;
  sent: number;
  delivered: number;
  failed: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  suppressed: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export function registerGetBroadcast(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_broadcast',
    {
      description:
        'Get the status and delivery counts of ONE broadcast by id. Use this after list_broadcasts when you need the current status, the counts, or the totalRecipients to pass to send_broadcast. It returns a single record, not a paginated list. The result is never truncated: every count is returned in full. Counts are updated as SES events arrive, so they can lag right after a send.',
      inputSchema: GetBroadcastInputSchema,
      outputSchema: GetBroadcastOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<ApiBroadcast>(resolved.api, {
        method: 'GET',
        path: `/v1/batch/${seg(input.id)}`,
      });
      if (!result.ok) {
        return result.error;
      }
      const b = result.data;
      return textResult(
        `Broadcast ${b.id} (${b.name ?? 'unnamed'}) is ${b.status} on ${b.channel}: ${b.sent} sent, ${b.delivered} delivered, ${b.failed} failed out of ${b.totalRecipients} recipients.`,
        {
          id: b.id,
          name: b.name,
          status: b.status,
          channel: b.channel,
          totalRecipients: b.totalRecipients,
          processedRecipients: b.processedRecipients,
          sent: b.sent,
          delivered: b.delivered,
          failed: b.failed,
          opened: b.opened,
          clicked: b.clicked,
          bounced: b.bounced,
          complained: b.complained,
          suppressed: b.suppressed,
          startedAt: b.startedAt,
          completedAt: b.completedAt,
          createdAt: b.createdAt,
        }
      );
    }
  );
}
