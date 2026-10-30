import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

/** POST /v1/templates. Responds 201 with the full detail record, or 409 when the slug is taken. */
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

const CreateTemplateInputSchema = {
  name: z.string().min(1).max(200).describe('Template name, 1 to 200 characters.'),
  slug: z
    .string()
    .regex(/^[a-z0-9-]{1,100}$/)
    .optional()
    .describe(
      'Optional URL-safe slug: lowercase letters, digits, and hyphens, up to 100 characters. Must be unique in the organization.'
    ),
  subject: z
    .string()
    .optional()
    .describe('Email subject line. Publishing needs one, so set it before publish_template.'),
  previewText: z.string().optional().describe('Inbox preview text.'),
  description: z.string().optional().describe('Internal description, not sent to recipients.'),
  emailType: z.enum(['marketing', 'transactional']).optional().describe('Default marketing.'),
  channel: z.enum(['email', 'sms']).optional().describe('Default email.'),
  source: z
    .string()
    .optional()
    .describe('React Email TSX source. The API does not compile it; pass compiledHtml too.'),
  compiledHtml: z
    .string()
    .optional()
    .describe(
      'Compiled HTML. Required before publish_template, which refuses a template without it.'
    ),
  compiledText: z.string().optional().describe('Compiled plain-text part. Optional.'),
  variables: z
    .array(
      z.object({
        name: z.string(),
        fallback: z.string().optional(),
      })
    )
    .optional()
    .describe('Template variables, each with an optional fallback value.'),
};

const CreateTemplateOutputSchema = {
  id: z.string().describe('The new template id. Use it with update_template or publish_template.'),
  name: z.string(),
  description: z.string().nullable(),
  subject: z.string().nullable(),
  previewText: z.string().nullable(),
  emailType: z.string(),
  channel: z.string(),
  status: z.string().describe('Always DRAFT for a newly created template.'),
  slug: z.string().nullable(),
  publishedAt: z.string().nullable().describe('Null: a new template is not published.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
  sourceHash: z.string().nullable(),
  variables: z.array(z.unknown()),
  lastEditedFrom: z.string().nullable(),
  source: z.string().nullable().optional(),
  compiledHtml: z.string().nullable().optional(),
  compiledText: z.string().nullable().optional(),
};

export function registerCreateTemplate(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'create_template',
    {
      description:
        'Create a new Wraps email or SMS template as a DRAFT. Use it to start a template; use update_template to change one that exists, and publish_template to send it live. A draft changes nothing that is live. The API does not compile React Email TSX, so pass compiledHtml, or publish_template will refuse the template until it is compiled. A slug must be unique in the organization: a taken slug is refused with a conflict and nothing is created. Requires WRAPS_WRITE_ENABLED=true. Pagination: not paginated; this returns a single record. Truncation: none; the created record is returned in full.',
      inputSchema: CreateTemplateInputSchema,
      outputSchema: CreateTemplateOutputSchema,
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
        path: '/v1/templates',
        body: input,
      });
      if (!res.ok) {
        return res.error;
      }

      const template = res.data;
      return textResult(
        `Created DRAFT template "${template.name}" with id ${template.id}. It is not published; call publish_template to send it.`,
        { ...template }
      );
    }
  );
}
