import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';
import { requireAws } from '../config.ts';

const DEFAULT_LIMIT = 20;

/**
 * Declared so agents can consume the result without parsing the rendered table.
 * The text block stays the human-readable view; `structuredContent` is the
 * machine one, and every success path must supply it or the SDK rejects the
 * response.
 */
const ListRecentSendsOutputSchema = {
  sends: z.array(
    z.object({
      messageId: z.string().describe('Use with get_email_event_log for full delivery detail.'),
      status: z.string().describe('Latest known send status.'),
      subject: z.string(),
      to: z.array(z.string()).describe('Recipient addresses.'),
      sentAt: z.string().describe('ISO 8601 send time; stable across calls.'),
    })
  ),
  hasMore: z.boolean().describe('True when more sends exist beyond this page.'),
};

const ListRecentSendsInputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe(`Maximum number of messages to return, newest first (default ${DEFAULT_LIMIT}).`),
  since: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('Only messages with activity at or after this ISO 8601 datetime.'),
};

export function registerListRecentSends(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_recent_sends',
    {
      description:
        'List recently sent emails from your Wraps email history, newest first, at most `limit` messages. The timestamp shown is the send time and is stable across calls. Returns send status, subject, recipient, timestamp, and messageId for each send. Use the messageId with get_email_event_log for full delivery details. The `since` parameter accepts a full ISO 8601 datetime string (e.g., 2024-01-01T00:00:00Z).',
      inputSchema: ListRecentSendsInputSchema,
      outputSchema: ListRecentSendsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = await requireAws(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const { region, accountId } = resolved.aws;
      const email = new WrapsEmail({
        region,
        historyTableName: config.historyTableName,
      });
      try {
        if (!email.events) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: 'Email history table not configured.' }],
          };
        }
        const limit = input.limit ?? DEFAULT_LIMIT;
        const result = await email.events.list({
          accountId: accountId,
          maxResults: limit,
          startTime: input.since ? new Date(input.since) : undefined,
        });

        if (result.emails.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No recent sends found.' }],
            structuredContent: { sends: [], hasMore: false },
          };
        }

        // The SDK already bounds and orders this, but the tool advertises the
        // contract, so it enforces it rather than trusting its dependency.
        const emails = [...result.emails].sort((a, b) => b.sentAt - a.sentAt).slice(0, limit);

        const rows = emails.map(
          (item) =>
            `[${item.status}] ${item.subject} → ${item.to.join(', ')} at ${new Date(item.sentAt).toISOString()} (id: ${item.messageId})`
        );

        const footer = result.nextToken
          ? `\n\nShowing ${emails.length} sends (more exist). Raise limit or pass since to narrow the range.`
          : `\n\nShowing all ${emails.length} matching sends.`;

        return {
          content: [{ type: 'text' as const, text: rows.join('\n') + footer }],
          structuredContent: {
            sends: emails.map((item) => ({
              messageId: item.messageId,
              status: item.status,
              subject: item.subject,
              to: item.to,
              sentAt: new Date(item.sentAt).toISOString(),
            })),
            hasMore: Boolean(result.nextToken),
          },
        };
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
