import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const GetWorkflowInputSchema = {
  workflowId: z
    .string()
    .min(1)
    .max(64)
    .describe('Workflow id, from list_workflows. Returns a single record for this id.'),
};

const GetWorkflowOutputSchema = {
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.string().describe('draft, enabled, paused or archived.'),
  triggerType: z.string().nullable().describe('How the workflow starts, e.g. api or schedule.'),
  triggerConfig: z
    .unknown()
    .optional()
    .describe('Trigger settings as stored (e.g. schedule cron and timezone).'),
  steps: z.unknown().optional().describe('The workflow definition steps, as stored.'),
  transitions: z.unknown().optional().describe('The edges between steps, as stored.'),
  version: z.number(),
  totalExecutions: z.number(),
  activeExecutions: z.number(),
  completedExecutions: z.number(),
  failedExecutions: z.number(),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
};

type GetWorkflowOutput = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  triggerType: string | null;
  triggerConfig?: unknown;
  steps?: unknown;
  transitions?: unknown;
  version: number;
  totalExecutions: number;
  activeExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  createdAt: string;
  updatedAt: string;
};

export function registerGetWorkflow(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_workflow',
    {
      description:
        'Get one workflow by id, including its trigger config, steps and transitions, so you can see what it does before triggering it or changing its schedule. Use list_workflows to find the id. This returns a single record, not a page: there is no pagination. Not truncated: steps and transitions are returned in full. A 404 means the id does not exist in this organization. Requires the workflows read permission.',
      inputSchema: GetWorkflowInputSchema,
      outputSchema: GetWorkflowOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<GetWorkflowOutput>(resolved.api, {
        method: 'GET',
        path: `/v1/workflows/${seg(input.workflowId)}`,
      });
      if (!result.ok) {
        return result.error;
      }
      const w = result.data;
      const output: GetWorkflowOutput = {
        id: w.id,
        name: w.name,
        description: w.description,
        status: w.status,
        triggerType: w.triggerType,
        triggerConfig: w.triggerConfig,
        steps: w.steps,
        transitions: w.transitions,
        version: w.version,
        totalExecutions: w.totalExecutions,
        activeExecutions: w.activeExecutions,
        completedExecutions: w.completedExecutions,
        failedExecutions: w.failedExecutions,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
      };
      return textResult(
        `${w.name} (${w.id}): ${w.status}, trigger ${w.triggerType ?? 'none'}, v${w.version}. ${w.steps === undefined ? 'No steps returned.' : 'Steps and transitions are included below.'}`,
        output
      );
    }
  );
}
