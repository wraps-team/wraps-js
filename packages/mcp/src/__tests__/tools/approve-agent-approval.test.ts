import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MCPConfig } from '../../config.ts';
import { loadConfig } from '../../config.ts';
import { registerApproveAgentApproval } from '../../tools/approve-agent-approval.ts';
import { registerListAgentApprovals } from '../../tools/list-agent-approvals.ts';
import { connectTool, makeApiConfig, mockApi } from '../helpers/mock-api.ts';

const APPROVAL = {
  id: 'appr_1',
  organizationId: 'org_1',
  agentId: 'agent_1',
  payload: {
    from: 'support@example.com',
    to: 'customer@example.com',
    subject: 'Your refund',
    text: 'Refund issued.',
  },
  reason: 'Recipient is outside the allowlist',
  status: 'SENT',
  decidedBy: 'user_1',
  decidedAt: '2026-10-29T09:00:00.000Z',
  messageId: 'ses-msg-1',
  errorMessage: null,
  createdAt: '2026-10-29T08:00:00.000Z',
  updatedAt: '2026-10-29T09:00:01.000Z',
};

const PATH = '/v1/agents/approvals/appr_1/approve';

function text(result: { content?: unknown }): string {
  const first = (result.content as { type: string; text: string }[] | undefined)?.[0];
  return first?.text ?? '';
}

describe('approve_agent_approval', () => {
  it('approves one held send and returns the record with its new status', async () => {
    const api = mockApi([{ method: 'POST', path: PATH, body: APPROVAL }]);
    const client = await connectTool(
      registerApproveAgentApproval,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'approve_agent_approval',
      arguments: { id: 'appr_1', confirm: true },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      id: 'appr_1',
      status: 'SENT',
      messageId: 'ses-msg-1',
      decidedBy: 'user_1',
    });
    expect(text(result)).toContain('ses-msg-1');
    expect(api.calls).toHaveLength(1);
    expect(api.calls[0]).toMatchObject({ method: 'POST', path: PATH, query: {} });
    expect(api.calls[0].body).toBeUndefined();
    expect(api.calls[0].headers.authorization).toBe('Bearer test-token-not-real');
    await client.close();
  });

  it('acts on a single record: one request, no pagination', async () => {
    const api = mockApi([{ method: 'POST', path: PATH, body: APPROVAL }]);
    const client = await connectTool(
      registerApproveAgentApproval,
      makeApiConfig({ writeEnabled: true })
    );

    await client.callTool({
      name: 'approve_agent_approval',
      arguments: { id: 'appr_1', confirm: true },
    });

    expect(api.calls).toHaveLength(1);
    expect(api.calls[0].query).not.toHaveProperty('cursor');
    await client.close();
  });

  it('maps an approval already decided (409) to a tool error that names the state', async () => {
    mockApi([
      {
        method: 'POST',
        path: PATH,
        status: 409,
        body: { error: 'Approval already REJECTED' },
      },
    ]);
    const client = await connectTool(
      registerApproveAgentApproval,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'approve_agent_approval',
      arguments: { id: 'appr_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Conflict');
    expect(text(result)).toContain('Approval already REJECTED');
    await client.close();
  });

  it('maps a non-owner or non-admin caller (403) to a tool error that names the role fix', async () => {
    mockApi([
      {
        method: 'POST',
        path: PATH,
        status: 403,
        body: { error: 'This action requires an organization owner or admin' },
      },
    ]);
    const client = await connectTool(
      registerApproveAgentApproval,
      makeApiConfig({ writeEnabled: true })
    );

    const result = await client.callTool({
      name: 'approve_agent_approval',
      arguments: { id: 'appr_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('Permission denied');
    expect(text(result)).toContain('organization owner or admin');
    await client.close();
  });

  it('refuses when write is disabled, and sends no request', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerApproveAgentApproval,
      makeApiConfig({ writeEnabled: false })
    );

    const result = await client.callTool({
      name: 'approve_agent_approval',
      arguments: { id: 'appr_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('WRAPS_WRITE_ENABLED=true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it.each([
    ['missing', {}],
    ['false', { confirm: false }],
    ['the string "true"', { confirm: 'true' }],
  ])('refuses when confirm is %s, and sends no request', async (_label, extra) => {
    const api = mockApi([]);
    const client = await connectTool(
      registerApproveAgentApproval,
      makeApiConfig({ writeEnabled: true })
    );

    let refused: { isError: boolean; text: string } | { thrown: string };
    try {
      const result = await client.callTool({
        name: 'approve_agent_approval',
        arguments: { id: 'appr_1', ...extra },
      });
      refused = { isError: result.isError === true, text: text(result) };
    } catch (err) {
      refused = { thrown: err instanceof Error ? err.message : String(err) };
    }

    expect(refused).toMatchObject({ isError: true });
    expect((refused as { text: string }).text).toContain('confirm must be true');
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  it('refuses without sending a request when no Wraps credential is configured', async () => {
    const api = mockApi([]);
    const client = await connectTool(
      registerApproveAgentApproval,
      makeApiConfig({ writeEnabled: true, api: null })
    );

    const result = await client.callTool({
      name: 'approve_agent_approval',
      arguments: { id: 'appr_1', confirm: true },
    });

    expect(result.isError).toBe(true);
    expect(api.calls).toHaveLength(0);
    await client.close();
  });

  describe('enforced mode (WRAPS_AGENT_ID and WRAPS_AGENT_ENFORCER_ARN set)', () => {
    // Real config derivation: loadConfig() reads these variables and the HOME directory. HOME is
    // pointed at an empty temp dir so no developer ~/.wraps session can leak in.
    const ENV_KEYS = [
      'HOME',
      'WRAPS_API_KEY',
      'WRAPS_API_URL',
      'WRAPS_ORG_ID',
      'WRAPS_HOME',
      'WRAPS_WRITE_ENABLED',
      'WRAPS_AGENT_ID',
      'WRAPS_AGENT_ENFORCER_ARN',
    ];
    const saved: Record<string, string | undefined> = {};
    let home: string;

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'wraps-approve-gate-'));
      for (const key of ENV_KEYS) {
        saved[key] = process.env[key];
        delete process.env[key];
      }
      process.env.HOME = home;
      process.env.WRAPS_API_KEY = 'wraps_test_key_not_real';
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
      for (const key of ENV_KEYS) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }
      vi.unstubAllGlobals();
      rmSync(home, { recursive: true, force: true });
    });

    // The same wiring as the registration.md insert for this tool, in tools/index.ts. The list
    // tool is registered too, as index does, so the server always advertises tools and
    // listTools() answers.
    const wireLikeIndex = (server: McpServer, config: MCPConfig) => {
      if (config.api) {
        registerListAgentApprovals(server, config);
        if (!config.enforcedMode) {
          registerApproveAgentApproval(server, config);
        }
      }
    };

    it('is not registered when WRAPS_AGENT_ID and WRAPS_AGENT_ENFORCER_ARN are set', async () => {
      process.env.WRAPS_AGENT_ID = 'agent_1';
      process.env.WRAPS_AGENT_ENFORCER_ARN =
        'arn:aws:lambda:us-east-1:123456789012:function:enforcer';
      const config = loadConfig();
      // Guard against a vacuous pass: the config must really be enforced and carry a credential,
      // otherwise the wiring above would skip registration for the wrong reason.
      expect(config.enforcedMode).toBe(true);
      expect(config.api).toBeDefined();

      const client = await connectTool(wireLikeIndex, config);
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain('list_agent_approvals');
      expect(names).not.toContain('approve_agent_approval');
      await client.close();
    });

    it('is registered outside enforced mode, so the gate is not hiding it everywhere', async () => {
      const config = loadConfig();
      expect(config.enforcedMode).toBe(false);
      expect(config.api).toBeDefined();

      const client = await connectTool(wireLikeIndex, config);
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain('approve_agent_approval');
      await client.close();
    });
  });

  it('is destructive, requires confirm: true, and says why it is not offered in enforced mode', async () => {
    const client = await connectTool(
      registerApproveAgentApproval,
      makeApiConfig({ writeEnabled: true })
    );

    const tools = await client.listTools();
    const tool = tools.tools.find((t) => t.name === 'approve_agent_approval');
    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.description).toMatch(/Requires confirm: true/);
    expect(tool?.description).toMatch(/enforced agent/);
    expect(tool?.description).toMatch(/cannot approve its own sends/);
    await client.close();
  });
});
