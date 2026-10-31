import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const ListEventNamesOutputSchema = {
  total: z.number().int().describe('Number of distinct event names returned.'),
  names: z
    .array(
      z.object({
        id: z.string().describe('The event name. Same value as name.'),
        name: z.string().describe("Exact event name, e.g. 'purchase.completed'."),
      })
    )
    .describe('Every distinct event name for this organization, sorted.'),
};

export function registerListEventNames(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_event_names',
    {
      description:
        'List every distinct custom event name recorded for this Wraps organization, sorted. Use this first when you need the exact spelling of an event name, for example before filtering list_events by eventName. Pagination: none, a single call returns every name. Truncation: nothing is truncated; the list is complete. Read-only. Requires contacts:read.',
      inputSchema: {},
      outputSchema: ListEventNamesOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const res = await apiRequest<{ eventNames: string[] }>(resolved.api, {
        method: 'GET',
        path: '/v1/events/names',
      });
      if (!res.ok) {
        return res.error;
      }
      const names = res.data.eventNames.map((name) => ({ id: name, name }));
      return textResult(
        names.length === 0
          ? 'No custom event names have been recorded for this organization yet.'
          : `${names.length} distinct event names: ${names.map((n) => n.name).join(', ')}.`,
        { total: names.length, names }
      );
    }
  );
}
