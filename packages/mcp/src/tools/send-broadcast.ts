import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const SendBroadcastInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('Id of a DRAFT broadcast, from list_broadcasts or duplicate_broadcast.'),
  awsAccountId: z
    .string()
    .min(1)
    .max(36)
    .describe('Id of the connected AWS account to send from. Must belong to this organization.'),
  totalRecipients: z
    .number()
    .int()
    .min(0)
    .describe(
      'Recipient count for this send. The API stores the number as given and does not recount, so pass the audience size you have confirmed.'
    ),
  scheduledFor: z
    .string()
    .optional()
    .describe(
      'ISO 8601 time to send at. Omit to send now. A time in the past is refused, not sent immediately.'
    ),
  confirm: confirmSchema,
};

const SendBroadcastOutputSchema = {
  id: z.string(),
  status: z.string().describe('queued (sending now) or scheduled (sends at scheduledFor).'),
  warning: z
    .string()
    .optional()
    .describe(
      'Set when the send was accepted but will not happen as expected, e.g. scheduling is not configured.'
    ),
};

interface ApiSendResponse {
  id: string;
  status: string;
  warning?: string;
}

export function registerSendBroadcast(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'send_broadcast',
    {
      description:
        'Send a DRAFT broadcast to its audience, now or at scheduledFor. This is irreversible: emails or SMS messages are delivered to real recipients and cannot be recalled. Only drafts can be sent; for any other status the API refuses. Draft content is fixed when the draft is created (create_broadcast) and can only be changed in the dashboard, so check it there before sending; this tool sends the draft as it is. Requires confirm: true, and only after the user has confirmed the broadcast, the audience and the sending account. Requires WRAPS_WRITE_ENABLED=true. It returns a single record with the new status, so nothing is truncated. To stop a scheduled or queued send, use cancel_broadcast.',
      inputSchema: SendBroadcastInputSchema,
      outputSchema: SendBroadcastOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const refused = requireWrite(config);
      if (refused) {
        return refused;
      }
      const notConfirmed = requireConfirm(input);
      if (notConfirmed) {
        return notConfirmed;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const { id, confirm: _confirm, ...body } = input;
      const result = await apiRequest<ApiSendResponse>(resolved.api, {
        method: 'POST',
        path: `/v1/batch/${seg(id)}/send`,
        body,
      });
      if (!result.ok) {
        return result.error;
      }
      const sent = result.data;
      const text = sent.warning
        ? `Broadcast ${sent.id} is ${sent.status}. Warning: ${sent.warning}`
        : `Broadcast ${sent.id} is ${sent.status}. Track it with get_broadcast.`;
      return textResult(text, {
        id: sent.id,
        status: sent.status,
        ...(sent.warning ? { warning: sent.warning } : {}),
      });
    }
  );
}
