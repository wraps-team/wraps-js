import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';

const AgentPolicy = z.object({
  maxPerHour: z.number().describe('Max sends per rolling hour. 0 flags every send.'),
  maxPerDay: z.number().describe('Max sends per rolling day. 0 flags every send.'),
  allowedRecipients: z.array(z.string()).describe('Exact recipient addresses always allowed.'),
  allowedRecipientDomains: z.array(z.string()).describe('Recipient domains always allowed.'),
});

const AgentRecord = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  emailAddress: z.string(),
  domain: z.string(),
  status: z
    .string()
    .describe('ACTIVE or KILLED. A KILLED agent cannot send and its policy cannot change.'),
  policy: AgentPolicy,
  credentialUserArn: z.string().nullable(),
  enforcerFunctionArn: z.string().nullable(),
  awsAccountId: z
    .string()
    .nullable()
    .describe(
      'The Wraps id of the AWS account the agent is deployed to. Null until the agent is deployed.'
    ),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const ListAgentsInput = {};

const ListAgentsOutput = z.object({
  agents: z.array(AgentRecord).describe('Every agent in this organization, active and killed.'),
});

/**
 * List the leashed agents (named senders with their own address and send policy) in this
 * organization. Read-only. Calls `GET /v1/agents`.
 */
export function registerListAgents(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'list_agents',
    {
      description:
        'List the leashed agents in this Wraps organization: named senders, each with its own email address, a send policy (hourly and daily caps and recipient allowlists) and a status of ACTIVE or KILLED. Use the id from here with kill_agent and set_agent_policy. Read-only. Pagination: none; the route returns every agent in one response, so there is no cursor to pass. Truncation: nothing is cut and hasMore is never set, so a short list is complete.',
      inputSchema: ListAgentsInput,
      outputSchema: ListAgentsOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }

      const result = await apiRequest<z.infer<typeof ListAgentsOutput>>(credential.api, {
        method: 'GET',
        path: '/v1/agents',
      });
      if (!result.ok) {
        return result.error;
      }

      const agents = result.data.agents ?? [];
      const killed = agents.filter((agent) => agent.status === 'KILLED').length;
      const killedNote = killed > 0 ? ` (${killed} killed)` : '';
      return textResult(
        `Found ${agents.length} agent${agents.length === 1 ? '' : 's'}${killedNote}.`,
        { agents }
      );
    }
  );
}
