import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

/** POST /v1/templates/:id/publish. Responds with `{ success, sesTemplateName, publishedAt }`; it has no `id`. */
type PublishResponse = {
  success: boolean;
  sesTemplateName: string;
  publishedAt: string;
};

const PublishTemplateInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('Id of the template to publish, from list_templates or get_template.'),
  awsAccountId: z
    .string()
    .min(1)
    .max(36)
    .optional()
    .describe(
      'Id of the connected AWS account whose SES gets the template. Pass it whenever the organization has more than one AWS account; without it the API uses the first account it finds.'
    ),
  confirm: confirmSchema.describe(
    'Must be true. Requires confirm: true. Publishing overwrites the live SES template that sends and workflows use, so set it only after the user has agreed to publish this template.'
  ),
};

const PublishTemplateOutputSchema = {
  id: z.string().describe('The template id that was published (echoed from the input).'),
  success: z.boolean(),
  sesTemplateName: z.string().describe('Name of the SES template that now holds the content.'),
  publishedAt: z.string().describe('ISO 8601 publish time.'),
};

export function registerPublishTemplate(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'publish_template',
    {
      description:
        'Publish a Wraps template to SES, so sends and workflows that use it get this content. It creates or overwrites the SES template under the generated name and marks the template PUBLISHED. Requires confirm: true. Irreversible: the previous SES content is overwritten and this tool cannot restore it (the template history is kept in Wraps, but publish does not roll back). Preconditions: the template needs a subject and compiledHtml, or the API refuses with an error that names the fix. Requires WRAPS_WRITE_ENABLED=true. Pagination: not paginated; this returns a single result. Truncation: none.',
      inputSchema: PublishTemplateInputSchema,
      outputSchema: PublishTemplateOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const denied = requireWrite(config);
      if (denied) {
        return denied;
      }
      const refused = requireConfirm(input);
      if (refused) {
        return refused;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }

      const res = await apiRequest<PublishResponse>(resolved.api, {
        method: 'POST',
        path: `/v1/templates/${seg(input.id)}/publish`,
        body: input.awsAccountId ? { awsAccountId: input.awsAccountId } : undefined,
      });
      if (!res.ok) {
        return res.error;
      }

      const { success, sesTemplateName, publishedAt } = res.data;
      return textResult(
        `Published template ${input.id} to SES as ${sesTemplateName} at ${publishedAt}. Live sends that use this template now use this content.`,
        { id: input.id, success, sesTemplateName, publishedAt }
      );
    }
  );
}
