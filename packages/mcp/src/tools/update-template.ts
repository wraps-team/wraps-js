import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, errorResult, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

/** PATCH /v1/templates/:id. Partial update; responds with the full detail record, or 409 on a stale `ifUnmodifiedSince`. */
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

const UpdateTemplateInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('Template id to update, from list_templates or create_template.'),
  name: z.string().min(1).max(200).optional().describe('New name, 1 to 200 characters.'),
  subject: z.string().optional().describe('New subject line.'),
  previewText: z.string().optional().describe('New inbox preview text.'),
  description: z.string().optional().describe('New internal description.'),
  emailType: z.enum(['marketing', 'transactional']).optional(),
  channel: z.enum(['email', 'sms']).optional(),
  source: z
    .string()
    .optional()
    .describe(
      'New React Email TSX source. When it differs from the latest saved version, a new version is recorded.'
    ),
  compiledHtml: z
    .string()
    .optional()
    .describe('New compiled HTML. publish_template needs it, so set it when the source changes.'),
  compiledText: z.string().optional().describe('New compiled plain-text part.'),
  variables: z
    .array(
      z.object({
        name: z.string(),
        fallback: z.string().optional(),
      })
    )
    .optional()
    .describe('Replaces the whole variables list, each with an optional fallback.'),
  ifUnmodifiedSince: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe(
      'Optimistic-concurrency guard: an ISO 8601 time, usually the updatedAt you last read. If the template changed after it, the update is refused with a conflict and nothing is written. Omit it for last-write-wins.'
    ),
};

const UpdateTemplateOutputSchema = {
  id: z.string().describe('Template id.'),
  name: z.string(),
  description: z.string().nullable(),
  subject: z.string().nullable(),
  previewText: z.string().nullable(),
  emailType: z.string(),
  channel: z.string(),
  status: z.string(),
  slug: z.string().nullable(),
  publishedAt: z.string().nullable().describe('ISO 8601, null until published.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601. Use it as ifUnmodifiedSince on your next update.'),
  sourceHash: z.string().nullable(),
  variables: z.array(z.unknown()),
  lastEditedFrom: z.string().nullable(),
  source: z.string().nullable().optional(),
  compiledHtml: z.string().nullable().optional(),
  compiledText: z.string().nullable().optional(),
};

const EDITABLE_FIELDS = [
  'name',
  'subject',
  'previewText',
  'description',
  'emailType',
  'channel',
  'source',
  'compiledHtml',
  'compiledText',
  'variables',
] as const;

export function registerUpdateTemplate(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'update_template',
    {
      description:
        'Change an existing Wraps template. Send only the fields to change; omitted fields keep their value. Last-write-wins unless ifUnmodifiedSince is set: then a template changed after that time is refused with a conflict and nothing is written, so re-read it with get_template before retrying. Updating does not publish: live sends keep using the last published version until you call publish_template. Requires WRAPS_WRITE_ENABLED=true. Pagination: not paginated; this returns a single record. Truncation: none; the updated record is returned in full.',
      inputSchema: UpdateTemplateInputSchema,
      outputSchema: UpdateTemplateOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const denied = requireWrite(config);
      if (denied) {
        return denied;
      }
      const changed = EDITABLE_FIELDS.filter((field) => input[field] !== undefined);
      if (changed.length === 0) {
        return errorResult(
          'No fields to update. Pass at least one field to change (for example subject or compiledHtml). Nothing was changed.'
        );
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }

      const { id, ...body } = input;
      const res = await apiRequest<TemplateDetail>(resolved.api, {
        method: 'PATCH',
        path: `/v1/templates/${seg(id)}`,
        body,
      });
      if (!res.ok) {
        return res.error;
      }

      const template = res.data;
      return textResult(
        `Updated template "${template.name}" (${template.status}). Changed: ${changed.join(', ')}. Publishing is a separate step (publish_template).`,
        { ...template }
      );
    }
  );
}
