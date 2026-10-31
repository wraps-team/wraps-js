import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

/**
 * Mirrors POST /v1/segments/preview in apps/api/src/routes/segments.ts.
 * The route is a POST but it writes nothing, so this tool is class R.
 */

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 100;

const OPERATORS =
  'equals, notEquals, contains, notContains, startsWith, endsWith, greaterThan, lessThan, greaterThanOrEqual, lessThanOrEqual, exists, notExists, inList, notInList, within, hasTopic, notHasTopic, triggered, triggeredWithin, notTriggered, inBucket';

const FilterSchema = z.looseObject({
  field: z
    .string()
    .min(1)
    .describe(
      'A contact property or status, e.g. "properties.plan" or "topics", or an event as "event.<name>".'
    ),
  operator: z.string().describe(`One of: ${OPERATORS}.`),
  value: z
    .unknown()
    .optional()
    .describe('Comparison value. Lists take an array. inBucket takes { buckets, index }.'),
  unit: z
    .enum(['days', 'hours', 'minutes'])
    .optional()
    .describe('Time unit for within and triggeredWithin.'),
});

const GroupSchema = z.looseObject({
  filters: z.array(FilterSchema),
  nested: z.unknown().optional().describe('Optional nested condition with the same shape.'),
});

const ConditionSchema = z
  .looseObject({
    logic: z.enum(['AND', 'OR']).describe('How the groups combine.'),
    groups: z.array(GroupSchema),
  })
  .describe(
    'Filter condition: { logic: "AND" | "OR", groups: [{ filters: [{ field, operator, value?, unit? }] }] }. The API validates it and returns a 400 message if a filter is incomplete.'
  );

const PreviewSegmentInputSchema = {
  condition: ConditionSchema,
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .describe(`How many sample emails to return (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
};

const PreviewSegmentOutputSchema = {
  id: z
    .null()
    .describe(
      'Always null. A preview is not a saved record, so it has no id. Use create_segment to save.'
    ),
  count: z
    .number()
    .int()
    .describe('Full sendable audience size for the condition, not capped by limit.'),
  sample: z.array(z.string()).describe('Up to `limit` sample email addresses from the audience.'),
  sampleTruncated: z
    .boolean()
    .describe(
      'True when count is larger than the sample, so the sample is truncated. Size the audience from count.'
    ),
};

type PreviewApi = { count: number; sample: string[] };

export function registerPreviewSegment(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'preview_segment',
    {
      description:
        'Preview the audience an unsaved filter condition would reach, without saving a segment. Use this before create_segment or update_segment to check the count and see sample emails. It writes nothing and needs no write permission. Not paginated: each call returns one result with `count` (the full audience) and up to `limit` sample emails (default 5, max 100). The sample is truncated to `limit`; when `sampleTruncated` is true, more recipients exist than were sampled, so judge size from `count`. Requires a Wraps Pro plan or higher.',
      inputSchema: PreviewSegmentInputSchema,
      outputSchema: PreviewSegmentOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<PreviewApi>(resolved.api, {
        method: 'POST',
        path: '/v1/segments/preview',
        body: { condition: input.condition, limit: input.limit },
      });
      if (!result.ok) {
        return result.error;
      }
      const { count, sample } = result.data;
      const sampleTruncated = count > sample.length;
      const summary = `This condition reaches ${count} sendable contact(s). Showing ${sample.length} sample email(s)${sampleTruncated ? ', so the sample is truncated' : ''}.`;
      return textResult(summary, { id: null, count, sample, sampleTruncated });
    }
  );
}
