import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import type { MCPConfig } from '../config.ts';
import { requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const ResumeBroadcastInputSchema = {
  id: z
    .string()
    .min(1)
    .max(36)
    .describe('Id of a broadcast in processing or failed status, from list_broadcasts.'),
  fromChunkIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Operator override: restart from this chunk with a fresh cursor. Omit to resume from the last completed chunk, which is the normal choice.'
    ),
  confirm: confirmSchema,
};

const ResumeBroadcastOutputSchema = {
  id: z.string(),
  resumed: z.boolean(),
  fromChunkIndex: z.number().describe('The chunk the send restarts from.'),
};

interface ApiResumeResponse {
  resumed: boolean;
  fromChunkIndex: number;
}

export function registerResumeBroadcast(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'resume_broadcast',
    {
      description:
        'Resume an email broadcast that stopped part-way, from the last chunk it finished, so recipients who were not yet sent to get the message. Only broadcasts in processing or failed status, and only email (not SMS), can be resumed; the API refuses others. Resending to recipients who already got the message is possible when fromChunkIndex is set, so only pass it when you have checked the recipient list. Sending is irreversible for the recipients it reaches. Requires confirm: true, and only after the user has agreed. Requires WRAPS_WRITE_ENABLED=true. Returns a single record, so nothing is truncated. The API can disable resume by configuration; a 503 means it is off and to try later.',
      inputSchema: ResumeBroadcastInputSchema,
      outputSchema: ResumeBroadcastOutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const refused = requireWrite(config);
      if (refused) {
        return refused;
      }
      const notConfirmed = requireConfirm(input);
      if (notConfirmed) {
        return notConfirmed;
      }
      const resolved = requireApi(config);
      if (!resolved.ok) {
        return resolved.error;
      }
      const body =
        input.fromChunkIndex === undefined ? undefined : { fromChunkIndex: input.fromChunkIndex };
      const result = await apiRequest<ApiResumeResponse>(resolved.api, {
        method: 'POST',
        path: `/v1/batch/${seg(input.id)}/resume`,
        body,
      });
      if (!result.ok) {
        return result.error;
      }
      return textResult(
        `Resumed broadcast ${input.id} from chunk ${result.data.fromChunkIndex}. Track it with get_broadcast.`,
        { id: input.id, resumed: result.data.resumed, fromChunkIndex: result.data.fromChunkIndex }
      );
    }
  );
}
