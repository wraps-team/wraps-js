import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';

const GetBroadcastClicksInputSchema = {
  id: z.string().min(1).max(36).describe('Broadcast id, from list_broadcasts.'),
};

const GetBroadcastClicksOutputSchema = {
  id: z.string().describe('The broadcast id the breakdown belongs to.'),
  clicks: z
    .array(
      z.object({
        url: z.string(),
        count: z.number().describe('Clicks on this URL.'),
      })
    )
    .describe('Top clicked links, most clicked first. Capped at 50 URLs.'),
  unsubscribeCount: z
    .number()
    .describe(
      'Clicks on unsubscribe and preference-centre links. These are counted here, not in clicks.'
    ),
  totalDistinctUrls: z.number().describe('Distinct clicked URLs in the broadcast, before the cap.'),
  truncated: z
    .boolean()
    .describe(
      'True when totalDistinctUrls is more than the URLs returned in clicks. The rest are not listed.'
    ),
};

interface ApiClicksResponse {
  data: { url: string; count: number }[];
  unsubscribeCount: number;
  totalDistinctUrls: number;
  truncated: boolean;
}

export function registerGetBroadcastClicks(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'get_broadcast_clicks',
    {
      description:
        'Get the link-click breakdown for ONE broadcast: which URLs were clicked and how often, plus the unsubscribe click count. It returns a single summary record, not a paginated list, and there is no offset or page to pass. Truncation: only the top 50 URLs by click count are listed. When truncated is true, totalDistinctUrls is larger than the list and the remaining URLs are not shown, so do not treat a missing URL as zero clicks. Use list_broadcasts or get_broadcast for delivery counts instead.',
      inputSchema: GetBroadcastClicksInputSchema,
      outputSchema: GetBroadcastClicksOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async (input) => {
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const result = await apiRequest<ApiClicksResponse>(resolved.api, {
        method: 'GET',
        path: `/v1/batch/${seg(input.id)}/clicks`,
      });
      if (!result.ok) {
        return result.error;
      }
      const { data, unsubscribeCount, totalDistinctUrls, truncated } = result.data;
      const lines = data.map((c) => `${c.count} clicks: ${c.url}`);
      const footer = truncated
        ? `\n\nShowing ${data.length} of ${totalDistinctUrls} distinct URLs. The rest are truncated and not listed.`
        : '';
      return textResult(
        `${data.length === 0 ? 'No link clicks recorded.' : lines.join('\n')}\nUnsubscribe clicks: ${unsubscribeCount}.${footer}`,
        {
          id: input.id,
          clicks: data,
          unsubscribeCount,
          totalDistinctUrls,
          truncated,
        }
      );
    }
  );
}
