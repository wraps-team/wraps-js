import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

/** POST /v1/templates/:id/duplicate. Responds 201 with the full detail record of the copy. */
type TemplateDetail = {
  id: string;
  name: string;
  description: string | null;
  subject: string | null;
  previewText: string | null;
  emailType: string;
  channel: string;
  status: string;
  slug: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  sourceHash: string | null;
  variables: unknown[];
  lastEditedFrom: string | null;
  source?: string | null;
  compiledHtml?: string | null;
  compiledText?: string | null;
};

const DuplicateTemplateInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('Id of the template to copy, from list_templates or get_template.'),
};

const DuplicateTemplateOutputSchema = {
  id: z.string().describe('Id of the new copy. Use it with update_template or publish_template.'),
  name: z.string().describe('The original name with " (Copy)" appended.'),
  description: z.string().nullable(),
  subject: z.string().nullable(),
  previewText: z.string().nullable(),
  emailType: z.string(),
  channel: z.string(),
  status: z.string().describe('Always DRAFT: a copy is never published.'),
  slug: z.string().nullable().describe('Null: a copy does not carry the original slug.'),
  publishedAt: z.string().nullable().describe('Null: a copy is not published.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
  sourceHash: z.string().nullable(),
  variables: z.array(z.unknown()),
  lastEditedFrom: z.string().nullable(),
  source: z.string().nullable().optional(),
  compiledHtml: z.string().nullable().optional(),
  compiledText: z.string().nullable().optional(),
};

export function registerDuplicateTemplate(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'duplicate_template',
    {
      description:
        'Copy an existing Wraps template to start a variant. The copy is a new DRAFT named "<name> (Copy)" with the same content, subject, preview text, channel, and compiled HTML. Its slug and publish state are not copied, so it never goes live by itself: publish it separately with publish_template. Use list_templates or get_template to find the id. Requires WRAPS_WRITE_ENABLED=true. Pagination: not paginated; this returns a single record (the new copy). Truncation: none; the copy is returned in full.',
      inputSchema: DuplicateTemplateInputSchema,
      outputSchema: DuplicateTemplateOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const denied = requireWrite(config);
      if (denied) {
        return denied;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }

      const res = await apiRequest<TemplateDetail>(resolved.api, {
        method: 'POST',
        path: `/v1/templates/${seg(input.id)}/duplicate`,
      });
      if (!res.ok) {
        return res.error;
      }

      const copy = res.data;
      return textResult(
        `Created DRAFT copy "${copy.name}" with id ${copy.id}. It is not published; call publish_template to send it.`,
        { ...copy }
      );
    }
  );
}
