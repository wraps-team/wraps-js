import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const DeleteContactInputSchema = {
  id: z
    .string()
    .min(1)
    .max(255)
    .describe('The contact to delete: its UUID, its email address, or your externalId.'),
  confirm: confirmSchema,
};

const DeleteContactOutputSchema = {
  id: z.string().describe('The contact id that was deleted.'),
  deleted: z.literal(true).describe('True when the API confirmed the delete.'),
};

export function registerDeleteContact(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'delete_contact',
    {
      description:
        'Permanently delete ONE contact by UUID, email, or externalId. This cannot be undone: the contact record is removed from Wraps. Requires confirm: true, and set it only after the user has confirmed which contact to delete. To stop emailing a contact without deleting it, use update_contact (emailStatus) or set_contact_topics instead. Pagination does not apply: this acts on a single record. Truncation: nothing is truncated; it deletes at most the one contact named. Writes are gated: this needs WRAPS_WRITE_ENABLED=true.',
      inputSchema: DeleteContactInputSchema,
      outputSchema: DeleteContactOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const gated = requireWrite(config);
      if (gated) {
        return gated;
      }
      const confirmed = requireConfirm(input);
      if (confirmed) {
        return confirmed;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<{ success: boolean }>(resolved.api, {
        method: 'DELETE',
        path: `/v1/contacts/${seg(input.id)}`,
      });
      if (!res.ok) {
        return res.error;
      }

      return textResult(`Deleted contact ${input.id}. This cannot be undone.`, {
        id: input.id,
        deleted: true as const,
      });
    }
  );
}
