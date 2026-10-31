import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

const UpdateBroadcastInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('Id of a draft or scheduled broadcast, from list_broadcasts.'),
  channel: z.enum(['email', 'sms']).optional(),
  name: z.string().max(255).nullable().optional(),
  audienceType: z
    .enum(['all', 'topic', 'segment'])
    .optional()
    .describe('Audience type. Set topicId or segmentId to match it.'),
  topicId: z.string().max(36).nullable().optional(),
  segmentId: z.string().max(36).nullable().optional(),
  subject: z.string().max(998).nullable().optional(),
  previewText: z.string().max(500).nullable().optional(),
  from: z.string().max(255).nullable().optional(),
  fromName: z.string().max(100).nullable().optional(),
  replyTo: z.string().max(255).nullable().optional(),
  templateId: z.string().max(36).nullable().optional(),
  htmlContent: z.string().nullable().optional(),
  variableMappings: z
    .array(
      z.object({
        variableName: z.string(),
        source: z.union([
          z.object({ type: z.literal('static'), value: z.string() }),
          z.object({ type: z.literal('contact'), field: z.string() }),
        ]),
      })
    )
    .nullable()
    .optional(),
  body: z.string().max(1600).nullable().optional().describe('SMS body text.'),
  senderId: z.string().max(20).nullable().optional().describe('SMS sender id.'),
  scheduledFor: z
    .string()
    .optional()
    .describe(
      'New send time, ISO 8601, in the future. Omit to keep the current time. Cannot be null: a scheduled broadcast cannot be unscheduled or sent now through this tool.'
    ),
  awsAccountId: z
    .string()
    .max(36)
    .optional()
    .describe('AWS account to send from. Must belong to this organization.'),
  totalRecipients: z
    .number()
    .optional()
    .describe('Recipient count to store for the send, when the caller has a new audience count.'),
};

const UpdateBroadcastOutputSchema = {
  id: z.string(),
  status: z
    .string()
    .describe('draft or scheduled, unchanged by the edit: editing never sends or schedules.'),
  scheduledFor: z
    .string()
    .nullable()
    .describe('The send time now in effect, ISO 8601; null for a draft with no planned time.'),
  warning: z
    .string()
    .optional()
    .describe(
      'Set when the edit was saved but the broadcast will not send automatically, e.g. scheduling is not configured.'
    ),
};

// The API returns the draft's summary for a draft, or { id, status, scheduledFor, warning? } for a
// scheduled broadcast. Only the fields both share are read here.
interface ApiBroadcastUpdate {
  id: string;
  status: string;
  scheduledFor: string | null;
  warning?: string;
}

export function registerUpdateBroadcast(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'update_broadcast',
    {
      description:
        'Edit a DRAFT or a SCHEDULED broadcast: its content, sender, audience, template, AWS account or send time. Any other status (queued, processing, completed, failed or cancelled) is refused with a 409 that names the status. Only the fields you pass change; pass null to clear a nullable content field. A draft stays a draft (send it with send_broadcast). For a scheduled broadcast, changing scheduledFor reschedules the send: the old schedule is removed and the new one set. Moving the time EARLIER can make the broadcast send sooner, as soon as the new time is more than about a minute away. An edit is refused with a 409 within the last minute before the send time, or once sending has started, so cancel it instead. The edit never sends anything: a scheduled broadcast stays scheduled and goes out at the time now in effect. A time in the past is refused. It returns a single record (id, status, scheduledFor), not a list, so nothing is truncated. Writes are reversible: the broadcast can be edited again or cancelled. Requires WRAPS_WRITE_ENABLED=true.',
      inputSchema: UpdateBroadcastInputSchema,
      outputSchema: UpdateBroadcastOutputSchema,
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
      const { id, ...fields } = input;
      const result = await apiRequest<ApiBroadcastUpdate>(resolved.api, {
        method: 'PATCH',
        path: `/v1/batch/${seg(id)}`,
        body: fields,
      });
      if (!result.ok) {
        return result.error;
      }
      const u = result.data;
      const text =
        u.status === 'draft'
          ? `Updated draft broadcast ${u.id}. It is still a draft. Nothing was sent.`
          : u.warning
            ? `Updated scheduled broadcast ${u.id}. It sends at ${u.scheduledFor}. Warning: ${u.warning}`
            : `Updated scheduled broadcast ${u.id}. It is still ${u.status} and sends at ${u.scheduledFor}. Nothing was sent.`;
      return textResult(text, {
        id: u.id,
        status: u.status,
        scheduledFor: u.scheduledFor,
        ...(u.warning ? { warning: u.warning } : {}),
      });
    }
  );
}
