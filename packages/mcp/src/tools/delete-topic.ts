import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const DeleteTopicOutput = z.object({
  id: z.string(),
  success: z.boolean(),
});

const DeleteTopicInput = {
  id: z.string().max(36).describe('The topic id to delete, from list_topics.'),
  confirm: confirmSchema,
};

/**
 * Delete a subscription topic. Destructive and irreversible, so it is an X tool: it needs
 * `WRAPS_WRITE_ENABLED=true` and `confirm: true`. Calls `DELETE /v1/topics/:id?confirm=true`.
 */
export function registerDeleteTopic(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'delete_topic',
    {
      description:
        'Permanently delete a subscription topic and every subscription to it. This cannot be undone, and broadcasts that target the topic stop reaching its subscribers. Confirm with the user first. Requires confirm: true, and needs WRAPS_WRITE_ENABLED=true. Returns a single result: pagination does not apply, and nothing is truncated (hasMore is never set). A 404 means no topic with that id exists in this organization. Requires a Pro plan or higher.',
      inputSchema: DeleteTopicInput,
      outputSchema: DeleteTopicOutput,
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
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }
      const result = await apiRequest<{ success: boolean }>(credential.api, {
        method: 'DELETE',
        path: `/v1/topics/${seg(input.id)}`,
        query: { confirm: 'true' },
      });
      if (!result.ok) {
        return result.error;
      }
      return textResult(`Deleted topic ${input.id}.`, {
        id: input.id,
        success: result.data.success,
      });
    }
  );
}
