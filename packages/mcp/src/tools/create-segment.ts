import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

/** Mirrors POST /v1/segments in apps/api/src/routes/segments.ts. Class W: reversible, needs WRAPS_WRITE_ENABLED=true. */

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
    'Filter condition: { logic: "AND" | "OR", groups: [{ filters: [{ field, operator, value?, unit? }] }] }. The API validates it and returns a 400 message if a filter is incomplete. Preview it with preview_segment first.'
  );

const CreateSegmentInputSchema = {
  name: z.string().min(1).max(200).describe('Segment name, up to 200 characters.'),
  description: z.string().optional().describe('Optional description. Empty text saves none.'),
  condition: ConditionSchema,
  trackMembership: z
    .boolean()
    .optional()
    .describe('Whether the segment keeps a membership history. Default false.'),
};

const CreateSegmentOutputSchema = {
  id: z
    .string()
    .describe(
      'Stable id of the new segment. Use it with get_segment, update_segment, or delete_segment.'
    ),
  name: z.string(),
  description: z.string().nullable(),
  condition: z.record(z.string(), z.unknown()).describe('The stored filter condition.'),
  memberCount: z.number().describe('Live sendable recipient count at creation time.'),
  trackMembership: z.boolean(),
  lastComputedAt: z.string().nullable().describe('ISO 8601, set at creation.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
};

type CreatedSegment = z.infer<z.ZodObject<typeof CreateSegmentOutputSchema>>;

export function registerCreateSegment(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'create_segment',
    {
      description:
        'Save a new audience segment from a filter condition. Use preview_segment first to check the audience, then this to save it. The condition is validated and its member count is taken at creation time. Writes one segment, which can be changed with update_segment or removed with delete_segment. Requires WRAPS_WRITE_ENABLED=true. Returns a single record (the new segment with its id and memberCount); it is not paginated, and nothing in it is truncated. Requires a Wraps Pro plan or higher.',
      inputSchema: CreateSegmentInputSchema,
      outputSchema: CreateSegmentOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const refusal = requireWrite(config);
      if (refusal) {
        return refusal;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<CreatedSegment>(resolved.api, {
        method: 'POST',
        path: '/v1/segments',
        body: {
          name: input.name,
          description: input.description,
          condition: input.condition,
          trackMembership: input.trackMembership,
        },
      });
      if (!result.ok) {
        return result.error;
      }
      const segment = result.data;
      return textResult(
        `Created segment "${segment.name}" (${segment.id}) with ${segment.memberCount} member(s) at creation.`,
        segment
      );
    }
  );
}
