import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

const DisableWorkflowScheduleInputSchema = {
  workflowId: z
    .string()
    .min(1)
    .max(64)
    .describe(
      'Workflow id, from list_workflows. The workflow must be a schedule-triggered workflow.'
    ),
};

const DisableWorkflowScheduleOutputSchema = {
  id: z.string().describe('The workflow id whose schedule was disabled.'),
  disabled: z
    .literal(true)
    .describe('Always true on success. The pending scheduled run was removed.'),
};

export function registerDisableWorkflowSchedule(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'disable_workflow_schedule',
    {
      description:
        'Turn off the recurring schedule of a schedule-triggered workflow by deleting its pending scheduled run. Use this to stop a schedule that should not run; use enable_workflow_schedule to start one again. It changes when the workflow runs, not its steps or existing executions. This returns a single record, not a page: there is no pagination, and nothing is truncated. A 404 means the workflow is not in this organization. Requires WRAPS_WRITE_ENABLED=true.',
      inputSchema: DisableWorkflowScheduleInputSchema,
      outputSchema: DisableWorkflowScheduleOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const refused = requireWrite(config);
      if (refused) {
        return refused;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<{ success: boolean }>(resolved.api, {
        method: 'POST',
        path: `/v1/workflow-schedules/${seg(input.workflowId)}/disable`,
      });
      if (!result.ok) {
        return result.error;
      }
      return textResult(
        `Schedule disabled for workflow ${input.workflowId}. Its pending scheduled run was removed; the workflow and its executions were not changed.`,
        { id: input.workflowId, disabled: true as const }
      );
    }
  );
}
