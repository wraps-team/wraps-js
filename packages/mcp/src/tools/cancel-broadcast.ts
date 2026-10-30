import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const CancelBroadcastInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('Id of a broadcast in scheduled, queued or processing status, from list_broadcasts.'),
  confirm: confirmSchema,
};

const CancelBroadcastOutputSchema = {
  id: z.string(),
  success: z.boolean(),
  status: z.string().describe('cancelled after a successful cancel.'),
};

interface ApiCancelResponse {
  success: boolean;
  id: string;
  status: string;
}

export function registerCancelBroadcast(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'cancel_broadcast',
    {
      description:
        'Cancel a broadcast that is scheduled, queued or processing, so the messages that have not gone out yet are not sent. Cancelling a scheduled broadcast also removes its schedule. Messages already delivered are not recalled, and a cancelled broadcast cannot be restarted with this tool; use duplicate_broadcast to make a new draft from it. Broadcasts in any other status are refused by the API. Requires confirm: true, and only after the user has agreed to stop the send. Requires WRAPS_WRITE_ENABLED=true. It returns a single record, so nothing is truncated.',
      inputSchema: CancelBroadcastInputSchema,
      outputSchema: CancelBroadcastOutputSchema,
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
      const result = await apiRequest<ApiCancelResponse>(resolved.api, {
        method: 'DELETE',
        path: `/v1/batch/${seg(input.id)}`,
      });
      if (!result.ok) {
        return result.error;
      }
      return textResult(
        `Cancelled broadcast ${result.data.id}. Messages that had not gone out will not be sent. Messages already delivered cannot be recalled.`,
        { id: result.data.id, success: result.data.success, status: result.data.status }
      );
    }
  );
}
