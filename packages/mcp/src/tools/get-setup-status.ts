import { GetAccountCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';
import { requireAws } from '../config.ts';
import { SES_SIMULATOR_SUCCESS } from './send-email.ts';

const GetSetupStatusOutputSchema = {
  region: z.string(),
  sandbox: z.boolean().describe('True while the account can only send to verified recipients.'),
  enforcementStatus: z.string().describe('SES account enforcement state, e.g. HEALTHY.'),
  maxSend24Hour: z.number().describe('SES daily send quota.'),
  sentLast24Hours: z.number(),
  fromEmailConfigured: z.boolean().describe('Whether WRAPS_FROM_EMAIL is set.'),
  writeEnabled: z.boolean().describe('Whether WRAPS_WRITE_ENABLED permits sending.'),
  nextAction: z.string().describe('The single next step that unblocks sending.'),
};

export function registerGetSetupStatus(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_setup_status',
    {
      description:
        "Check this AWS SES account's sandbox status and get a recommended next action for getting a first send out. Read-only — makes no changes to your AWS account.",
      inputSchema: {},
      outputSchema: GetSetupStatusOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const resolved = await requireAws(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const { region } = resolved.aws;
      const sesv2 = new SESv2Client({ region });
      try {
        const response = await sesv2.send(new GetAccountCommand({}));

        const productionAccessEnabled = response.ProductionAccessEnabled ?? false;
        const sandbox = !productionAccessEnabled;
        const enforcementStatus = response.EnforcementStatus ?? 'unknown';
        const maxSend24Hour = response.SendQuota?.Max24HourSend ?? 0;
        const sentLast24Hours = response.SendQuota?.SentLast24Hours ?? 0;
        const fromEmailConfigured = Boolean(config.fromEmail);

        let nextAction: string;
        if (!config.writeEnabled) {
          nextAction =
            'Set WRAPS_WRITE_ENABLED=true. No send is possible until write operations are enabled.';
        } else if (!fromEmailConfigured) {
          nextAction =
            'Set WRAPS_FROM_EMAIL to a verified sender identity. This must happen first: a send with no verified sender fails regardless of the recipient, so the AWS mailbox simulator will not help until a from address is configured.';
        } else if (sandbox) {
          nextAction = `This account is in the SES sandbox. Send to the AWS mailbox simulator now to prove the pipeline end to end: to: "${SES_SIMULATOR_SUCCESS}". It needs no recipient verification. Requesting production access to send to anyone else is a separate AWS support review this tool cannot perform.`;
        } else {
          nextAction = 'Production access is enabled. Normal sending to any recipient works.';
        }

        const text = [
          `region: ${region}`,
          `sandbox: ${sandbox}`,
          `enforcementStatus: ${enforcementStatus}`,
          `maxSend24Hour: ${maxSend24Hour}`,
          `sentLast24Hours: ${sentLast24Hours}`,
          `fromEmailConfigured: ${fromEmailConfigured}`,
          `writeEnabled: ${config.writeEnabled}`,
          `nextAction: ${nextAction}`,
        ].join('\n');

        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: {
            region,
            sandbox,
            enforcementStatus,
            maxSend24Hour,
            sentLast24Hours,
            fromEmailConfigured,
            writeEnabled: config.writeEnabled,
            nextAction,
          },
        };
      } catch (error) {
        const err = error as { name?: string; message?: string; $metadata?: unknown };
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Failed to check account setup status: ${typeof err.message === 'string' ? err.message : String(error)}`,
            },
          ],
        };
      } finally {
        sesv2.destroy();
      }
    }
  );
}
