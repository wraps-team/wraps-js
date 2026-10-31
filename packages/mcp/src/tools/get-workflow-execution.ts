import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const GetWorkflowExecutionInputSchema = {
  executionId: z
    .string()
    .min(1)
    .max(64)
    .describe('Execution id, from list_workflow_executions. Returns a single record for this id.'),
};

const StepExecutionSchema = z.object({
  id: z.string(),
  executionId: z.string(),
  stepId: z.string().describe('The workflow step this run belongs to.'),
  stepType: z.string(),
  status: z.string(),
  createdAt: z.string().describe('ISO 8601.'),
});

const GetWorkflowExecutionOutputSchema = {
  id: z.string(),
  workflowId: z.string(),
  contactId: z.string(),
  status: z.string().describe('pending, active, paused, waiting, completed, failed or cancelled.'),
  currentStepId: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
  contact: z
    .object({
      id: z.string(),
      email: z.string().nullable(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
    })
    .nullable(),
  workflow: z
    .object({ name: z.string() })
    .nullable()
    .describe('The workflow name, or null if missing.'),
  stepExecutions: z
    .array(StepExecutionSchema)
    .describe(
      'The step trace: each step this execution has reached, in the order the API returns them.'
    ),
  stepEngagement: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Per-step engagement counts, keyed by step id, when the API returns them.'),
};

interface ExecutionDetail {
  id: string;
  workflowId: string;
  contactId: string;
  status: string;
  currentStepId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  contact: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  workflow: { name: string } | null;
  stepExecutions: z.infer<typeof StepExecutionSchema>[];
  stepEngagement?: Record<string, unknown>;
}

export function registerGetWorkflowExecution(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_workflow_execution',
    {
      description:
        'Get one workflow execution by id, with its step trace (every step it reached and that step status), its contact, the workflow name and per-step engagement. Use this to see where a run stopped or why it failed, before deciding to retry_workflow_execution or cancel_workflow_execution. Use list_workflow_executions to find the id. This returns a single record, not a page: there is no pagination. Not truncated: the step trace is returned in full. A 404 means the id does not exist in this organization. Requires the workflows read permission.',
      inputSchema: GetWorkflowExecutionInputSchema,
      outputSchema: GetWorkflowExecutionOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<ExecutionDetail>(resolved.api, {
        method: 'GET',
        path: `/v1/workflows/executions/${seg(input.executionId)}`,
      });
      if (!result.ok) {
        return result.error;
      }
      const e = result.data;
      const output = {
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
        workflow: e.workflow,
        stepExecutions: e.stepExecutions.map((s) => ({
          id: s.id,
          executionId: s.executionId,
          stepId: s.stepId,
          stepType: s.stepType,
          status: s.status,
          createdAt: s.createdAt,
        })),
        ...(e.stepEngagement === undefined ? {} : { stepEngagement: e.stepEngagement }),
      };
      const lastStep = output.stepExecutions[output.stepExecutions.length - 1];
      const summary = `Execution ${e.id} of ${e.workflow?.name ?? e.workflowId} is ${e.status}${e.currentStepId ? `, current step ${e.currentStepId}` : ''}. ${output.stepExecutions.length} step run(s)${lastStep ? `, last ${lastStep.stepType} (${lastStep.status})` : ''}.`;
      return textResult(summary, output);
    }
  );
}
