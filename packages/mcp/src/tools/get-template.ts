import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

/** GET /v1/templates/:id. Returns the full detail record; `source=false` omits the three source fields. */
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

const GetTemplateInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('Template id, from list_templates or a create/update result.'),
  source: z
    .boolean()
    .optional()
    .describe(
      'Default true. Set false to leave out source, compiledHtml, and compiledText. sourceHash is still returned, so you can tell whether the source changed.'
    ),
};

const GetTemplateOutputSchema = {
  id: z.string().describe('Template id.'),
  name: z.string(),
  description: z.string().nullable(),
  subject: z.string().nullable(),
  previewText: z.string().nullable(),
  emailType: z.string().describe('marketing or transactional.'),
  channel: z.string().describe('email or sms.'),
  status: z.string().describe('DRAFT, PUBLISHED, or ARCHIVED.'),
  slug: z.string().nullable(),
  publishedAt: z.string().nullable().describe('ISO 8601, null until published.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
  sourceHash: z
    .string()
    .nullable()
    .describe('Hash of the source; compare across reads to detect edits.'),
  variables: z.array(z.unknown()).describe('Template variables with optional fallbacks.'),
  lastEditedFrom: z
    .string()
    .nullable()
    .describe('Where the last edit came from, e.g. api or dashboard.'),
  source: z
    .string()
    .nullable()
    .optional()
    .describe('React Email TSX source. Absent when source=false.'),
  compiledHtml: z
    .string()
    .nullable()
    .optional()
    .describe('Compiled HTML that publish_template sends. Absent when source=false.'),
  compiledText: z
    .string()
    .nullable()
    .optional()
    .describe('Compiled plain text. Absent when source=false.'),
};

export function registerGetTemplate(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_template',
    {
      description:
        'Get one Wraps template by id: its metadata, status, variables, and by default its React Email source, compiled HTML, and compiled text. Use it after list_templates, or to read a template before update_template or publish_template. Returns a single record, not a page, so there is no pagination. Truncation: the record is not truncated, and source, compiledHtml, and compiledText come back in full unless you pass source=false to leave them out. A 404 means no template with that id exists in this organization.',
      inputSchema: GetTemplateInputSchema,
      outputSchema: GetTemplateOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }

      const res = await apiRequest<TemplateDetail>(resolved.api, {
        method: 'GET',
        path: `/v1/templates/${seg(input.id)}`,
        query: { source: input.source },
      });
      if (!res.ok) {
        return res.error;
      }

      const template = res.data;
      return textResult(`Template "${template.name}" (${template.status}, ${template.channel}).`, {
        ...template,
      });
    }
  );
}
