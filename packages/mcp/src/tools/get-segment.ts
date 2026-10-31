import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

/** Mirrors GET /v1/segments/:id in apps/api/src/routes/segments.ts. */

const GetSegmentInputSchema = {
  id: z.string().min(1).max(36).describe('The segment id, from list_segments or create_segment.'),
};

const GetSegmentOutputSchema = {
  id: z.string().describe('Stable segment id.'),
  name: z.string(),
  description: z.string().nullable(),
  condition: z
    .record(z.string(), z.unknown())
    .describe('The saved filter condition as stored: { logic: "AND" | "OR", groups: [...] }.'),
  memberCount: z
    .number()
    .describe('Live count of contacts a broadcast to this segment would reach right now.'),
  trackMembership: z.boolean(),
  lastComputedAt: z.string().nullable().describe('ISO 8601, or null if never computed.'),
  createdAt: z.string().describe('ISO 8601.'),
  updatedAt: z.string().describe('ISO 8601.'),
};

type SegmentRecord = z.infer<z.ZodObject<typeof GetSegmentOutputSchema>>;

export function registerGetSegment(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_segment',
    {
      description:
        'Get one audience segment by id, including its full filter condition and live member count. Use this when you need the condition (for example before editing it with update_segment), or to confirm a segment exists. To find ids, use list_segments. Returns a single record: it is not paginated, and nothing in it is truncated, so the condition is complete. Requires a Wraps Pro plan or higher.',
      inputSchema: GetSegmentInputSchema,
      outputSchema: GetSegmentOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<SegmentRecord>(resolved.api, {
        method: 'GET',
        path: `/v1/segments/${seg(input.id)}`,
      });
      if (!result.ok) {
        return result.error;
      }
      const segment = result.data;
      return textResult(
        `Segment "${segment.name}" (${segment.id}) has ${segment.memberCount} live member(s).`,
        segment
      );
    }
  );
}
