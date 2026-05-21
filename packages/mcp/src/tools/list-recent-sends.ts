import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';

const ListRecentSendsInputSchema = {
  limit: z.number().int().min(1).max(100).optional(),
  since: z.string().datetime({ offset: true }).optional(),
};

export function registerListRecentSends(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_recent_sends',
    {
      description:
        'List recently sent emails from your Wraps email history. Returns send status, subject, recipient, timestamps, and messageId for each send. Use the messageId with get_email_event_log for full delivery details. The `since` parameter accepts a full ISO 8601 datetime string (e.g., 2024-01-01T00:00:00Z).',
      inputSchema: ListRecentSendsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const email = new WrapsEmail({
        region: config.region,
        historyTableName: config.historyTableName,
      });
      try {
        if (!email.events) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Email history table not configured.' }],
          };
        }
        const result = await email.events.list({
          accountId: config.accountId,
          maxResults: input.limit ?? 20,
          startTime: input.since ? new Date(input.since) : undefined,
        });

        const text =
          result.emails.length === 0
            ? 'No recent sends found.'
            : result.emails
                .map(
                  (item) =>
                    `[${item.status}] ${item.subject} → ${item.to.join(', ')} at ${new Date(item.sentAt).toISOString()} (id: ${item.messageId})`
                )
                .join('\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Failed to list sends: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      } finally {
        email.destroy();
      }
    }
  );
}
