import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

/**
 * Mirrors DELETE /v1/segments/:id in apps/api/src/routes/segments.ts. Class X: irreversible.
 * The route itself takes no `confirm` query; the gate here is the MCP-level `confirm: true`.
 */

const DeleteSegmentInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('The segment id to delete, from list_segments. Deleting cannot be undone.'),
  confirm: confirmSchema,
};

const DeleteSegmentOutputSchema = {
  id: z.string().describe('The id of the segment that was deleted.'),
  deleted: z.boolean().describe('True when the API confirmed the deletion.'),
};

type DeleteResponse = { success: boolean };

export function registerDeleteSegment(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'delete_segment',
    {
      description:
        'Permanently delete an audience segment. Irreversible: the segment cannot be restored, so recreate it with create_segment if it is removed by mistake. Refused while a scheduled, queued, or processing broadcast still targets the segment (cancel or wait for that broadcast first). Use list_segments to confirm the id first. Requires confirm: true and WRAPS_WRITE_ENABLED=true. Returns a single record (the deleted id and deleted: true); it is not paginated, and nothing in it is truncated.',
      inputSchema: DeleteSegmentInputSchema,
      outputSchema: DeleteSegmentOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const refusal = requireWrite(config);
      if (refusal) {
        return refusal;
      }
      const confirmRefusal = requireConfirm(input);
      if (confirmRefusal) {
        return confirmRefusal;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<DeleteResponse>(resolved.api, {
        method: 'DELETE',
        path: `/v1/segments/${seg(input.id)}`,
      });
      if (!result.ok) {
        return result.error;
      }
      const deleted = result.data.success === true;
      return textResult(`Deleted segment ${input.id}.`, { id: input.id, deleted });
    }
  );
}
