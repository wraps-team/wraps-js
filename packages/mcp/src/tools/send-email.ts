import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';

const SendEmailInputSchema = {
  to: z.union([z.string().email(), z.array(z.string().email()).min(1).max(1000)]),
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

      const recipients = Array.isArray(input.to) ? input.to : [input.to];

      if (recipients.length > config.maxRecipients) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Too many recipients (${recipients.length}); max is ${config.maxRecipients}.`,
            },
          ],
        };
      }

      if (config.allowedRecipients.length > 0 || config.allowedRecipientDomains.length > 0) {
        const denied = recipients.some((addr) => {
          const lower = addr.toLowerCase();
          const domain = lower.split('@')[1];
          return (
            !config.allowedRecipients.includes(lower) &&
            !config.allowedRecipientDomains.includes(domain)
          );
        });
        if (denied) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: 'One or more recipients are not in the configured allowlist.',
              },
            ],
          };
        }
      }

      let from: string | undefined;
      if (!input.from) {
        from = config.fromEmail;
      } else if (!config.fromEmail) {
        from = input.from;
      } else if (input.from.toLowerCase() === config.fromEmail.toLowerCase()) {
        from = input.from;
      } else if (config.allowFromOverride) {
        from = input.from;
      } else {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: 'Overriding the configured from address is disabled. Set WRAPS_ALLOW_FROM_OVERRIDE=true to allow.',
            },
          ],
        };
      }
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
      });
      try {
        const result = await email.send({
          to: input.to,
          from,
          subject: input.subject,
          html: input.html,
          text: input.text,
          configurationSetName: config.configurationSetName,
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
