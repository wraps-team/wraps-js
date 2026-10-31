import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const WORKFLOW_STATUSES = ['draft', 'enabled', 'paused', 'archived'] as const;

const ListWorkflowsInputSchema = {
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
    .describe(`Workflows per page (default ${DEFAULT_PAGE_SIZE}, max ${MAX_PAGE_SIZE}).`),
  search: z
    .string()
    .max(255)
    .optional()
    .describe('Only workflows whose name contains this text (case-insensitive).'),
  status: z
    .enum(WORKFLOW_STATUSES)
    .optional()
    .describe('Only workflows in this status: draft, enabled, paused or archived.'),
};

const WorkflowSummarySchema = z.object({
  id: z
    .string()
    .describe(
      'Workflow id. Pass it to get_workflow, list_workflow_executions or trigger_workflow.'
    ),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string().describe('draft, enabled, paused or archived.'),
  triggerType: z.string().nullable().describe('How the workflow starts, e.g. api or schedule.'),
  version: z.number(),
  totalExecutions: z.number(),
  activeExecutions: z.number(),
  completedExecutions: z.number(),
  failedExecutions: z.number(),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
});

const ListWorkflowsOutputSchema = {
  workflows: z.array(WorkflowSummarySchema),
  total: z.number().describe('Number of workflows matching the filters, across all pages.'),
  page: z.number(),
  pageSize: z.number(),
  hasMore: z
    .boolean()
    .describe(
      'True when more workflows exist beyond this page. A page is never proof that a workflow is absent.'
    ),
};

/** Keep only the declared fields; the API row also carries organizationId and createdBy. */
function toSummary(
  w: z.infer<typeof WorkflowSummarySchema>
): z.infer<typeof WorkflowSummarySchema> {
  return {
    id: w.id,
    name: w.name,
    description: w.description,
    status: w.status,
    triggerType: w.triggerType,
    version: w.version,
    totalExecutions: w.totalExecutions,
    activeExecutions: w.activeExecutions,
    completedExecutions: w.completedExecutions,
    failedExecutions: w.failedExecutions,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  };
}

interface ListWorkflowsResponse {
  workflows: z.infer<typeof WorkflowSummarySchema>[];
  total: number;
  page: number;
  pageSize: number;
}

export function registerListWorkflows(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_workflows',
    {
      description:
        'List the email and SMS automation workflows in your Wraps organization, newest first, with status and execution counts. Use this to find a workflow id before calling get_workflow, list_workflow_executions or trigger_workflow. Pagination: this list is paginated. Pass page (starting at 1) and pageSize (max 100); when hasMore is true, call again with page + 1. Truncation: each page is capped at pageSize and states hasMore, so one page is not proof that a workflow does not exist. Filter with search (name) or status. Requires the workflows read permission.',
      inputSchema: ListWorkflowsInputSchema,
      outputSchema: ListWorkflowsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<ListWorkflowsResponse>(resolved.api, {
        method: 'GET',
        path: '/v1/workflows',
        query: {
          page: input.page,
          pageSize: input.pageSize,
          search: input.search,
          status: input.status,
        },
      });
      if (!result.ok) {
        return result.error;
      }
      const { total, page, pageSize } = result.data;
      const workflows = result.data.workflows.map(toSummary);
      const hasMore = page * pageSize < total;

      if (workflows.length === 0) {
        return textResult(
          total === 0
            ? 'No workflows match these filters in this organization.'
            : `No workflows on page ${page}, but ${total} match in total. Call again with a lower page number.`,
          { workflows: [], total, page, pageSize, hasMore }
        );
      }

      const rows = workflows.map(
        (w) => `${w.name} (${w.id}): ${w.status}, trigger ${w.triggerType ?? 'none'}, v${w.version}`
      );
      const footer = hasMore
        ? `\n\nShowing page ${page} (${workflows.length} of ${total}). More workflows exist: call again with page=${page + 1}.`
        : `\n\nShowing all ${total} matching workflows.`;
      return textResult(rows.join('\n') + footer, {
        workflows,
        total,
        page,
        pageSize,
        hasMore,
      });
    }
  );
}
