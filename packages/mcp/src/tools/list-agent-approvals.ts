import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';

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
  status: z.string().describe('PENDING, APPROVED, REJECTED, SENT or FAILED.'),
  decidedBy: z.string().nullable(),
  decidedAt: z.string().nullable(),
  messageId: z.string().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ListAgentApprovalsInput = {
  status: z
    .enum(['PENDING', 'APPROVED', 'REJECTED', 'SENT', 'FAILED'])
    .optional()
    .describe(
      'Only list approvals in this state. Use PENDING to see sends waiting for a decision. Omit to list every state.'
    ),
};

const ListAgentApprovalsOutput = z.object({
  approvals: z
    .array(ApprovalRecord)
    .describe('Newest first. Each record carries its full payload (the email to be sent).'),
});

/**
 * List the approval queue for agents that send email through Wraps. Read-only. Calls
 * `GET /v1/agents/approvals`.
 */
export function registerListAgentApprovals(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_agent_approvals',
    {
      description:
        'List the approval queue for agents: the sends that an agent asked to make and that were held for a human decision. Use status=PENDING to see sends waiting for approve_agent_approval or reject_agent_approval. Each record has id, agentId, payload (from, to, subject, html, text), status, reason, decidedBy and messageId. Pagination: none; the route returns the whole queue in one response, newest first, so there is no cursor to pass. Truncation: nothing is cut and hasMore is never set, so a short list is complete. Filter with status only.',
      inputSchema: ListAgentApprovalsInput,
      outputSchema: ListAgentApprovalsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }

      const result = await apiRequest<z.infer<typeof ListAgentApprovalsOutput>>(credential.api, {
        method: 'GET',
        path: '/v1/agents/approvals',
        query: { status: input.status },
      });
      if (!result.ok) {
        return result.error;
      }

      const approvals = result.data.approvals ?? [];
      const scope = input.status ? ` with status ${input.status}` : '';
      return textResult(
        `Found ${approvals.length} approval${approvals.length === 1 ? '' : 's'}${scope}.`,
        { approvals }
      );
    }
  );
}
