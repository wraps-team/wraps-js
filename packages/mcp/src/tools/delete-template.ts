import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

/**
 * Mirrors DELETE /v1/templates/:id and DELETE /v1/templates (body { ids }) in
 * apps/api/src/routes/templates.ts. Class X: irreversible.
 *
 * One input shape (`ids`) for both paths: one unique id uses the single-record route, more
 * than one uses the bulk route. The output is `{ deleted, notFound }` on both paths.
 */

const MAX_IDS = 100;

const DeleteTemplateInputSchema = {
  ids: z
    .array(
      z
        .string()
        .min(1)
        .max(36)
        .describe('A template id, from list_templates. Ids are case-sensitive.')
    )
    .min(1)
    .max(MAX_IDS)
    .describe(
      `The template ids to delete, 1 to ${MAX_IDS}. Get them from list_templates. The call is all-or-nothing: if any id is in use, none is deleted.`
    ),
  confirm: confirmSchema,
};

const DeleteTemplateOutputSchema = {
  deleted: z
    .array(z.string())
    .describe('The template ids that were deleted, with their versions. Empty when none were.'),
  notFound: z
    .array(z.string())
    .describe(
      'Ids that are not templates of this organization. They were skipped and nothing was deleted for them.'
    ),
};

type DeleteOneResponse = { success: true; id: string };
type DeleteBulkResponse = { deleted: number; notFound: string[] };

export function registerDeleteTemplate(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'delete_template',
    {
      description:
        "Permanently delete up to 100 email or SMS templates from the dashboard, with their versions. For each one, its published copy in SES is removed too, in each of the organization's AWS accounts, unless another template still uses the same SES template name. Irreversible: a deleted template cannot be restored, so recreate it with create_template if it is removed by mistake. All-or-nothing: if any id is used by a scheduled, queued or processing broadcast, or by an enabled workflow (a send_email or send_sms step, or a cascade channel), the whole call is refused with 409 and nothing is deleted; the message names the blocking broadcasts and workflows. Disable or cancel them first, then retry. To find ids, call list_templates first. Requires confirm: true, and set it only after the user has confirmed which templates to delete. Requires WRAPS_WRITE_ENABLED=true. Output: deleted (the ids removed) and notFound (ids that are not templates of this organization; they are skipped). A single id that is not found is an error instead of a notFound entry. Pagination: none; one call handles up to 100 ids and sends one request. Truncation: nothing is cut; a list longer than 100 is refused, not partly deleted, so split it into batches.",
      inputSchema: DeleteTemplateInputSchema,
      outputSchema: DeleteTemplateOutputSchema,
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

      const ids = [...new Set(input.ids)];

      if (ids.length === 1) {
        const [id] = ids;
        const result = await apiRequest<DeleteOneResponse>(resolved.api, {
          method: 'DELETE',
          path: `/v1/templates/${seg(id)}`,
          query: { confirm: 'true' },
        });
        if (!result.ok) {
          return result.error;
        }
        return textResult(
          `Deleted template ${id}, with its versions and any published SES copy that no other template uses.`,
          { deleted: [id], notFound: [] }
        );
      }

      const result = await apiRequest<DeleteBulkResponse>(resolved.api, {
        method: 'DELETE',
        path: '/v1/templates',
        query: { confirm: 'true' },
        body: { ids },
      });
      if (!result.ok) {
        return result.error;
      }

      const notFound = result.data.notFound;
      const deleted = ids.filter((id) => !notFound.includes(id));
      const missing =
        notFound.length > 0
          ? ` Not found in this organization, skipped: ${notFound.join(', ')}.`
          : '';
      return textResult(`Deleted ${deleted.length} template(s).${missing}`, {
        deleted,
        notFound,
      });
    }
  );
}
