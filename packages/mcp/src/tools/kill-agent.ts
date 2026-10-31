import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const KillAgentInput = {
  id: z
    .string()
    .min(1)
    .max(255)
    .describe('The agent id from list_agents. The API checks it belongs to this organization.'),
  confirm: confirmSchema,
};

const KillAgentOutput = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string().describe('KILLED when the call succeeded.'),
  syncStatus: z
    .enum(['synced', 'skipped', 'failed'])
    .describe(
      "synced: the kill reached the agent's enforcer. skipped: the agent was never deployed, so there was no enforcer to update. failed: the kill is saved in Wraps but did not reach the enforcer."
    ),
  warning: z.string().optional().describe('Set when syncStatus is failed.'),
});

/**
 * Kill one agent: set its status to KILLED so it can no longer send. Destructive and
 * irreversible. Calls `POST /v1/agents/:id/kill`.
 */
export function registerKillAgent(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'kill_agent',
    {
      description:
        "Kill one leashed agent: set its status to KILLED so it can no longer send email. Requires confirm: true. Irreversible: the kill revokes the agent's sending, and no API route returns a killed agent to ACTIVE; a killed agent's policy also can no longer change. Requires WRAPS_WRITE_ENABLED=true. Requires an organization owner or admin: an API key follows its creator's current role, so a 403 means the key's creator is not an owner or admin now. For a deployed agent the kill is pushed to its enforcer. If that push fails, the result is a non-success line saying the kill is incomplete and the agent may still send; call kill_agent again to retry the push. Not registered in enforced mode (WRAPS_AGENT_ID set), the same as approve and reject. Pagination: none; this acts on one record. Truncation: not applicable, nothing is cut and hasMore is never set.",
      inputSchema: KillAgentInput,
      outputSchema: KillAgentOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (input) => {
      const writeRefusal = requireWrite(config);
      if (writeRefusal) {
        return writeRefusal;
      }
      const confirmRefusal = requireConfirm(input);
      if (confirmRefusal) {
        return confirmRefusal;
      }
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }

      const result = await apiRequest<{
        agent: { id: string; name: string; status: string };
        syncStatus: 'synced' | 'skipped' | 'failed';
        warning?: string;
      }>(credential.api, {
        method: 'POST',
        path: `/v1/agents/${seg(input.id)}/kill`,
      });
      if (!result.ok) {
        return result.error;
      }

      const { agent, syncStatus, warning } = result.data;
      const structuredContent = {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        syncStatus,
        ...(warning ? { warning } : {}),
      };

      if (syncStatus === 'failed') {
        // The kill was saved, but the enforcer may still allow sends. That is not a success.
        const detail = warning ? ` ${warning}` : '';
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Kill INCOMPLETE for agent ${agent.name} (${agent.id}). The agent is KILLED in Wraps, but the kill did not reach its enforcer, so the agent may still send.${detail} Call kill_agent again with confirm: true to retry the push.`,
            },
          ],
          structuredContent,
        };
      }

      const note =
        syncStatus === 'skipped'
          ? ' It was never deployed, so there was no enforcer to update.'
          : '';
      return textResult(
        `Killed agent ${agent.name} (${agent.id}). It can no longer send email.${note}`,
        structuredContent
      );
    }
  );
}
