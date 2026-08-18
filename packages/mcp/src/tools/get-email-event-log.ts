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
              {
                type: 'text' as const,
                text: [
                  `No events recorded for messageId: ${input.messageId}.`,
                  '',
                  'This does NOT mean the send failed. Three different states produce it:',
                  '1. The message was sent seconds ago. SES delivery events lag by seconds to minutes. Wait ~30s and call this tool again — do NOT re-send, that would deliver a duplicate.',
                  '2. The messageId is wrong. Call list_recent_sends to get valid IDs.',
                  `3. The event pipeline is not writing into ${config.historyTableName}. A send can succeed while its events never arrive. Call get_setup_status to check the account, and compare against list_recent_sends: if recent sends are listed but none of them have events, the pipeline is the problem, not this message.`,
                ].join('\n'),
              },
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
