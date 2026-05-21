import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';

const SendEmailInputSchema = {
  to: z.union([z.string().email(), z.array(z.string().email()).min(1)]),
  from: z.string().email().optional(),
  subject: z.string(),
  html: z.string().optional(),
  text: z.string().optional(),
};

export function registerSendEmail(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'send_email',
    {
      description:
        'Send a transactional email via your AWS SES account. Requires WRAPS_WRITE_ENABLED=true. The `from` address must be a verified Wraps domain. The `to` field accepts a single address or an array of addresses.',
      inputSchema: SendEmailInputSchema,
    },
    async (input) => {
      if (!config.writeEnabled) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Write operations are disabled. Set WRAPS_WRITE_ENABLED=true to enable sending.',
            },
          ],
        };
      }

      const from = input.from ?? config.fromEmail;
      if (!from) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'No from address. Set WRAPS_FROM_EMAIL or pass `from` in the tool call.',
            },
          ],
        };
      }

      if (!input.html && !input.text) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Either `html` or `text` body is required.' }],
        };
      }

      const email = new WrapsEmail({
        region: config.region,
        historyTableName: config.historyTableName,
        configurationSetName: config.configurationSetName,
      });
      try {
        const result = await email.send({
          to: input.to,
          from,
          subject: input.subject,
          html: input.html,
          text: input.text,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Email sent successfully. messageId: ${result.messageId}`,
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Failed to send email: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      } finally {
        email.destroy();
      }
    }
  );
}
