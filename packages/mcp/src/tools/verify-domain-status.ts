import { GetEmailIdentityCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';
import { requireAws } from '../config.ts';

const VerifyDomainStatusInputSchema = {
  domain: z
    .string()
    .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Must be a valid domain name')
    .describe('Domain to check, e.g. example.com. SES identities are per-region.'),
};

const VerifyDomainStatusOutputSchema = {
  domain: z.string(),
  verified: z.boolean().describe('True when SES will accept sends from this domain.'),
  dkimStatus: z.string().describe('SES DKIM status, e.g. SUCCESS, PENDING, FAILED.'),
  dkimTokens: z.array(z.string()).describe('CNAME tokens to publish in DNS.'),
  region: z.string().describe('SES identities are per-region; this is the region checked.'),
};

export function registerVerifyDomainStatus(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'verify_domain_status',
    {
      description:
        'Check the verification and DKIM status of a sending domain in your AWS SES account. Returns whether the domain is verified for sending and its DKIM configuration status.',
      inputSchema: VerifyDomainStatusInputSchema,
      outputSchema: VerifyDomainStatusOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = await requireAws(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const { region } = resolved.aws;
      const sesv2 = new SESv2Client({ region });
      try {
        const response = await sesv2.send(
          new GetEmailIdentityCommand({ EmailIdentity: input.domain })
        );

        const verified = response.VerifiedForSendingStatus ?? false;
        const dkimStatus = response.DkimAttributes?.Status ?? 'PENDING';
        const dkimTokens = response.DkimAttributes?.Tokens ?? [];

        const text = [
          `domain: ${input.domain}`,
          `verified: ${verified}`,
          `dkimStatus: ${dkimStatus}`,
          `dkimTokens: ${dkimTokens.join(', ') || 'none'}`,
        ].join('\n');

        return {
          content: [{ type: 'text' as const, text }],
          structuredContent: {
            domain: input.domain,
            verified,
            dkimStatus,
            dkimTokens,
            region,
          },
        };
      } catch (error) {
        const err = error as { name?: string; message?: string; $metadata?: unknown };
        if (
          err.name === 'NotFoundException' ||
          err.name === 'NoSuchEntityException' ||
          (typeof err.message === 'string' && err.message.includes('NotFoundException'))
        ) {
          return {
            isError: true,
            content: [
              {
                type: 'text' as const,
                text: [
                  `Domain not found in SES: ${input.domain} (checked region: ${region}).`,
                  '',
                  'Three things cause this:',
                  `1. Wrong region. SES identities are per-region, and this server only checks ${region}. If ${input.domain} was verified in a different region, restart this MCP server with AWS_REGION set to that region.`,
                  `2. Not added yet. Run \`wraps email domains add --domain ${input.domain} --region ${region}\` to create the identity and print the DNS records to add, or \`wraps email init --domain ${input.domain}\` for a first-time setup.`,
                  '3. A typo in the domain name.',
                  '',
                  "Call get_setup_status for this account's region, sandbox state, and a recommended next action.",
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
              text: `Failed to check domain status for ${input.domain} in ${region}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      } finally {
        sesv2.destroy();
      }
    }
  );
}
