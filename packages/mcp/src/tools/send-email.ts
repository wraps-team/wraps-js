import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';
import { requireAws } from '../config.ts';
import { invokeEnforcerForTool } from '../enforcer-client.ts';
import type { EnforcerResponse } from '../enforcer-contract.ts';

const SendEmailInputSchema = {
  to: z
    .union([z.string().email(), z.array(z.string().email()).min(1).max(1000)])
    .describe('Recipient address, or an array of up to 1000 addresses.'),
  from: z
    .string()
    .email()
    .optional()
    .describe(
      'Sender address. Must be a verified SES identity in this account. Defaults to WRAPS_FROM_EMAIL.'
    ),
  subject: z.string().describe('Subject line.'),
  html: z
    .string()
    .optional()
    .describe('HTML body. Provide `html`, `text`, or both; at least one is required.'),
  text: z
    .string()
    .optional()
    .describe('Plain-text body. Provide `html`, `text`, or both; at least one is required.'),
};

const EnforcedSendEmailInputSchema = {
  ...SendEmailInputSchema,
  to: z
    .union([z.string().email(), z.array(z.string().email()).length(1)])
    .describe(
      'Recipient email address. Enforced (agent) mode supports a single recipient per send — pass one address as a string, or a one-element array. Arrays with more than one recipient are rejected; send one email per recipient.'
    ),
  replyTo: z
    .string()
    .email()
    .optional()
    .describe(
      'Where a human reply should land. Use this when a person, not the agent, should receive replies.'
    ),
  inReplyTo: z
    .string()
    .optional()
    .describe(
      "Message-ID of the message being replied to, e.g. <abc@mail.example.com>. Threads the reply in the recipient's client."
    ),
  references: z
    .string()
    .optional()
    .describe('Space-separated Message-ID chain of the conversation so far.'),
};

/**
 * The plain send path. Distinct from EnforcerResultSchema: without an agent
 * enforcer there is no approval step, so a success is always a completed send.
 */
export const SendEmailResultSchema = {
  messageId: z
    .string()
    .describe('SES message id; pass to get_email_event_log for delivery events.'),
  to: z.array(z.string()).describe('Recipients the message was accepted for.'),
  from: z.string(),
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

function bareAddress(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

/**
 * True when SES's "not verified" rejection names the sender, not a recipient.
 * The SES message lists the failing identities after the region, e.g.
 * "...failed the check in region US-EAST-2: sender@example.com".
 */
export function isUnverifiedSenderError(error: unknown, from: string): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // The SDK's SandboxError appends guidance after the identity list, so stop at
  // the end of that line.
  const failed = message.split(/failed the check in region [^:]+:/i)[1]?.split('\n')[0];
  if (!failed) {
    return false;
  }
  const sender = bareAddress(from);
  return failed
    .split(',')
    .map((identity) => identity.trim().toLowerCase())
    .includes(sender);
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
        'Send a transactional email through your Wraps agent enforcer. The send is checked against your agent policy (kill-switch, recipient allowlist, rate caps) before delivery. Exactly one recipient per send is supported. The result disposition is one of: sent, pending_approval (an operator must approve — poll check_send_status with the returned approvalId), or blocked. Set `replyTo` to route human replies to a person instead of the agent, and `inReplyTo`/`references` to thread a follow-up.',
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
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
        ...(input.references ? { references: input.references } : {}),
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
        'Send a transactional email via your AWS SES account. Requires WRAPS_WRITE_ENABLED=true. The `from` address must be a verified SES identity (an address or domain) in this account and region. The `to` field accepts a single address or an array of addresses.',
      inputSchema: SendEmailInputSchema,
      outputSchema: SendEmailResultSchema,
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

      // `SendEmailParams` requires a definite body, and two independent optional
      // fields cannot narrow each other. Build it once so the type carries the
      // invariant the guard below enforces.
      const body: { html: string; text?: string } | { text: string } | undefined =
        input.html !== undefined
          ? { html: input.html, ...(input.text !== undefined ? { text: input.text } : {}) }
          : input.text !== undefined
            ? { text: input.text }
            : undefined;

      if (!body) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Either `html` or `text` body is required.' }],
        };
      }

      const awsResolved = await requireAws(config);
      if (!awsResolved.ok) {
        return awsResolved.error;
      }

      const email = new WrapsEmail({
        region: awsResolved.aws.region,
        historyTableName: config.historyTableName,
      });
      try {
        const result = await email.send({
          to: input.to,
          from,
          subject: input.subject,
          ...body,
          configurationSetName: config.configurationSetName,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: `Email sent successfully. messageId: ${result.messageId}`,
            },
          ],
          structuredContent: {
            messageId: result.messageId,
            to: Array.isArray(input.to) ? input.to : [input.to],
            from,
          },
        };
      } catch (error) {
        if (isUnverifiedSenderError(error, from)) {
          const sender = bareAddress(from);
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: [
                  `Send rejected: the from address ${sender} is not verified in SES in ${awsResolved.aws.region}.`,
                  '',
                  'SES identities are per-region. Either the address or its domain was verified in a different region (restart this MCP server with AWS_REGION set to that region), or it has not been verified yet. Call verify_domain_status with the domain to see which.',
                  '',
                  `Original SES error: ${error instanceof Error ? error.message : String(error)}`,
                ].join('\n'),
              },
            ],
          };
        }
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
