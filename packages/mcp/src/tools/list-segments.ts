import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

/** Mirrors GET /v1/segments in apps/api/src/routes/segments.ts. */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const ListSegmentsInputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`Segments per page (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Zero-based index of the first segment to return (default 0). Pass nextOffset to continue.'
    ),
  search: z
    .string()
    .optional()
    .describe('Text search over segment names, passed to the API as `search`.'),
};

const SegmentItemSchema = z.object({
  id: z
    .string()
    .describe('Stable segment id. Pass it to get_segment, update_segment, or delete_segment.'),
  name: z.string(),
  description: z.string().nullable(),
  memberCount: z
    .number()
    .describe('Live count of contacts a broadcast to this segment would reach right now.'),
  trackMembership: z.boolean(),
  lastComputedAt: z.string().nullable().describe('ISO 8601, or null if never computed.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
});

const ListSegmentsOutputSchema = {
  segments: z.array(SegmentItemSchema),
  total: z.number().int().describe('Total segments matching the filter, across all pages.'),
  limit: z.number().int(),
  offset: z.number().int(),
  hasMore: z
    .boolean()
    .describe(
      'True when another page exists. Continue with offset = nextOffset while this is true.'
    ),
  nextOffset: z
    .number()
    .int()
    .nullable()
    .describe('The offset to pass for the next page, or null on the last page.'),
};

type ListSegmentsApi = {
  segments: z.infer<typeof SegmentItemSchema>[];
  total: number;
  limit: number;
  offset: number;
};

export function registerListSegments(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_segments',
    {
      description:
        "List the audience segments saved in this Wraps organization, with each segment's live member count. Use this to find a segment id before get_segment, update_segment, or delete_segment, or to choose the audience for a broadcast. To check what a filter would match before saving it, use preview_segment instead. Paginated: each call returns one page of at most `limit` segments (default 20, max 100). Continue by passing `offset` = `nextOffset` from the response while `hasMore` is true. The result is truncated to one page per call, so a page without a given segment is not proof that the segment does not exist; narrow with `search` or continue paging. Requires a Wraps Pro plan or higher.",
      inputSchema: ListSegmentsInputSchema,
      outputSchema: ListSegmentsOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<ListSegmentsApi>(resolved.api, {
        method: 'GET',
        path: '/v1/segments',
        query: { limit: input.limit, offset: input.offset, search: input.search },
      });
      if (!result.ok) {
        return result.error;
      }
      const page = result.data;
      const offset = page.offset;
      const end = offset + page.segments.length;
      const hasMore = end < page.total;
      const nextOffset = hasMore ? end : null;
      const summary = hasMore
        ? `Showing segments ${offset + 1}-${end} of ${page.total}. More exist: call again with offset ${end}.`
        : `Showing segments ${page.segments.length ? `${offset + 1}-${end}` : 'none'} of ${page.total}. This is the last page.`;
      return textResult(summary, {
        segments: page.segments,
        total: page.total,
        limit: page.limit,
        offset,
        hasMore,
        nextOffset,
      });
    }
  );
}
