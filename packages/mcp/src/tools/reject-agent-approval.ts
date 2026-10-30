import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const ApprovalRecord = z.object({
  id: z.string(),
  organizationId: z.string(),
  agentId: z.string(),
  payload: z.object({
    from: z.string(),
    to: z.string(),
    subject: z.string(),
    html: z.string().optional(),
    text: z.string().optional(),
    replyTo: z.string().optional(),
    inReplyTo: z.string().optional(),
    references: z.string().optional(),
  }),
  reason: z.string().nullable(),
  status: z.string().describe('REJECTED once the decision is recorded.'),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  messageId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const RejectAgentApprovalInput = {
  id: z
    .string()
    .min(1)
    .max(255)
    .describe('The approval id from list_agent_approvals (status PENDING).'),
  confirm: confirmSchema,
};

/**
 * Reject one held send so it is never delivered. Destructive and irreversible for that approval.
 * Calls `POST /v1/agents/approvals/:id/reject`. Not registered in enforced mode.
 */
export function registerRejectAgentApproval(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'reject_agent_approval',
    {
      description:
        'Reject one send that an agent asked to make and that was held for a human decision, so it is never delivered. Use list_agent_approvals with status=PENDING to find the id. Requires confirm: true. Irreversible: a rejected approval is final and cannot be approved later; the agent must ask again for a new send. Requires an organization owner or admin, and WRAPS_WRITE_ENABLED=true. Pagination: none; this acts on a single record and returns that record. Truncation: not applicable, nothing is cut and hasMore is never set. Not registered when this server runs as an enforced agent (WRAPS_AGENT_ID set): a leashed agent cannot approve or reject its own sends.',
      inputSchema: RejectAgentApprovalInput,
      outputSchema: ApprovalRecord,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const writeRefusal = requireWrite(config);
      if (writeRefusal) {
        return writeRefusal;
      }
      const confirmRefusal = requireConfirm(input);
      if (confirmRefusal) {
        return confirmRefusal;
      }
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }

      const result = await apiRequest<z.infer<typeof ApprovalRecord>>(credential.api, {
        method: 'POST',
        path: `/v1/agents/approvals/${seg(input.id)}/reject`,
      });
      if (!result.ok) {
        return result.error;
      }

      const record = result.data;
      return textResult(
        `Rejected ${record.id}: the send to ${record.payload.to} will not be delivered.`,
        record
      );
    }
  );
}
