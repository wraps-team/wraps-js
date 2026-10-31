import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const DeleteBrandKitInput = {
  id: z.string().max(36).describe('The brand kit to delete, from list_brand_kits.'),
  confirm: confirmSchema,
};

const DeleteBrandKitOutput = z.object({
  id: z.string().describe('The id of the brand kit that was deleted.'),
  success: z.literal(true),
});

/**
 * Delete a brand kit. Destructive and irreversible, so it is an X tool: it needs
 * `WRAPS_WRITE_ENABLED=true` and `confirm: true`. Calls
 * `DELETE /v1/brand-kits/:id?confirm=true`.
 */
export function registerDeleteBrandKit(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'delete_brand_kit',
    {
      description:
        'Delete a brand kit permanently. Requires confirm: true. Irreversible: the kit cannot be restored, and any email template that used it loses the link to it (the template itself survives). If the kit was the default, another remaining kit is promoted to default. Confirm with the user which kit it is before calling; read it with get_brand_kit first. Needs WRAPS_WRITE_ENABLED=true. Pagination: none; this removes a single record and makes one request. Truncation: not applicable, nothing is cut and hasMore is never set.',
      inputSchema: DeleteBrandKitInput,
      outputSchema: DeleteBrandKitOutput,
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

      const result = await apiRequest<{ success: true }>(credential.api, {
        method: 'DELETE',
        path: `/v1/brand-kits/${seg(input.id)}`,
        query: { confirm: 'true' },
      });
      if (!result.ok) {
        return result.error;
      }
      return textResult(`Deleted brand kit ${input.id}. This cannot be undone.`, {
        id: input.id,
        success: true as const,
      });
    }
  );
}
