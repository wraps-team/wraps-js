import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MCPConfig } from '../config.ts';
import { loadConfig, resetAccountIdCache } from '../config.ts';
import { ConfigError } from '../errors.ts';
import { registerGetEmailEventLog } from '../tools/get-email-event-log.ts';
import { registerGetSetupStatus } from '../tools/get-setup-status.ts';
import { registerListRecentSends } from '../tools/list-recent-sends.ts';
import { registerListSuppressions } from '../tools/list-suppressions.ts';
import { registerSendEmail } from '../tools/send-email.ts';
import { registerVerifyDomainStatus } from '../tools/verify-domain-status.ts';

const {
  mockStsSend,
  mockStsRegion,
  mockStsDestroy,
  mockEmailSend,
  mockEmailDestroy,
  mockEventsList,
  mockEventsGet,
  mockSuppressionList,
  mockSuppressionGet,
  mockSesv2Send,
  capturedSesv2Commands,
  mockEmailEventsNull,
} = vi.hoisted(() => ({
  mockStsSend: vi.fn(),
  mockStsRegion: vi.fn(),
  mockStsDestroy: vi.fn(),
  mockEmailSend: vi.fn(),
  mockEmailDestroy: vi.fn(),
  mockEventsList: vi.fn(),
  mockEventsGet: vi.fn(),
  mockSuppressionList: vi.fn(),
  mockSuppressionGet: vi.fn(),
  mockSesv2Send: vi.fn(),
  capturedSesv2Commands: [] as unknown[],
  mockEmailEventsNull: { value: false },
}));

vi.mock('@aws-sdk/client-sts', () => ({
  STSClient: class MockSTSClient {
    send = mockStsSend;
    // The real client resolves region lazily through the SDK's provider chain
    // (env, then the active profile in ~/.aws/config). loadConfig() reads it
    // and always destroys the probe, so the mock must offer both.
    config = { region: mockStsRegion };
    destroy = mockStsDestroy;
  },
  GetCallerIdentityCommand: class MockGetCallerIdentityCommand {},
}));

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class MockSESv2Client {
    send = mockSesv2Send;
    destroy = vi.fn();
  },
  GetEmailIdentityCommand: class MockGetEmailIdentityCommand {
    constructor(input: unknown) {
      capturedSesv2Commands.push(input);
    }
  },
  GetAccountCommand: class MockGetAccountCommand {
    constructor(input: unknown) {
      capturedSesv2Commands.push(input);
    }
  },
}));

vi.mock('@wraps.dev/email', () => ({
  WrapsEmail: class MockWrapsEmail {
    send = mockEmailSend;
    destroy = mockEmailDestroy;
    events = mockEmailEventsNull.value ? null : { list: mockEventsList, get: mockEventsGet };
    suppression = { list: mockSuppressionList, get: mockSuppressionGet };
  },
}));

describe('loadConfig()', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.WRAPS_HISTORY_TABLE_NAME;
    delete process.env.WRAPS_ACCOUNT_ID;
    delete process.env.WRAPS_WRITE_ENABLED;
    delete process.env.WRAPS_FROM_EMAIL;
    delete process.env.WRAPS_AGENT_ID;
    delete process.env.WRAPS_AGENT_ENFORCER_ARN;
    vi.clearAllMocks();
    mockStsSend.mockReset();
    mockStsDestroy.mockReset();
    // Default: nothing in the SDK chain supplies a region, matching a machine
    // with no AWS_REGION and no profile. Tests that exercise the fallback
    // override this.
    mockStsRegion.mockReset();
    mockStsRegion.mockRejectedValue(new Error('Region is missing'));
    resetAccountIdCache();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws ConfigError when no env var, profile, or SDK default supplies a region', async () => {
    await expect(loadConfig()).rejects.toThrow(ConfigError);
    await expect(loadConfig()).rejects.toThrow(/region/i);
  });

  it('names every way to supply a region without ranking them', async () => {
    const error = await loadConfig().catch((err: Error) => err);
    const message = (error as Error).message;
    expect(message).toContain('AWS_REGION');
    expect(message).toContain('AWS_DEFAULT_REGION');
    expect(message).toContain('AWS_PROFILE');
    expect(message).toContain('MCP');
  });

  it('falls back to the active AWS profile region when no env var is set', async () => {
    mockStsRegion.mockResolvedValue('eu-west-2');
    process.env.WRAPS_ACCOUNT_ID = '123456789012';
    const config = await loadConfig();
    expect(config.region).toBe('eu-west-2');
    expect(mockStsDestroy).toHaveBeenCalled();
  });

  it('prefers AWS_REGION over the profile region without probing the SDK', async () => {
    mockStsRegion.mockResolvedValue('eu-west-2');
    process.env.AWS_REGION = 'us-east-1';
    process.env.WRAPS_ACCOUNT_ID = '123456789012';
    const config = await loadConfig();
    expect(config.region).toBe('us-east-1');
    expect(mockStsRegion).not.toHaveBeenCalled();
  });

  it('returns full config with default historyTableName when WRAPS_HISTORY_TABLE_NAME not set', async () => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.WRAPS_ACCOUNT_ID = '123456789012';
    const config = await loadConfig();
    expect(config).toEqual({
      region: 'us-east-1',
      historyTableName: 'wraps-email-history',
      accountId: '123456789012',
      writeEnabled: false,
      fromEmail: undefined,
      allowedRecipients: [],
      allowedRecipientDomains: [],
      maxRecipients: 50,
      allowFromOverride: false,
      enforcedMode: false,
    });
  });

  it('resolves full config via STS GetCallerIdentity when WRAPS_ACCOUNT_ID not set', async () => {
    process.env.AWS_REGION = 'us-east-1';
    mockStsSend.mockResolvedValue({ Account: '999888777666' });
    const config = await loadConfig();
    expect(config).toEqual({
      region: 'us-east-1',
      historyTableName: 'wraps-email-history',
      accountId: '999888777666',
      writeEnabled: false,
      fromEmail: undefined,
      allowedRecipients: [],
      allowedRecipientDomains: [],
      maxRecipients: 50,
      allowFromOverride: false,
      enforcedMode: false,
    });
    expect(mockStsSend).toHaveBeenCalledOnce();
  });

  it('uses WRAPS_ACCOUNT_ID directly and skips STS when set', async () => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.WRAPS_ACCOUNT_ID = '111222333444';
    const config = await loadConfig();
    expect(config).toEqual({
      region: 'us-east-1',
      historyTableName: 'wraps-email-history',
      accountId: '111222333444',
      writeEnabled: false,
      fromEmail: undefined,
      allowedRecipients: [],
      allowedRecipientDomains: [],
      maxRecipients: 50,
      allowFromOverride: false,
      enforcedMode: false,
    });
    expect(mockStsSend).not.toHaveBeenCalled();
  });

  it('throws ConfigError when STS GetCallerIdentity returns no Account field', async () => {
    process.env.AWS_REGION = 'us-east-1';
    mockStsSend.mockResolvedValue({ Account: undefined });
    await expect(loadConfig()).rejects.toThrow(ConfigError);
    await expect(loadConfig()).rejects.toThrow(/Account ID/i);
  });

  it('throws ConfigError when WRAPS_MAX_RECIPIENTS contains trailing garbage like "50x"', async () => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.WRAPS_ACCOUNT_ID = '123456789012';
    process.env.WRAPS_MAX_RECIPIENTS = '50x';
    await expect(loadConfig()).rejects.toThrow(ConfigError);
    await expect(loadConfig()).rejects.toThrow(/WRAPS_MAX_RECIPIENTS/);
  });

  it('derives enforcedMode: true only when BOTH WRAPS_AGENT_ID and WRAPS_AGENT_ENFORCER_ARN are set (with alias ARN)', async () => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.WRAPS_ACCOUNT_ID = '123456789012';
    process.env.WRAPS_AGENT_ID = 'agent-abc';
    process.env.WRAPS_AGENT_ENFORCER_ARN =
      'arn:aws:lambda:us-east-1:123456789012:function:wraps-agent-enforcer:agent-abc';
    const config = await loadConfig();
    expect(config.enforcedMode).toBe(true);
    expect(config.agentId).toBe('agent-abc');
    expect(config.enforcerFunction).toBe(
      'arn:aws:lambda:us-east-1:123456789012:function:wraps-agent-enforcer:agent-abc'
    );
  });

  it('derives enforcedMode: false when only WRAPS_AGENT_ID is set (AND, not OR)', async () => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.WRAPS_ACCOUNT_ID = '123456789012';
    process.env.WRAPS_AGENT_ID = 'agent-abc';
    const config = await loadConfig();
    expect(config.enforcedMode).toBe(false);
    expect(config.enforcerFunction).toBeUndefined();
  });

  it('derives enforcedMode: false when only WRAPS_AGENT_ENFORCER_ARN is set (AND, not OR)', async () => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.WRAPS_ACCOUNT_ID = '123456789012';
    process.env.WRAPS_AGENT_ENFORCER_ARN =
      'arn:aws:lambda:us-east-1:123456789012:function:wraps-agent-enforcer:agent-abc';
    const config = await loadConfig();
    expect(config.enforcedMode).toBe(false);
    expect(config.agentId).toBeUndefined();
  });
});

const baseConfig: MCPConfig = {
  region: 'us-east-1',
  historyTableName: 'wraps-email-history',
  accountId: '123456789012',
  writeEnabled: true,
  fromEmail: 'noreply@example.com',
  configurationSetName: undefined,
  allowedRecipients: [],
  allowedRecipientDomains: [],
  maxRecipients: 50,
  allowFromOverride: false,
  agentId: undefined,
  enforcerFunction: undefined,
  enforcedMode: false,
};

async function createTestClient(
  register: (server: McpServer, config: MCPConfig) => void,
  config: MCPConfig = baseConfig
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = new McpServer({ name: 'test', version: '1.0' });
  register(server, config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0' });
  await client.connect(clientTransport);
  return { client, cleanup: () => client.close() };
}

function getText(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

describe('send_email tool', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls WrapsEmail.send() with correct to, from (default), subject, html and returns success text', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-123', requestId: 'req-1' });
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        from: 'noreply@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
      })
    );
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toBe('Email sent successfully. messageId: msg-123');
  });

  it('accepts an array of recipients and returns success text with messageId', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-456', requestId: 'req-2' });
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: ['a@example.com', 'b@example.com'], subject: 'Hello', text: 'Hi' },
    });
    await cleanup();
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['a@example.com', 'b@example.com'] })
    );
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toBe('Email sent successfully. messageId: msg-456');
  });

  it('returns isError: true with WRAPS_WRITE_ENABLED message when write is disabled', async () => {
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      writeEnabled: false,
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', text: 'Hi' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('WRAPS_WRITE_ENABLED');
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('returns isError: true with from-address message when no from is configured', async () => {
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      fromEmail: undefined,
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('WRAPS_FROM_EMAIL');
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('returns isError: true when neither html nor text body is provided', async () => {
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('html');
    expect(getText(result)).toContain('text');
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('forwards configurationSetName from config to email.send()', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-789', requestId: 'req-3' });
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      configurationSetName: 'my-config-set',
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', text: 'Hi' },
    });
    await cleanup();
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ configurationSetName: 'my-config-set' })
    );
    expect(result.isError).toBeUndefined();
  });

  it('returns isError: true with error message when send() throws', async () => {
    mockEmailSend.mockRejectedValueOnce(new Error('SES rate limit exceeded'));
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Failed to send email: SES rate limit exceeded');
  });
});

describe('send_email sandbox guidance', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns simulator guidance, mentions sandbox, and preserves the original SES message on an unverified-recipient rejection', async () => {
    const rejected = Object.assign(
      new Error(
        'Email address is not verified. The following identities failed the check in region US-EAST-1: someone@example.com'
      ),
      { name: 'MessageRejected' }
    );
    mockEmailSend.mockRejectedValueOnce(rejected);
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'someone@example.com', subject: 'Hello', text: 'Hi' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('success@simulator.amazonses.com');
    expect(text).toContain('sandbox');
    expect(text).toContain(
      'Email address is not verified. The following identities failed the check in region US-EAST-1: someone@example.com'
    );
  });

  it('does not mention the simulator for an unrelated failure and keeps the original passthrough wording', async () => {
    mockEmailSend.mockRejectedValueOnce(new Error('Throttled'));
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', text: 'Hi' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toBe('Failed to send email: Throttled');
    expect(text).not.toContain('simulator.amazonses.com');
  });
});

describe('list_recent_sends tool', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockEmailEventsNull.value = false;
  });

  it('returns "No recent sends found." when email list is empty', async () => {
    mockEventsList.mockResolvedValueOnce({ emails: [], nextToken: undefined });
    const { client, cleanup } = await createTestClient(registerListRecentSends);
    const result = await client.callTool({ name: 'list_recent_sends', arguments: {} });
    await cleanup();
    expect(mockEventsList).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: '123456789012', maxResults: 20 })
    );
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toBe('No recent sends found.');
  });

  it('formats email rows as "[status] subject → to at ISO timestamp (id: messageId)"', async () => {
    mockEventsList.mockResolvedValueOnce({
      emails: [
        {
          messageId: 'abc-123',
          status: 'delivered',
          subject: 'Welcome',
          to: ['user@example.com'],
          sentAt: 1700000000000,
        },
      ],
      nextToken: undefined,
    });
    const { client, cleanup } = await createTestClient(registerListRecentSends);
    const result = await client.callTool({ name: 'list_recent_sends', arguments: {} });
    await cleanup();
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toBe(
      '[delivered] Welcome → user@example.com at 2023-11-14T22:13:20.000Z (id: abc-123)\n\nShowing all 1 matching sends.'
    );
  });

  it('forwards limit as maxResults to events.list()', async () => {
    mockEventsList.mockResolvedValueOnce({ emails: [], nextToken: undefined });
    const { client, cleanup } = await createTestClient(registerListRecentSends);
    await client.callTool({ name: 'list_recent_sends', arguments: { limit: 5 } });
    await cleanup();
    expect(mockEventsList).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: '123456789012', maxResults: 5 })
    );
  });

  it('converts since ISO string to Date and forwards as startTime', async () => {
    mockEventsList.mockResolvedValueOnce({ emails: [], nextToken: undefined });
    const { client, cleanup } = await createTestClient(registerListRecentSends);
    await client.callTool({
      name: 'list_recent_sends',
      arguments: { since: '2024-01-01T00:00:00Z' },
    });
    await cleanup();
    expect(mockEventsList).toHaveBeenCalledWith(
      expect.objectContaining({ startTime: new Date('2024-01-01T00:00:00Z') })
    );
  });

  it('returns isError: true when email history table is not configured', async () => {
    mockEmailEventsNull.value = true;
    const { client, cleanup } = await createTestClient(registerListRecentSends);
    const result = await client.callTool({ name: 'list_recent_sends', arguments: {} });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Email history table not configured.');
  });
});

describe('get_email_event_log tool', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockEmailEventsNull.value = false;
  });

  it('returns full formatted event log for a known messageId', async () => {
    mockEventsGet.mockResolvedValueOnce({
      messageId: 'msg-abc',
      from: 'sender@example.com',
      to: ['recipient@example.com'],
      subject: 'Test',
      status: 'delivered',
      sentAt: 1700000000000,
      lastEventAt: 1700000001000,
      events: [
        { type: 'Send', timestamp: 1700000000000 },
        { type: 'Delivery', timestamp: 1700000001000 },
      ],
    });
    const { client, cleanup } = await createTestClient(registerGetEmailEventLog);
    const result = await client.callTool({
      name: 'get_email_event_log',
      arguments: { messageId: 'msg-abc' },
    });
    await cleanup();
    expect(mockEventsGet).toHaveBeenCalledWith('msg-abc');
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toBe(
      [
        'messageId: msg-abc',
        'status: delivered',
        'from: sender@example.com',
        'to: recipient@example.com',
        'subject: Test',
        'sentAt: 2023-11-14T22:13:20.000Z',
        'events:',
        '  Send at 2023-11-14T22:13:20.000Z',
        '  Delivery at 2023-11-14T22:13:21.000Z',
      ].join('\n')
    );
  });

  it('returns "No events found" message for an unknown messageId', async () => {
    mockEventsGet.mockResolvedValueOnce(null);
    const { client, cleanup } = await createTestClient(registerGetEmailEventLog);
    const result = await client.callTool({
      name: 'get_email_event_log',
      arguments: { messageId: 'unknown-id' },
    });
    await cleanup();
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('No events recorded for messageId: unknown-id');
    // The three states must stay distinguishable: lag, wrong id, stalled pipeline.
    expect(text).toContain('does NOT mean the send failed');
    expect(text).toContain('do NOT re-send');
    expect(text).toContain('list_recent_sends');
    expect(text).toContain('wraps-email-history');
  });

  it('returns isError: true when email history table is not configured', async () => {
    mockEmailEventsNull.value = true;
    const { client, cleanup } = await createTestClient(registerGetEmailEventLog);
    const result = await client.callTool({
      name: 'get_email_event_log',
      arguments: { messageId: 'msg-abc' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Email history table not configured.');
  });
});

describe('verify_domain_status tool', () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedSesv2Commands.length = 0;
  });

  it('calls GetEmailIdentityCommand with the domain and returns all four output fields', async () => {
    mockSesv2Send.mockResolvedValueOnce({
      VerifiedForSendingStatus: true,
      DkimAttributes: { Status: 'SUCCESS', Tokens: ['token1', 'token2'] },
    });
    const { client, cleanup } = await createTestClient(registerVerifyDomainStatus);
    const result = await client.callTool({
      name: 'verify_domain_status',
      arguments: { domain: 'example.com' },
    });
    await cleanup();
    expect(capturedSesv2Commands[0]).toEqual({ EmailIdentity: 'example.com' });
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toBe(
      'domain: example.com\nverified: true\ndkimStatus: SUCCESS\ndkimTokens: token1, token2'
    );
  });

  it('returns correct output for an unverified domain with PENDING DKIM', async () => {
    mockSesv2Send.mockResolvedValueOnce({
      VerifiedForSendingStatus: false,
      DkimAttributes: { Status: 'PENDING', Tokens: [] },
    });
    const { client, cleanup } = await createTestClient(registerVerifyDomainStatus);
    const result = await client.callTool({
      name: 'verify_domain_status',
      arguments: { domain: 'unverified.com' },
    });
    await cleanup();
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toBe(
      'domain: unverified.com\nverified: false\ndkimStatus: PENDING\ndkimTokens: none'
    );
  });

  it('returns isError: true with "Domain not found" for NotFoundException', async () => {
    const notFound = Object.assign(new Error('NotFoundException: ...'), {
      name: 'NotFoundException',
    });
    mockSesv2Send.mockRejectedValueOnce(notFound);
    const { client, cleanup } = await createTestClient(registerVerifyDomainStatus);
    const result = await client.callTool({
      name: 'verify_domain_status',
      arguments: { domain: 'missing.com' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('Domain not found in SES: missing.com');
    expect(text).toContain('checked region: us-east-1');
    expect(text).toContain('AWS_REGION');
    expect(text).toContain('wraps email domains add --domain missing.com --region us-east-1');
    expect(text).toContain('get_setup_status');
  });

  it('names the region actually checked, not a hardcoded default', async () => {
    const notFound = Object.assign(new Error('NotFoundException'), { name: 'NotFoundException' });
    mockSesv2Send.mockRejectedValueOnce(notFound);
    const { client, cleanup } = await createTestClient(registerVerifyDomainStatus, {
      ...baseConfig,
      region: 'eu-west-1',
    });
    const result = await client.callTool({
      name: 'verify_domain_status',
      arguments: { domain: 'missing.com' },
    });
    await cleanup();
    expect(getText(result)).toContain('checked region: eu-west-1');
    expect(getText(result)).not.toContain('us-east-1');
  });

  it('returns isError: true with "Domain not found" when error name is "Error" but message contains NotFoundException', async () => {
    const notFound = Object.assign(new Error('NotFoundException'), { name: 'Error' });
    mockSesv2Send.mockRejectedValueOnce(notFound);
    const { client, cleanup } = await createTestClient(registerVerifyDomainStatus);
    const result = await client.callTool({
      name: 'verify_domain_status',
      arguments: { domain: 'missing.com' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Domain not found in SES: missing.com');
  });
});

describe('get_setup_status tool', () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedSesv2Commands.length = 0;
  });

  it('reports sandbox: true and recommends the simulator when in sandbox with a configured fromEmail', async () => {
    mockSesv2Send.mockResolvedValueOnce({
      ProductionAccessEnabled: false,
      EnforcementStatus: 'HEALTHY',
      SendQuota: { Max24HourSend: 200, SentLast24Hours: 3 },
    });
    const { client, cleanup } = await createTestClient(registerGetSetupStatus);
    const result = await client.callTool({ name: 'get_setup_status', arguments: {} });
    await cleanup();
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('sandbox: true');
    expect(text).toContain('success@simulator.amazonses.com');
    // The region is reported because verify_domain_status and
    // get_email_event_log both send agents here to resolve a region mismatch.
    expect(text).toContain('region: us-east-1');
  });

  it('reports sandbox: false and does not recommend the simulator when production access is enabled', async () => {
    mockSesv2Send.mockResolvedValueOnce({
      ProductionAccessEnabled: true,
      EnforcementStatus: 'HEALTHY',
      SendQuota: { Max24HourSend: 50000, SentLast24Hours: 120 },
    });
    const { client, cleanup } = await createTestClient(registerGetSetupStatus);
    const result = await client.callTool({ name: 'get_setup_status', arguments: {} });
    await cleanup();
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('sandbox: false');
    expect(text).not.toContain('success@simulator.amazonses.com');
  });

  it('names WRAPS_FROM_EMAIL and does not recommend the simulator when no fromEmail is configured', async () => {
    mockSesv2Send.mockResolvedValueOnce({
      ProductionAccessEnabled: false,
      EnforcementStatus: 'HEALTHY',
      SendQuota: { Max24HourSend: 200, SentLast24Hours: 3 },
    });
    const { client, cleanup } = await createTestClient(registerGetSetupStatus, {
      ...baseConfig,
      fromEmail: undefined,
    });
    const result = await client.callTool({ name: 'get_setup_status', arguments: {} });
    await cleanup();
    expect(result.isError).toBeUndefined();
    const text = getText(result);
    expect(text).toContain('WRAPS_FROM_EMAIL');
    expect(text).not.toContain('success@simulator.amazonses.com');
  });

  it('names WRAPS_WRITE_ENABLED as the next action when write is disabled', async () => {
    mockSesv2Send.mockResolvedValueOnce({
      ProductionAccessEnabled: false,
      EnforcementStatus: 'HEALTHY',
      SendQuota: { Max24HourSend: 200, SentLast24Hours: 3 },
    });
    const { client, cleanup } = await createTestClient(registerGetSetupStatus, {
      ...baseConfig,
      writeEnabled: false,
    });
    const result = await client.callTool({ name: 'get_setup_status', arguments: {} });
    await cleanup();
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toContain('WRAPS_WRITE_ENABLED');
  });

  it('returns isError: true with no fabricated status when the SESv2 call rejects', async () => {
    mockSesv2Send.mockRejectedValueOnce(new Error('AccessDenied'));
    const { client, cleanup } = await createTestClient(registerGetSetupStatus);
    const result = await client.callTool({ name: 'get_setup_status', arguments: {} });
    await cleanup();
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('AccessDenied');
    expect(text).not.toContain('sandbox:');
  });
});

describe('send_email guardrails', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns isError when recipients exceed maxRecipients and does not call send', async () => {
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      maxRecipients: 2,
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: {
        to: ['a@example.com', 'b@example.com', 'c@example.com'],
        subject: 'Hi',
        text: 'body',
      },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/Too many recipients \(3\); max is 2/);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('returns isError when recipient domain is not in allowlist and does not call send', async () => {
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      allowedRecipientDomains: ['allowed.com'],
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@notallowed.com', subject: 'Hi', text: 'body' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('not in the configured allowlist');
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('allows send when recipient matches exact address allowlist', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-al1', requestId: 'req-al1' });
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      allowedRecipients: ['exact@example.com'],
      allowedRecipientDomains: [],
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'exact@example.com', subject: 'Hi', text: 'body' },
    });
    await cleanup();
    expect(result.isError).toBeUndefined();
    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  it('allows send when recipient matches domain allowlist', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-al2', requestId: 'req-al2' });
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      allowedRecipientDomains: ['example.com'],
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'anyone@example.com', subject: 'Hi', text: 'body' },
    });
    await cleanup();
    expect(result.isError).toBeUndefined();
    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  it('returns isError when from differs from configured fromEmail with allowFromOverride: false', async () => {
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      allowFromOverride: false,
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', from: 'other@example.com', subject: 'Hi', text: 'body' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('WRAPS_ALLOW_FROM_OVERRIDE');
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('allows from override when allowFromOverride: true', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-fro', requestId: 'req-fro' });
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      allowFromOverride: true,
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', from: 'other@example.com', subject: 'Hi', text: 'body' },
    });
    await cleanup();
    expect(result.isError).toBeUndefined();
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'other@example.com' })
    );
  });

  it('proceeds with no allowlists configured (back-compat baseline)', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-bc', requestId: 'req-bc' });
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'anyone@anywhere.com', subject: 'Hi', text: 'body' },
    });
    await cleanup();
    expect(result.isError).toBeUndefined();
    expect(mockEmailSend).toHaveBeenCalledOnce();
  });

  it('allows from override when fromEmail is not configured (no override happening)', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-nf', requestId: 'req-nf' });
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      fromEmail: undefined,
      allowFromOverride: false,
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: {
        to: 'user@example.com',
        from: 'caller@example.com',
        subject: 'Hi',
        text: 'body',
      },
    });
    await cleanup();
    expect(result.isError).toBeUndefined();
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'caller@example.com' })
    );
  });
});

describe('list_suppressions tool', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns entries formatted as "email — REASON (since ISO)" for all suppressed addresses', async () => {
    mockSuppressionList.mockResolvedValueOnce({
      entries: [
        { email: 'bounce@example.com', reason: 'BOUNCE', lastUpdated: new Date('2024-01-01') },
        {
          email: 'complaint@example.com',
          reason: 'COMPLAINT',
          lastUpdated: new Date('2024-01-02'),
        },
      ],
      nextToken: undefined,
    });
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({ name: 'list_suppressions', arguments: {} });
    await cleanup();
    expect(mockSuppressionList).toHaveBeenCalledOnce();
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toContain('bounce@example.com — BOUNCE (since 2024-01-01T');
    expect(getText(result)).toContain('complaint@example.com — COMPLAINT (since 2024-01-02T');
  });

  it('forwards BOUNCE reason filter to suppression.list()', async () => {
    mockSuppressionList.mockResolvedValueOnce({ entries: [], nextToken: undefined });
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    await client.callTool({ name: 'list_suppressions', arguments: { reason: 'BOUNCE' } });
    await cleanup();
    expect(mockSuppressionList).toHaveBeenCalledWith(expect.objectContaining({ reason: 'BOUNCE' }));
  });

  it('calls suppression.list() with reason: undefined when no filter is provided', async () => {
    mockSuppressionList.mockResolvedValueOnce({ entries: [], nextToken: undefined });
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    await client.callTool({ name: 'list_suppressions', arguments: {} });
    await cleanup();
    expect(mockSuppressionList).toHaveBeenCalledWith(
      expect.objectContaining({ reason: undefined })
    );
  });

  it('says the listing is complete when SES returns no continuation token', async () => {
    mockSuppressionList.mockResolvedValueOnce({
      entries: [{ email: 'a@example.com', reason: 'BOUNCE', lastUpdated: new Date('2024-01-01') }],
      nextToken: undefined,
    });
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({ name: 'list_suppressions', arguments: {} });
    await cleanup();
    expect(getText(result)).toContain('Showing all 1 suppressed addresses.');
  });
});

describe('list_suppressions pagination', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function page(count: number, offset: number, nextToken: string | undefined) {
    return {
      entries: Array.from({ length: count }, (_, i) => ({
        email: `addr${offset + i}@example.com`,
        reason: 'BOUNCE' as const,
        lastUpdated: new Date('2024-01-01'),
      })),
      nextToken,
    };
  }

  it('does not report a false negative: a truncated listing says so explicitly', async () => {
    // 100 entries and a token — the exact shape that used to be returned as if
    // it were the whole suppression list.
    mockSuppressionList.mockResolvedValueOnce(page(100, 0, 'tok-1'));
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({ name: 'list_suppressions', arguments: {} });
    await cleanup();
    const text = getText(result);
    expect(text).toContain('Showing 20 suppressed addresses; more exist.');
    expect(text).toContain('email=<address>');
    expect(text).toContain('not read this partial list as proof that an address is unsuppressed');
    // Only `limit` rows are rendered, not the whole page.
    expect(text).toContain('addr19@example.com');
    expect(text).not.toContain('addr20@example.com');
  });

  it('follows the continuation token across pages until it can answer exactly', async () => {
    mockSuppressionList
      .mockResolvedValueOnce(page(2, 0, 'tok-1'))
      .mockResolvedValueOnce(page(2, 2, 'tok-2'))
      .mockResolvedValueOnce(page(2, 4, 'tok-3'))
      .mockResolvedValueOnce(page(0, 6, undefined));
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({ name: 'list_suppressions', arguments: {} });
    await cleanup();
    expect(mockSuppressionList).toHaveBeenCalledTimes(4);
    expect(mockSuppressionList).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ continuationToken: 'tok-1' })
    );
    const text = getText(result);
    // SES hands back a token on the last non-empty page, so a trailing token is
    // NOT evidence of more data. All six entries are present and complete.
    expect(text).toContain('Showing all 6 suppressed addresses.');
    expect(text).toContain('addr5@example.com');
  });

  it('stops walking one entry past the limit instead of draining the whole list', async () => {
    mockSuppressionList
      .mockResolvedValueOnce(page(2, 0, 'tok-1'))
      .mockResolvedValueOnce(page(2, 2, 'tok-2'))
      .mockResolvedValueOnce(page(2, 4, 'tok-3'));
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({
      name: 'list_suppressions',
      arguments: { limit: 5 },
    });
    await cleanup();
    expect(mockSuppressionList).toHaveBeenCalledTimes(3);
    const text = getText(result);
    expect(text).toContain('Showing 5 suppressed addresses; more exist.');
    expect(text).not.toContain('addr5@example.com');
  });

  it('reports an incomplete answer rather than a wrong one when the page cap is hit', async () => {
    mockSuppressionList.mockResolvedValue(page(1, 0, 'tok-forever'));
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({
      name: 'list_suppressions',
      arguments: { limit: 100 },
    });
    await cleanup();
    expect(mockSuppressionList).toHaveBeenCalledTimes(20);
    const text = getText(result);
    expect(text).toContain('may be incomplete');
    expect(text).toContain('email=<address>');
  });

  it('carries the reason filter through every page request', async () => {
    mockSuppressionList
      .mockResolvedValueOnce(page(2, 0, 'tok-1'))
      .mockResolvedValueOnce(page(0, 2, undefined));
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({
      name: 'list_suppressions',
      arguments: { reason: 'COMPLAINT' },
    });
    await cleanup();
    for (const call of mockSuppressionList.mock.calls) {
      expect(call[0]).toMatchObject({ reason: 'COMPLAINT' });
    }
    expect(getText(result)).toContain('with reason COMPLAINT');
  });
});

describe('list_suppressions single-address check', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('answers "is X suppressed?" from an exact SES lookup, never from the listing', async () => {
    mockSuppressionGet.mockResolvedValueOnce({
      email: 'bob@example.com',
      reason: 'BOUNCE',
      lastUpdated: new Date('2024-03-04T05:06:07Z'),
    });
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({
      name: 'list_suppressions',
      arguments: { email: 'bob@example.com' },
    });
    await cleanup();
    expect(mockSuppressionGet).toHaveBeenCalledWith('bob@example.com');
    expect(mockSuppressionList).not.toHaveBeenCalled();
    const text = getText(result);
    expect(text).toContain('bob@example.com IS on the SES suppression list.');
    expect(text).toContain('reason: BOUNCE');
    expect(text).toContain('since: 2024-03-04T05:06:07.000Z');
  });

  it('reports a clean address as an exact result, naming the region checked', async () => {
    mockSuppressionGet.mockResolvedValueOnce(null);
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({
      name: 'list_suppressions',
      arguments: { email: 'clean@example.com' },
    });
    await cleanup();
    expect(mockSuppressionList).not.toHaveBeenCalled();
    const text = getText(result);
    expect(text).toContain('clean@example.com is NOT on the SES suppression list.');
    expect(text).toContain('us-east-1');
    expect(text).toContain('exact lookup');
  });

  it('surfaces a lookup failure as isError instead of an implied "not suppressed"', async () => {
    mockSuppressionGet.mockRejectedValueOnce(new Error('AccessDenied'));
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const result = await client.callTool({
      name: 'list_suppressions',
      arguments: { email: 'bob@example.com' },
    });
    await cleanup();
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('AccessDenied');
    expect(text).not.toContain('is NOT on the SES suppression list');
  });

  it('advertises the exact-check path in its tool description', async () => {
    const { client, cleanup } = await createTestClient(registerListSuppressions);
    const { tools } = await client.listTools();
    await cleanup();
    const tool = tools.find((t) => t.name === 'list_suppressions');
    expect(tool?.description).toContain('paginated');
    expect(tool?.inputSchema.properties).toHaveProperty('email');
    expect(tool?.inputSchema.properties).toHaveProperty('limit');
  });
});

describe('tool annotations', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('labels send_email as a non-read-only, non-idempotent, destructive open-world action', async () => {
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const { tools } = await client.listTools();
    await cleanup();
    const sendEmail = tools.find((t) => t.name === 'send_email');
    expect(sendEmail?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('labels enforced-mode send_email the same way — the enforcer does not make it read-only', async () => {
    const { client, cleanup } = await createTestClient(registerSendEmail, {
      ...baseConfig,
      agentId: 'agent-abc',
      enforcerFunction: 'arn:aws:lambda:us-east-1:123456789012:function:e:agent-abc',
      enforcedMode: true,
    });
    const { tools } = await client.listTools();
    await cleanup();
    const sendEmail = tools.find((t) => t.name === 'send_email');
    expect(sendEmail?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
  });

  it('keeps readOnlyHint: true on the read tools', async () => {
    const { client, cleanup } = await createTestClient((server, config) => {
      registerListSuppressions(server, config);
      registerListRecentSends(server, config);
      registerGetEmailEventLog(server, config);
      registerVerifyDomainStatus(server, config);
      registerGetSetupStatus(server, config);
    });
    const { tools } = await client.listTools();
    await cleanup();
    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });
});
