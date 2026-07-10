import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';
import { invokeEnforcerForTool } from '../enforcer-client.ts';
import { EnforcerResultSchema } from './send-email.ts';

const CheckSendStatusInputSchema = {
  approvalId: z.string(),
};

/**
 * Poll the outcome of a `pending_approval` send. Returns the enforcer's current
 * disposition for the given approvalId (`sent`, `blocked`, `pending_approval`,
 * or `unknown`). Only registered in enforced mode.
 */
export function registerCheckSendStatus(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'check_send_status',
    {
      description:
        'Check the outcome of a send that returned pending_approval. Pass the approvalId from send_email. Returns the current disposition: sent (with messageId), blocked, pending_approval (still waiting), or unknown.',
      inputSchema: CheckSendStatusInputSchema,
      outputSchema: EnforcerResultSchema,
    },
    async (input) => {
      const result = await invokeEnforcerForTool(config, {
        action: 'status',
        approvalId: input.approvalId,
      });
      if (!result.ok) {
        return {
          isError: true as const,
          content: [{ type: 'text' as const, text: result.message }],
        };
      }
      const verdict = result.response;
      return {
        content: [
          {
            type: 'text' as const,
            text: `Status for ${input.approvalId}: ${verdict.status}${
              verdict.messageId ? ` (messageId: ${verdict.messageId})` : ''
            }`,
          },
        ],
        structuredContent: verdict,
      };
    }
  );
}
