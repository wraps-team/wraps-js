import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';

const GetEmailEventLogInputSchema = {
  messageId: z.string().min(1),
};

export function registerGetEmailEventLog(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_email_event_log',
    {
      description:
        'Get the full delivery event log for a specific email by its messageId. Returns all SES events: Send, Delivery, Bounce, Complaint, Open, Click.',
      inputSchema: GetEmailEventLogInputSchema,
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
        const status = await email.events.get(input.messageId);

        if (!status) {
          return {
            content: [
              { type: 'text' as const, text: `No events found for messageId: ${input.messageId}` },
            ],
          };
        }

        const eventsText = status.events
          .map((e) => `  ${e.type} at ${new Date(e.timestamp).toISOString()}`)
          .join('\n');

        const text = [
          `messageId: ${status.messageId}`,
          `status: ${status.status}`,
          `from: ${status.from}`,
          `to: ${status.to.join(', ')}`,
          `subject: ${status.subject}`,
          `sentAt: ${new Date(status.sentAt).toISOString()}`,
          `events:`,
          eventsText,
        ].join('\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Failed to get event log: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      } finally {
        email.destroy();
      }
    }
  );
}
