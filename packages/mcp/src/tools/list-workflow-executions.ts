import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const EXECUTION_STATUSES = [
  'pending',
  'active',
  'paused',
  'waiting',
  'completed',
  'failed',
  'cancelled',
] as const;

const ListWorkflowExecutionsInputSchema = {
  workflowId: z
    .string()
    .min(1)
    .max(64)
    .describe('Workflow id, from list_workflows. The workflow must belong to this organization.'),
  page: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'Page number, starting at 1 (default 1). To continue, pass page + 1 while hasMore is true.'
    ),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .optional()
    .describe(`Executions per page (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}).`),
  status: z
    .enum(EXECUTION_STATUSES)
    .optional()
    .describe(
      'Only executions in this status: pending, active, paused, waiting, completed, failed or cancelled.'
    ),
};

const ExecutionSummarySchema = z.object({
  id: z
    .string()
    .describe(
      'Execution id. Pass it to get_workflow_execution, retry_workflow_execution or cancel_workflow_execution.'
    ),
  workflowId: z.string(),
  contactId: z.string(),
  status: z.string(),
  currentStepId: z.string().nullable(),
  startedAt: z.string().nullable().describe('ISO 8601, or null if it has not started.'),
  completedAt: z.string().nullable().describe('ISO 8601, or null while still running.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
  contact: z
    .object({
      id: z.string(),
      email: z.string().nullable(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
    })
    .nullable()
    .describe('The contact this execution runs for, or null if the contact no longer exists.'),
});

const ListWorkflowExecutionsOutputSchema = {
  executions: z.array(ExecutionSummarySchema),
  total: z.number().describe('Executions of this workflow matching the filter, across all pages.'),
  page: z.number(),
  pageSize: z.number(),
  hasMore: z
    .boolean()
    .describe(
      'True when more executions exist beyond this page. A page is never proof that an execution is absent.'
    ),
};

type ExecutionSummary = z.infer<typeof ExecutionSummarySchema>;

interface ListWorkflowExecutionsResponse {
  executions: ExecutionSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Keep only the declared fields; the API row also carries organizationId. */
function toSummary(e: ExecutionSummary): ExecutionSummary {
  return {
    id: e.id,
    workflowId: e.workflowId,
    contactId: e.contactId,
    status: e.status,
    currentStepId: e.currentStepId,
    startedAt: e.startedAt,
    completedAt: e.completedAt,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
    contact: e.contact,
  };
}

export function registerListWorkflowExecutions(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_workflow_executions',
    {
      description:
        'List the executions of one workflow (one run per contact), newest first, each with its contact and status. Use this to find an execution id for get_workflow_execution, retry_workflow_execution or cancel_workflow_execution, or to see whether a workflow is stuck or failing. Pagination: this list is paginated. Pass page (starting at 1) and pageSize (max 100); when hasMore is true, call again with page + 1. Truncation: each page is capped at pageSize and states hasMore, so one page is not proof that an execution does not exist. Filter by status. Requires the workflows read permission.',
      inputSchema: ListWorkflowExecutionsInputSchema,
      outputSchema: ListWorkflowExecutionsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<ListWorkflowExecutionsResponse>(resolved.api, {
        method: 'GET',
        path: `/v1/workflows/${seg(input.workflowId)}/executions`,
        query: {
          page: input.page,
          pageSize: input.pageSize,
          status: input.status,
        },
      });
      if (!result.ok) {
        return result.error;
      }
      const { total, page, pageSize } = result.data;
      const executions = result.data.executions.map(toSummary);
      const hasMore = page * pageSize < total;

      if (executions.length === 0) {
        return textResult(
          total === 0
            ? `No executions match for workflow ${input.workflowId}.`
            : `No executions on page ${page}, but ${total} match in total. Call again with a lower page number.`,
          { executions: [], total, page, pageSize, hasMore }
        );
      }

      const rows = executions.map(
        (e) =>
          `${e.id}: ${e.status}, contact ${e.contact?.email ?? e.contactId}, started ${e.startedAt ?? 'not yet'}`
      );
      const footer = hasMore
        ? `\n\nShowing page ${page} (${executions.length} of ${total}). More executions exist: call again with page=${page + 1}.`
        : `\n\nShowing all ${total} matching executions.`;
      return textResult(rows.join('\n') + footer, { executions, total, page, pageSize, hasMore });
    }
  );
}
