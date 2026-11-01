import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, seg, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { confirmSchema, requireConfirm, requireWrite } from '../tool-guards.ts';

const AgentPolicy = z.object({
  maxPerHour: z.number().min(0).describe('Max sends per rolling hour. 0 flags every send.'),
  maxPerDay: z.number().min(0).describe('Max sends per rolling day. 0 flags every send.'),
  allowedRecipients: z
    .array(z.string().max(320))
    .max(100)
    .describe('Exact recipient addresses always allowed. At most 100.'),
  allowedRecipientDomains: z
    .array(z.string().max(320))
    .max(100)
    .describe('Recipient domains always allowed. At most 100.'),
});

const SetAgentPolicyInput = {
  id: z
    .string()
    .min(1)
    .max(255)
    .describe('The agent id from list_agents. The API checks it belongs to this organization.'),
  policy: AgentPolicy.describe(
    'The complete new policy. It replaces the stored caps and both allowlists in full, so send all four fields. A partial policy is refused by the API.'
  ),
  confirm: confirmSchema,
};

const SetAgentPolicyOutput = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  policy: AgentPolicy.describe('The policy now stored for the agent.'),
  syncStatus: z
    .enum(['synced', 'skipped', 'failed'])
    .describe(
      "synced: the new policy reached the agent's enforcer. skipped: the agent was never deployed, so there was no enforcer to update. failed: the policy is saved in Wraps but did not reach the enforcer."
    ),
  warning: z.string().optional().describe('Set when syncStatus is failed.'),
});

/**
 * Replace one agent's send policy (caps and both recipient allowlists). Destructive: it
 * overwrites the previous policy. Calls `PATCH /v1/agents/:id/policy`.
 */
export function registerSetAgentPolicy(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'set_agent_policy',
    {
      description:
        "Replace one leashed agent's send policy: its hourly and daily send caps and its recipient allowlists. This replaces the stored caps and both allowlists in full, so send the complete policy with all four fields (maxPerHour, maxPerDay, allowedRecipients, allowedRecipientDomains); a partial policy is refused. Requires confirm: true, because the previous policy is overwritten. Requires WRAPS_WRITE_ENABLED=true. Requires an organization owner or admin: an API key follows its creator's current role, so a 403 means the key's creator is not an owner or admin now. A killed agent is refused with 409 and its policy stays as it was. For a deployed agent the new policy is pushed to its enforcer. If that push fails, the result is a non-success line saying the agent is still enforcing its previous policy until you retry. Not registered in enforced mode (WRAPS_AGENT_ID set). Pagination: none; this acts on one record. Truncation: not applicable, nothing is cut and hasMore is never set; each allowlist holds at most 100 entries.",
      inputSchema: SetAgentPolicyInput,
      outputSchema: SetAgentPolicyOutput,
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
        agent: { id: string; name: string; status: string; policy: z.infer<typeof AgentPolicy> };
        syncStatus: 'synced' | 'skipped' | 'failed';
        warning?: string;
      }>(credential.api, {
        method: 'PATCH',
        path: `/v1/agents/${seg(input.id)}/policy`,
        body: {
          maxPerHour: input.policy.maxPerHour,
          maxPerDay: input.policy.maxPerDay,
          allowedRecipients: input.policy.allowedRecipients,
          allowedRecipientDomains: input.policy.allowedRecipientDomains,
        },
      });
      if (!result.ok) {
        return result.error;
      }

      const { agent, syncStatus, warning } = result.data;
      const structuredContent = {
        id: agent.id,
        name: agent.name,
        status: agent.status,
        policy: agent.policy,
        syncStatus,
        ...(warning ? { warning } : {}),
      };

      if (syncStatus === 'failed') {
        // The policy was saved, but the enforcer still runs the previous one. Not a success.
        const detail = warning ? ` ${warning}` : '';
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: `Policy INCOMPLETE for agent ${agent.name} (${agent.id}). The new policy is saved in Wraps, but it did not reach the enforcer, so the agent is still enforcing its previous policy.${detail} Call set_agent_policy again with confirm: true to retry the push.`,
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
        `Replaced the send policy of agent ${agent.name} (${agent.id}): ${agent.policy.maxPerHour} per hour, ${agent.policy.maxPerDay} per day, ${agent.policy.allowedRecipients.length} allowed addresses, ${agent.policy.allowedRecipientDomains.length} allowed domains. The previous policy is gone.${note}`,
        structuredContent
      );
    }
  );
}
