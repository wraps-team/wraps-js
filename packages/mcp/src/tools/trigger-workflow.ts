import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, errorResult, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const TriggerWorkflowInputSchema = {
  workflowId: z
    .string()
    .min(1)
    .max(36)
    .describe(
      'Workflow id, from list_workflows. The workflow must be enabled and have trigger type api.'
    ),
  contactId: z
    .string()
    .min(1)
    .max(36)
    .optional()
    .describe('Id of the contact who enters the workflow. Pass this or contactEmail.'),
  contactEmail: z
    .string()
    .min(1)
    .max(255)
    .optional()
    .describe(
      'Email of the contact who enters the workflow, used when contactId is not known. Pass this or contactId.'
    ),
  data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      'Extra event data for this run, available to its steps (for example a first name or an order id).'
    ),
  confirm: confirmSchema,
};

const TriggerWorkflowOutputSchema = {
  id: z
    .string()
    .describe(
      'The workflow id that was triggered. The API does not return a separate execution id here.'
    ),
  workflowName: z.string(),
  contactId: z.string().describe('The resolved contact id the run was started for.'),
  triggered: z
    .literal(true)
    .describe('Always true on success. The run is queued, and its steps run after this call.'),
};

interface TriggerWorkflowResponse {
  success: boolean;
  message?: string;
  workflowId?: string;
  workflowName?: string;
  contactId?: string;
  error?: string;
}

export function registerTriggerWorkflow(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'trigger_workflow',
    {
      description:
        'Start one run of an API-triggered workflow for one contact, so the workflow steps begin for that contact now. Use this only when the user wants this specific contact to enter the workflow: the steps can send real email or SMS to the contact. Pass contactId or contactEmail. data is extra event data for the run. Requires confirm: true. Irreversible: the run starts and its sends cannot be recalled; you can stop it afterwards with cancel_workflow_execution only while it is still running. The workflow must be enabled with trigger type api, or the call fails with no run started. Returns a single record: no pagination, and nothing is truncated. Requires WRAPS_WRITE_ENABLED=true.',
      inputSchema: TriggerWorkflowInputSchema,
      outputSchema: TriggerWorkflowOutputSchema,
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
      if (!input.contactId && !input.contactEmail) {
        return errorResult(
          'trigger_workflow needs a contact: pass contactId, or contactEmail. Nothing was triggered.'
        );
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<TriggerWorkflowResponse>(resolved.api, {
        method: 'POST',
        path: `/v1/workflows/${seg(input.workflowId)}/trigger`,
        body: {
          contactId: input.contactId,
          contactEmail: input.contactEmail,
          data: input.data,
        },
      });
      if (!result.ok) {
        return result.error;
      }
      // The route reports refusals (not enabled, wrong trigger type, unknown contact) as HTTP 200
      // with success: false, so they are mapped here rather than by api-client.
      if (!result.data.success) {
        return errorResult(
          `Workflow ${input.workflowId} was not triggered: ${result.data.error ?? 'the API refused the request'}. Nothing was started. Fix the cause (for example, enable the workflow or check the contact), then decide whether to retry.`
        );
      }
      const workflowName = result.data.workflowName ?? '';
      const contactId = result.data.contactId ?? '';
      return textResult(
        `Triggered workflow ${workflowName} (${input.workflowId}) for contact ${contactId}. The run is queued; check it with list_workflow_executions.`,
        {
          id: input.workflowId,
          workflowName,
          contactId,
          triggered: true as const,
        }
      );
    }
  );
}
