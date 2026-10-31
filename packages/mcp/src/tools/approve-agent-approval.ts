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
  status: z.string().describe('SENT when the email went out, FAILED when the send errored.'),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  messageId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ApproveAgentApprovalInput = {
  id: z
    .string()
    .min(1)
    .max(255)
    .describe('The approval id from list_agent_approvals (status PENDING).'),
  confirm: confirmSchema,
};

/**
 * Approve one held send, which sends the email now. Destructive and irreversible. Calls
 * `POST /v1/agents/approvals/:id/approve`. Not registered in enforced mode (see the
 * description and graph.md D-N0).
 */
export function registerApproveAgentApproval(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'approve_agent_approval',
    {
      description:
        'Approve one send that an agent asked to make and that was held for a human decision, so Wraps sends it now. Use list_agent_approvals with status=PENDING to find the id, and read the payload first. Requires confirm: true. Irreversible: the email is sent to the recipient as written and cannot be recalled. Requires an organization owner or admin, and WRAPS_WRITE_ENABLED=true. Pagination: none; this acts on a single record and returns that record. Truncation: not applicable, nothing is cut and hasMore is never set. Not registered when this server runs as an enforced agent (WRAPS_AGENT_ID set): a leashed agent cannot approve its own sends.',
      inputSchema: ApproveAgentApprovalInput,
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
        path: `/v1/agents/approvals/${seg(input.id)}/approve`,
      });
      if (!result.ok) {
        return result.error;
      }

      const record = result.data;
      return textResult(
        `Approved ${record.id}: the send to ${record.payload.to} is now ${record.status}${record.messageId ? ` (message ${record.messageId})` : ''}.`,
        record
      );
    }
  );
}
