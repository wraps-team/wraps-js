import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

/** GET /v1/templates. The route returns `{ data, nextCursor }`, with `limit` 1-100 (default 20). */
type ListTemplatesResponse = {
  data: TemplateSummary[];
  nextCursor: string | null;
};

type TemplateSummary = {
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
};

const ListTemplatesInputSchema = {
  limit: z.number().int().min(1).max(100).optional().describe('Page size, 1 to 100. Default 20.'),
  cursor: z
    .string()
    .optional()
    .describe(
      'Continue from the previous page: pass its nextCursor here. Omit it for the first page.'
    ),
  status: z
    .enum(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
    .optional()
    .describe('Only templates in this status.'),
  channel: z.enum(['email', 'sms']).optional().describe('Only templates for this channel.'),
  search: z.string().max(200).optional().describe('Case-insensitive match on the template name.'),
};

const templateSummarySchema = z.object({
  id: z
    .string()
    .describe('Template id. Pass it to get_template, update_template, or publish_template.'),
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
});

const ListTemplatesOutputSchema = {
  templates: z
    .array(templateSummarySchema)
    .describe('One page of template summaries. No source or compiled HTML; use get_template.'),
  nextCursor: z
    .string()
    .nullable()
    .describe('Pass as cursor to fetch the next page. Null on the last page.'),
  hasMore: z
    .boolean()
    .describe(
      'True when more templates exist beyond this page. Same as nextCursor being non-null.'
    ),
};

export function registerListTemplates(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_templates',
    {
      description:
        'List the Wraps email and SMS templates in your organization. Use it to find a template id, then get_template for the full record (source and compiled HTML). Paginated: each call returns one page. When hasMore is true, call again with cursor set to nextCursor, and stop when nextCursor is null. `limit` defaults to 20 and is capped at 100. Filter with status, channel, or search (name). Truncation: a page is cut at `limit`, and hasMore tells you whether more exist. A list with hasMore true is not proof that a template is absent, so keep paginating or narrow the filters before you conclude it does not exist.',
      inputSchema: ListTemplatesInputSchema,
      outputSchema: ListTemplatesOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }

      const res = await apiRequest<ListTemplatesResponse>(resolved.api, {
        method: 'GET',
        path: '/v1/templates',
        query: {
          limit: input.limit,
          cursor: input.cursor,
          status: input.status,
          channel: input.channel,
          search: input.search,
        },
      });
      if (!res.ok) {
        return res.error;
      }

      const templates = res.data.data;
      const nextCursor = res.data.nextCursor;
      const hasMore = nextCursor !== null;
      const more = hasMore
        ? ' More pages exist: call again with cursor set to nextCursor.'
        : ' This is the last page.';
      return textResult(`Found ${templates.length} template(s).${more}`, {
        templates,
        nextCursor,
        hasMore,
      });
    }
  );
}
