import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

const DuplicateBroadcastInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe(
      'Id of the broadcast to copy. It can be in any status: draft, scheduled, queued, processing, completed, failed or cancelled.'
    ),
};

const DuplicateBroadcastOutputSchema = {
  id: z.string().describe('Id of the NEW draft. Use it with get_broadcast or send_broadcast.'),
  status: z.string().describe('Always draft.'),
  name: z.string().nullable().describe('The source name with " (copy)" appended.'),
};

interface ApiDuplicate {
  id: string;
  status: string;
  name: string | null;
}

export function registerDuplicateBroadcast(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'duplicate_broadcast',
    {
      description:
        'Copy an existing broadcast into a NEW draft, whatever the status of the original. Use it to resend or reuse a past broadcast, or to get a new draft from a sent or queued one. The copy keeps the content, audience and sender, appends " (copy)" to the name, and drops the schedule. Nothing is sent: the new draft only goes out when send_broadcast is called on it. Draft content cannot be edited through the API, so check the copy in the dashboard before sending. Returns a single record: the new draft id, not a list, so nothing is truncated. Requires WRAPS_WRITE_ENABLED=true.',
      inputSchema: DuplicateBroadcastInputSchema,
      outputSchema: DuplicateBroadcastOutputSchema,
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
      const result = await apiRequest<ApiDuplicate>(resolved.api, {
        method: 'POST',
        path: `/v1/batch/${seg(input.id)}/duplicate`,
      });
      if (!result.ok) {
        return result.error;
      }
      const copy = result.data;
      return textResult(
        `Created draft ${copy.id} (${copy.name ?? 'unnamed'}) from broadcast ${input.id}. Nothing was sent. Check its content in the dashboard (draft content cannot be edited through the API), then send it with send_broadcast.`,
        { id: copy.id, status: copy.status, name: copy.name }
      );
    }
  );
}
