import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';
import { invokeEnforcerForTool } from '../enforcer-client.ts';
import type { EnforcerResponse } from '../enforcer-contract.ts';

const SendEmailInputSchema = {
  to: z.union([z.string().email(), z.array(z.string().email()).min(1).max(1000)]),
  from: z.string().email().optional(),
  subject: z.string(),
  html: z.string().optional(),
  text: z.string().optional(),
};

const EnforcedSendEmailInputSchema = {
  ...SendEmailInputSchema,
  to: z
    .union([z.string().email(), z.array(z.string().email()).length(1)])
    .describe(
      'Recipient email address. Enforced (agent) mode supports a single recipient per send — pass one address as a string, or a one-element array. Arrays with more than one recipient are rejected; send one email per recipient.'
    ),
};

export const EnforcerResultSchema = {
  status: z.enum(['sent', 'pending_approval', 'blocked', 'failed', 'unknown']),
  messageId: z.string().optional(),
  approvalId: z.string().optional(),
  reason: z.string().optional(),
};

function textError(text: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text }] };
}

// Mirrors SES_SIMULATOR_ADDRESSES.SUCCESS in the wraps repo at
// packages/cli/src/utils/email/ses-simulator.ts. AWS pre-verifies this
// address, so it is deliverable from a sandbox account with no recipient
// verification. The SENDER identity must still be verified.
export const SES_SIMULATOR_SUCCESS = 'success@simulator.amazonses.com';

/**
 * True when an SES failure is the sandbox's unverified-recipient rejection.
 * AWS SDK v3 error names are unreliable, so check name AND message.
 */
export function isUnverifiedRecipientError(error: unknown): boolean {
  const err = error as { name?: string; message?: string };
  const message = typeof err?.message === 'string' ? err.message : '';
  return (
    err?.name === 'MessageRejected' ||
    message.includes('MessageRejected') ||
    message.includes('not verified')
  );
}

/**
 * Enforced-mode send_email. The customer-side enforcer Lambda is authoritative
 * for every policy decision (kill-switch, allowlist, caps), so local guard
 * checks are skipped. Policy outcomes (`pending_approval`, `blocked`) are
 * returned as SUCCESSFUL structured results — never `isError`. Only transport
 * or config failures are `isError`.
 */
function registerEnforcedSendEmail(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'send_email',
    {
      description:
        'Send a transactional email through your Wraps agent enforcer. The send is checked against your agent policy (kill-switch, recipient allowlist, rate caps) before delivery. Exactly one recipient per send is supported. The result disposition is one of: sent, pending_approval (an operator must approve — poll check_send_status with the returned approvalId), or blocked.',
      inputSchema: EnforcedSendEmailInputSchema,
      outputSchema: EnforcerResultSchema,
      // send_email is the only tool here with a real-world side effect, and email
      // cannot be recalled. Stated explicitly rather than left to the spec's
      // defaults: destructiveHint/idempotentHint are only consulted when
      // readOnlyHint is false, so all four are set together.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const from = input.from ?? config.fromEmail;
      if (!from) {
        return textError('No from address. Set WRAPS_FROM_EMAIL or pass `from` in the tool call.');
      }
      if (!input.html && !input.text) {
        return textError('Either `html` or `text` body is required.');
      }

      const recipients = Array.isArray(input.to) ? input.to : [input.to];
      if (recipients.length > 1) {
        return textError(
          'Enforced mode supports a single recipient per send. Send one email per recipient.'
        );
      }
      const to = recipients[0];
      const payload = {
        from,
        to,
        subject: input.subject,
        html: input.html ?? '',
        text: input.text ?? '',
      };

      const result = await invokeEnforcerForTool(config, { action: 'send', payload });
      if (!result.ok) {
        return textError(result.message);
      }
      return {
        content: [{ type: 'text' as const, text: describeDisposition(result.response) }],
        structuredContent: result.response,
      };
    }
  );
}

function describeDisposition(verdict: EnforcerResponse): string {
  switch (verdict.status) {
    case 'sent':
      return `Email sent. messageId: ${verdict.messageId}`;
    case 'pending_approval':
      return `Send is pending operator approval. Poll check_send_status with approvalId: ${verdict.approvalId}`;
    case 'blocked':
      return `Send blocked by agent policy${verdict.reason ? `: ${verdict.reason}` : '.'}`;
    default:
      return `Send status: ${verdict.status}${verdict.reason ? ` (${verdict.reason})` : ''}`;
  }
}

export function registerSendEmail(server: McpServer, config: MCPConfig): void {
  if (config.enforcedMode) {
    registerEnforcedSendEmail(server, config);
    return;
  }
  server.registerTool(
    'send_email',
    {
      description:
        'Send a transactional email via your AWS SES account. Requires WRAPS_WRITE_ENABLED=true. The `from` address must be a verified Wraps domain. The `to` field accepts a single address or an array of addresses.',
      inputSchema: SendEmailInputSchema,
      // send_email is the only tool here with a real-world side effect, and email
      // cannot be recalled. Stated explicitly rather than left to the spec's
      // defaults: destructiveHint/idempotentHint are only consulted when
      // readOnlyHint is false, so all four are set together.
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
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
          const domain = lower.split('@')[1] ?? '';
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
        if (isUnverifiedRecipientError(error)) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: [
                  'Send rejected: this AWS SES account is in the sandbox, so it can only send to verified recipients.',
                  '',
                  'You do NOT need production access to prove sending works. Options, cheapest first:',
                  `1. Send to the AWS mailbox simulator instead: to: "${SES_SIMULATOR_SUCCESS}". AWS pre-verifies it, so it needs no recipient verification and produces a real Delivery event. Your "from" address must already be verified (it is, since this send got as far as SES).`,
                  '2. Verify the intended recipient as an SES identity in this AWS account, then retry. Verified identities can both send and receive while in the sandbox.',
                  '3. Request SES production access to send to anyone. This is an AWS support review and is NOT something this tool can do for you.',
                  '',
                  "Call get_setup_status for this account's current sandbox state and a recommended next action.",
                  '',
                  `Original SES error: ${error instanceof Error ? error.message : String(error)}`,
                ].join('\n'),
              },
            ],
          };
        }
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
