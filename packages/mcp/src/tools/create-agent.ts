import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiRequest, textResult } from '../api-client.ts';
import { type MCPConfig, requireApi } from '../config.ts';
import { requireWrite } from '../tool-guards.ts';

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

const AgentRecord = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  emailAddress: z.string(),
  domain: z.string(),
  status: z.string(),
  policy: AgentPolicy,
  credentialUserArn: z.string().nullable(),
  enforcerFunctionArn: z.string().nullable(),
  awsAccountId: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const CreateAgentInput = {
  name: z
    .string()
    .min(1)
    .max(100)
    .describe('A display name for the agent, unique within the organization.'),
  emailAddress: z
    .email()
    .max(255)
    .describe(
      'The address the agent sends from, for example support-bot@example.com. Unique within the organization.'
    ),
  domain: z
    .string()
    .min(1)
    .max(255)
    .describe('The sending domain of emailAddress, for example example.com.'),
  policy: AgentPolicy.optional().describe(
    'The send policy: hourly and daily caps and recipient allowlists. Omit it to use the API default: 20 sends per hour, 100 per day, and empty allowlists. When given, all four fields are required.'
  ),
};

const CreateAgentOutput = AgentRecord;

/**
 * Create one leashed agent: a named sender with its own address and a send policy. Writes.
 * Calls `POST /v1/agents`.
 */
export function registerCreateAgent(server: McpServer, config: MCPConfig): void {
  server.registerTool(
    'create_agent',
    {
      description:
        "Create one leashed agent: a named sender with its own email address and a send policy (hourly and daily caps and recipient allowlists). The agent starts ACTIVE. This records the agent in Wraps only; it does not create the AWS resources it sends through, which are deployed with the CLI (wraps email agent create). Requires WRAPS_WRITE_ENABLED=true. Requires an organization owner or admin: an API key follows its creator's current role, so a 403 means the key's creator is not an owner or admin now. Fails with 409 when the name or the email address already exists in this organization. Pagination: none; this creates one record. Truncation: not applicable, nothing is cut and hasMore is never set.",
      inputSchema: CreateAgentInput,
      outputSchema: CreateAgentOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (input) => {
      const writeRefusal = requireWrite(config);
      if (writeRefusal) {
        return writeRefusal;
      }
      const credential = requireApi(config);
      if (!credential.ok) {
        return credential.error;
      }

      const result = await apiRequest<z.infer<typeof CreateAgentOutput>>(credential.api, {
        method: 'POST',
        path: '/v1/agents',
        body: {
          name: input.name,
          emailAddress: input.emailAddress,
          domain: input.domain,
          ...(input.policy ? { policy: input.policy } : {}),
        },
      });
      if (!result.ok) {
        return result.error;
      }

      const agent = result.data;
      return textResult(
        `Created agent ${agent.name} (${agent.id}) sending as ${agent.emailAddress}. Status ${agent.status}. It is recorded in Wraps only; its AWS resources are not created by this call.`,
        agent
      );
    }
  );
}
