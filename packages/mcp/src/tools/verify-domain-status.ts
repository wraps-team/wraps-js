import { GetEmailIdentityCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';

const VerifyDomainStatusInputSchema = {
  domain: z.string().regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Must be a valid domain name'),
};

export function registerVerifyDomainStatus(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'verify_domain_status',
    {
      description:
        'Check the verification and DKIM status of a sending domain in your AWS SES account. Returns whether the domain is verified for sending and its DKIM configuration status.',
      inputSchema: VerifyDomainStatusInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const sesv2 = new SESv2Client({ region: config.region });
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

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const err = error as { name?: string; message?: string; $metadata?: unknown };
        if (
          err.name === 'NotFoundException' ||
          err.name === 'NoSuchEntityException' ||
          (typeof err.message === 'string' && err.message.includes('NotFoundException'))
        ) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `Domain not found in SES: ${input.domain}` }],
          };
        }
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Failed to check domain status: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      } finally {
        sesv2.destroy();
      }
    }
  );
}
