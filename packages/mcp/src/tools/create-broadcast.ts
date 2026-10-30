import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

const CreateBroadcastInputSchema = {
  channel: z
    .enum(['email', 'sms'])
    .optional()
    .describe('Channel the draft will send through. Default email.'),
  name: z.string().max(255).optional().describe('Internal name for the broadcast.'),
  subject: z.string().max(998).optional().describe('Email subject line.'),
  previewText: z.string().max(500).optional().describe('Email preview text.'),
  from: z.string().max(255).optional().describe('From email address.'),
  fromName: z.string().max(100).optional().describe('From display name.'),
  replyTo: z.string().max(255).optional().describe('Reply-to email address.'),
  templateId: z
    .string()
    .max(36)
    .optional()
    .describe('Email template id, from list_templates. Must belong to this organization.'),
  htmlContent: z.string().optional().describe('Raw HTML content, used instead of a template.'),
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
    .optional()
    .describe('Maps template variables to a static value or a contact field.'),
  body: z.string().max(1600).optional().describe('SMS body text.'),
  senderId: z
    .string()
    .max(20)
    .optional()
    .describe('SMS origination identity (phone number or alphanumeric id).'),
  recipientFilter: z
    .object({
      audienceType: z
        .enum(['all', 'topic', 'segment'])
        .optional()
        .describe('all = every contact; topic or segment = the id given below. Default all.'),
      topicId: z
        .string()
        .max(36)
        .optional()
        .describe('Topic id, from list_topics. Must belong to this organization.'),
      segmentId: z
        .string()
        .max(36)
        .optional()
        .describe('Segment id, from list_segments. Must belong to this organization.'),
    })
    .optional()
    .describe('Who the draft will be sent to.'),
  awsAccountId: z
    .string()
    .max(36)
    .optional()
    .describe(
      'AWS account to send from. Optional on a draft; must belong to this organization if given.'
    ),
};

const CreateBroadcastOutputSchema = {
  id: z.string().describe('Id of the new draft. Pass it to send_broadcast or get_broadcast.'),
  status: z.string().describe('Always draft.'),
  name: z.string().nullable(),
  channel: z.string(),
  totalRecipients: z.number(),
  processedRecipients: z.number(),
  sent: z.number(),
  delivered: z.number(),
  failed: z.number(),
  opened: z.number(),
  clicked: z.number(),
  bounced: z.number(),
  complained: z.number(),
  suppressed: z.number(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
};

interface ApiDraft {
  id: string;
  status: string;
  name: string | null;
  channel: string;
  totalRecipients: number;
  processedRecipients: number;
  sent: number;
  delivered: number;
  failed: number;
  opened: number;
  clicked: number;
  bounced: number;
  complained: number;
  suppressed: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export function registerCreateBroadcast(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'create_broadcast',
    {
      description:
        'Create a NEW broadcast as a draft. Nothing is sent or queued by this call. Set all the content and the audience now, because draft content cannot be edited through the API: subject, from address, template or HTML, audience (recipientFilter), and sender account. To send the draft, call send_broadcast with its id, confirm: true, awsAccountId and totalRecipients, after the user has agreed to the audience. Use list_templates, list_topics and list_segments to find ids. Every referenced id must belong to this organization, or the call is refused with a 404 that names it. Returns a single record (the new draft id and its counts, all zero), not a list, so pagination does not apply. Truncation: the response omits the content fields (subject, from, audience, template); call get_broadcast with the id to read them back. Requires WRAPS_WRITE_ENABLED=true.',
      inputSchema: CreateBroadcastInputSchema,
      outputSchema: CreateBroadcastOutputSchema,
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
      const result = await apiRequest<ApiDraft>(resolved.api, {
        method: 'POST',
        path: '/v1/batch/drafts',
        body: input,
      });
      if (!result.ok) {
        return result.error;
      }
      const d = result.data;
      return textResult(
        `Created draft ${d.id} (${d.name ?? 'unnamed'}). Nothing was sent. Read it back with get_broadcast; send it with send_broadcast when the user has agreed.`,
        {
          id: d.id,
          status: d.status,
          name: d.name,
          channel: d.channel,
          totalRecipients: d.totalRecipients,
          processedRecipients: d.processedRecipients,
          sent: d.sent,
          delivered: d.delivered,
          failed: d.failed,
          opened: d.opened,
          clicked: d.clicked,
          bounced: d.bounced,
          complained: d.complained,
          suppressed: d.suppressed,
          startedAt: d.startedAt,
          completedAt: d.completedAt,
          createdAt: d.createdAt,
        }
      );
    }
  );
}
