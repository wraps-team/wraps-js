import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

/** Mirrors the POST /v1/events body and response in apps/api/src/routes/events.ts. */
interface TrackEventResponse {
  success: boolean;
  contactCreated: boolean;
  workflowsTriggered: number;
  executionsResumed: number;
}

const TrackEventOutputSchema = {
  id: z
    .string()
    .nullable()
    .describe(
      'The contactId you passed, echoed back, or null. The API returns no event id and no resolved contact id, so this is null when you identified the contact by externalId or email.'
    ),
  success: z.boolean(),
  contactCreated: z.boolean().describe('True when createIfMissing created the contact.'),
  workflowsTriggered: z
    .number()
    .int()
    .describe('Workflows started by this event. They may send email to the contact.'),
  executionsResumed: z
    .number()
    .int()
    .describe('Waiting workflow executions resumed by this event.'),
};

const TrackEventInputSchema = {
  name: z
    .string()
    .min(1)
    .max(255)
    .describe(
      "Event name, e.g. 'purchase.completed'. Use list_event_names to reuse an existing name."
    ),
  contactId: z
    .string()
    .max(36)
    .optional()
    .describe('Contact id. Give one of contactId, contactExternalId, or contactEmail.'),
  contactExternalId: z
    .string()
    .max(255)
    .optional()
    .describe('Contact externalId, your own id for the contact, used when contactId is not known.'),
  contactEmail: z
    .string()
    .email()
    .max(255)
    .optional()
    .describe('Contact email, used when neither contactId nor contactExternalId is given.'),
  contactName: z
    .string()
    .max(100)
    .optional()
    .describe('First name to set on a contact created by createIfMissing.'),
  createIfMissing: z
    .boolean()
    .optional()
    .describe(
      'When true and no contact matches, create one from contactEmail (default false). Without it, an unknown contact is refused.'
    ),
  properties: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('Free-form event properties, stored with the event and available to workflows.'),
  confirm: confirmSchema,
};

export function registerTrackEvent(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'track_event',
    {
      description:
        'Record a custom event for one contact. Requires confirm: true. This is irreversible: the event is stored and counts toward the plan event allowance, and it can START workflows that send email to the contact and RESUME workflow steps that are waiting for this event name. Only call it when the user has asked for this event to be recorded for this contact; to read existing events use list_events instead. Identify the contact with one of contactId, contactExternalId, or contactEmail. Pagination: none, the result is a single record of counts. Truncation: none. Refused with HTTP 429 when the monthly event allowance is exhausted. Requires write mode (WRAPS_WRITE_ENABLED=true).',
      inputSchema: TrackEventInputSchema,
      outputSchema: TrackEventOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const writeRefusal = requireWrite(config);
      if (writeRefusal) {
        return writeRefusal;
      }
      const confirmRefusal = requireConfirm(input);
      if (confirmRefusal) {
        return confirmRefusal;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const { confirm: _confirm, ...body } = input;
      const res = await apiRequest<TrackEventResponse>(resolved.api, {
        method: 'POST',
        path: '/v1/events',
        body,
      });
      if (!res.ok) {
        return res.error;
      }
      const r = res.data;
      return textResult(
        `Tracked ${input.name}. Contact created: ${r.contactCreated}. Workflows triggered: ${r.workflowsTriggered}. Waiting executions resumed: ${r.executionsResumed}.`,
        {
          id: input.contactId ?? null,
          success: r.success,
          contactCreated: r.contactCreated,
          workflowsTriggered: r.workflowsTriggered,
          executionsResumed: r.executionsResumed,
        }
      );
    }
  );
}
