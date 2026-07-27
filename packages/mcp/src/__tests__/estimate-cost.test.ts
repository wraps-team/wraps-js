import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerEstimateCost } from '../tools/estimate-cost.ts';

const mockFetch = vi.fn();

async function connectClient(): Promise<Client> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  registerEstimateCost(server);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ text: string }> }).content;
  return content.map((c) => c.text).join('\n');
}

describe('estimate_cost', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '# Cost estimate\n\n**$144.10/month**',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('is registered with only `emails` required', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'estimate_cost');

    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['emails']);
    expect(Object.keys(tool?.inputSchema.properties ?? {})).toContain('sesPlan');
  });

  it('requests markdown from the public estimator and returns it verbatim', async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: 'estimate_cost',
      arguments: { emails: 500_000, events: 250_000, tier: 'growth', sesPlan: 'alacarte' },
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('https://wraps.dev/api/pricing/estimate?');
    expect(url).toContain('emails=500000');
    expect(url).toContain('events=250000');
    expect(url).toContain('tier=growth');
    expect(url).toContain('sesPlan=alacarte');
    expect(init.headers.Accept).toBe('text/markdown');

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('$144.10/month');
  });

  it('omits parameters the caller did not set so server defaults apply', async () => {
    const client = await connectClient();
    await client.callTool({ name: 'estimate_cost', arguments: { emails: 1000 } });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('emails=1000');
    expect(url).not.toContain('sesPlan');
    expect(url).not.toContain('tier');
  });

  it('surfaces estimator errors instead of inventing numbers', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      text: async () => '{"error":"Invalid \\"tier\\""}',
    });

    const client = await connectClient();
    const result = await client.callTool({ name: 'estimate_cost', arguments: { emails: 1000 } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('400');
  });

  it('falls back to the published pricing page when the network fails', async () => {
    mockFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND wraps.dev'));

    const client = await connectClient();
    const result = await client.callTool({ name: 'estimate_cost', arguments: { emails: 1000 } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('https://wraps.dev/pricing.md');
  });
});
