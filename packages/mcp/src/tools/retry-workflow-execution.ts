import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, errorResult, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const RetryWorkflowExecutionInputSchema = {
  executionId: z
    .string()
    .min(1)
    .max(36)
    .describe('Execution id, from list_workflow_executions. The execution must be failed.'),
  confirm: confirmSchema,
};

const RetryWorkflowExecutionOutputSchema = {
  id: z.string().describe('The execution id that was retried.'),
  message: z.string().describe('The API message, e.g. "Execution retry started".'),
};

interface RetryWorkflowExecutionResponse {
  success: boolean;
  message?: string;
  error?: string;
}

export function registerRetryWorkflowExecution(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'retry_workflow_execution',
    {
      description:
        'Retry a failed workflow execution from the step where it failed. Steps that already completed are kept, and the failed step runs again, so a send step can send again. Check the execution first with get_workflow_execution to confirm it failed and why. Only failed executions can be retried, and there is a retry limit. Requires confirm: true. Irreversible: the failed step re-runs for real and its effects cannot be recalled. Returns a single record: no pagination, and nothing is truncated. Requires WRAPS_WRITE_ENABLED=true.',
      inputSchema: RetryWorkflowExecutionInputSchema,
      outputSchema: RetryWorkflowExecutionOutputSchema,
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
      const result = await apiRequest<RetryWorkflowExecutionResponse>(resolved.api, {
        method: 'POST',
        path: `/v1/workflows/executions/${seg(input.executionId)}/retry`,
      });
      if (!result.ok) {
        return result.error;
      }
      // The route reports refusals (not failed, retry limit, unknown step) as HTTP 200 with
      // success: false, so they are mapped here.
      if (!result.data.success) {
        return errorResult(
          `Execution ${input.executionId} was not retried: ${result.data.error ?? 'the API refused the request'}. Nothing was changed. Check its status with get_workflow_execution.`
        );
      }
      const message = result.data.message ?? 'Execution retry started';
      return textResult(`${message} for execution ${input.executionId}.`, {
        id: input.executionId,
        message,
      });
    }
  );
}
