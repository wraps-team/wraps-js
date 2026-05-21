import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WrapsEmail } from '@wraps.dev/email';
import { z } from 'zod';
import type { MCPConfig } from '../config.ts';

const ListSuppressionsInputSchema = {
  reason: z.enum(['BOUNCE', 'COMPLAINT']).optional(),
};

export function registerListSuppressions(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_suppressions',
    {
      description:
        'List email addresses currently on the SES suppression list. Optionally filter by reason (BOUNCE or COMPLAINT).',
      inputSchema: ListSuppressionsInputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const email = new WrapsEmail({ region: config.region });
      try {
        const result = await email.suppression.list({ reason: input.reason });

        if (result.entries.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No suppressed addresses found.' }] };
        }

        const text = result.entries
          .map((e) => `${e.email} — ${e.reason} (since ${e.lastUpdated.toISOString()})`)
          .join('\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Failed to list suppressions: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      } finally {
        email.destroy();
      }
    }
  );
}
