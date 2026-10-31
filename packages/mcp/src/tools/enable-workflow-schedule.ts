import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

const EnableWorkflowScheduleInputSchema = {
  workflowId: z
    .string()
    .min(1)
    .max(64)
    .describe(
      'Workflow id, from list_workflows. The workflow must be a schedule-triggered workflow.'
    ),
  cronExpression: z
    .string()
    .min(1)
    .max(255)
    .describe(
      'Standard cron expression for the next run, e.g. "0 9 * * 1" for 09:00 every Monday.'
    ),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe(
      'IANA timezone the cron expression is evaluated in, e.g. "Europe/London". Default UTC.'
    ),
};

const EnableWorkflowScheduleOutputSchema = {
  id: z.string().describe('The workflow id whose schedule was enabled.'),
  scheduleName: z.string().describe('Name of the one-time schedule created for the next run.'),
};

export function registerEnableWorkflowSchedule(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'enable_workflow_schedule',
    {
      description:
        'Turn on the recurring schedule of a schedule-triggered workflow by creating its next one-time run from a cron expression and timezone. Use this to start a schedule that is not running; use disable_workflow_schedule to stop one. It changes when the workflow runs, not its steps. This returns a single record, not a page: there is no pagination, and nothing is truncated. A 404 means the workflow is not in this organization. Requires WRAPS_WRITE_ENABLED=true.',
      inputSchema: EnableWorkflowScheduleInputSchema,
      outputSchema: EnableWorkflowScheduleOutputSchema,
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
      const result = await apiRequest<{ success: boolean; scheduleName?: string }>(resolved.api, {
        method: 'POST',
        path: `/v1/workflow-schedules/${seg(input.workflowId)}/enable`,
        body: {
          cronExpression: input.cronExpression,
          timezone: input.timezone,
        },
      });
      if (!result.ok) {
        return result.error;
      }
      const scheduleName = result.data.scheduleName ?? '';
      return textResult(
        `Schedule enabled for workflow ${input.workflowId} (cron "${input.cronExpression}"${input.timezone ? `, ${input.timezone}` : ', UTC'}). Next run scheduled as ${scheduleName}.`,
        { id: input.workflowId, scheduleName }
      );
    }
  );
}
