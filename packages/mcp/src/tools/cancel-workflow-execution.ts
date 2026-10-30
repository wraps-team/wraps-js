import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, errorResult, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const CancelWorkflowExecutionInputSchema = {
  executionId: z
    .string()
    .min(1)
    .max(36)
    .describe(
      'Execution id, from list_workflow_executions. The execution must be pending, active, paused or waiting.'
    ),
  confirm: confirmSchema,
};

const CancelWorkflowExecutionOutputSchema = {
  id: z.string().describe('The execution id that was cancelled.'),
  cancelled: z
    .literal(true)
    .describe('Always true on success. No further steps run for this execution.'),
};

interface CancelWorkflowExecutionResponse {
  success: boolean;
  error?: string;
}

export function registerCancelWorkflowExecution(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'cancel_workflow_execution',
    {
      description:
        'Cancel a workflow execution that is still running (pending, active, paused or waiting), so no further steps run for that contact and its scheduled steps are removed. Use this to stop a run that should not continue; a failed run is handled with retry_workflow_execution instead. Requires confirm: true. Irreversible: a cancelled execution cannot be resumed, and a new run needs trigger_workflow. Returns a single record: no pagination, and nothing is truncated. Requires WRAPS_WRITE_ENABLED=true.',
      inputSchema: CancelWorkflowExecutionInputSchema,
      outputSchema: CancelWorkflowExecutionOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const refusedWrite = requireWrite(config);
      if (refusedWrite) {
        return refusedWrite;
      }
      const refusedConfirm = requireConfirm(input);
      if (refusedConfirm) {
        return refusedConfirm;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<CancelWorkflowExecutionResponse>(resolved.api, {
        method: 'POST',
        path: `/v1/workflows/executions/${seg(input.executionId)}/cancel`,
      });
      if (!result.ok) {
        return result.error;
      }
      // The route reports refusals (not found, already finished) as HTTP 200 with success: false.
      if (!result.data.success) {
        return errorResult(
          `Execution ${input.executionId} was not cancelled: ${result.data.error ?? 'the API refused the request'}. Nothing was changed. Check its status with get_workflow_execution.`
        );
      }
      return textResult(
        `Cancelled execution ${input.executionId}. No further steps will run for it.`,
        {
          id: input.executionId,
          cancelled: true as const,
        }
      );
    }
  );
}
