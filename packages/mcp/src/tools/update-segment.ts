import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

/** Mirrors PATCH /v1/segments/:id in apps/api/src/routes/segments.ts. Class W: reversible, needs WRAPS_WRITE_ENABLED=true. */

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
    'Filter condition: { logic: "AND" | "OR", groups: [{ filters: [{ field, operator, value?, unit? }] }] }. Passing it re-validates and re-counts the audience.'
  );

const UpdateSegmentInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('The segment id to change, from list_segments or create_segment.'),
  name: z.string().min(1).max(200).optional().describe('New name, up to 200 characters.'),
  description: z
    .string()
    .optional()
    .describe('New description. Pass an empty string "" to clear it.'),
  condition: ConditionSchema.optional().describe(
    'New filter condition. Replaces the old one and re-counts the audience.'
  ),
  trackMembership: z
    .boolean()
    .optional()
    .describe('Whether the segment keeps a membership history.'),
};

const UpdateSegmentOutputSchema = {
  id: z.string().describe('Stable segment id.'),
  name: z.string(),
  description: z.string().nullable(),
  condition: z
    .record(z.string(), z.unknown())
    .describe('The stored filter condition after the update.'),
  memberCount: z.number().describe('Live sendable recipient count after the update.'),
  trackMembership: z.boolean(),
  lastComputedAt: z
    .string()
    .nullable()
    .describe('ISO 8601. Changes when the condition is replaced.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
};

type UpdatedSegment = z.infer<z.ZodObject<typeof UpdateSegmentOutputSchema>>;

export function registerUpdateSegment(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'update_segment',
    {
      description:
        'Change an existing audience segment: rename it, edit its description, replace its condition, or toggle trackMembership. Only the fields you pass are changed. Passing a new condition re-validates it and re-counts the audience, so preview it with preview_segment first. Use get_segment to read the current values. Writes one segment, which can be changed again. Requires WRAPS_WRITE_ENABLED=true. Returns a single record (the updated segment); it is not paginated, and nothing in it is truncated. Requires a Wraps Pro plan or higher.',
      inputSchema: UpdateSegmentInputSchema,
      outputSchema: UpdateSegmentOutputSchema,
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
      const { id, ...changes } = input;
      const result = await apiRequest<UpdatedSegment>(resolved.api, {
        method: 'PATCH',
        path: `/v1/segments/${seg(id)}`,
        body: changes,
      });
      if (!result.ok) {
        return result.error;
      }
      const segment = result.data;
      return textResult(
        `Updated segment "${segment.name}" (${segment.id}). It now has ${segment.memberCount} member(s).`,
        segment
      );
    }
  );
}
