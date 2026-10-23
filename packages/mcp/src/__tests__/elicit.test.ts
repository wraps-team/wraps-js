import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MCPConfig } from '../config.ts';
import { registerSendEmail, SES_SIMULATOR_SUCCESS } from '../tools/send-email.ts';

const { mockEmailSend } = vi.hoisted(() => ({
  mockEmailSend: vi.fn(),
}));

vi.mock('@wraps.dev/email', () => ({
  WrapsEmail: class MockWrapsEmail {
    send = mockEmailSend;
    destroy = vi.fn();
  },
}));

const baseConfig: MCPConfig = {
  aws: () => Promise.resolve({ region: 'us-east-1', accountId: '123456789012' }),
  historyTableName: 'wraps-email-history',
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

const NO_FROM_TEXT = 'No from address. Set WRAPS_FROM_EMAIL or pass `from` in the tool call.';

const SANDBOX_REJECTION_MESSAGE =
  'Email address is not verified. The following identities failed the check in region US-EAST-1: someone@example.com';

function sandboxRejection(): Error {
  return Object.assign(new Error(SANDBOX_REJECTION_MESSAGE), { name: 'MessageRejected' });
}

/**
 * Connects a send_email server to a client. `elicit` controls whether the client
 * advertises form elicitation; `elicitHandler` answers any elicitation request.
 */
async function createElicitClient(
  config: MCPConfig,
  options: {
    elicit?: boolean;
    elicitHandler?: (request: unknown) => unknown;
  } = {}
) {
  const { elicit = true, elicitHandler = () => ({ action: 'decline' }) } = options;
  const elicitMock = vi.fn(elicitHandler);
  const server = new McpServer({ name: 'test', version: '1.0' });
  registerSendEmail(server, config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client(
    { name: 'test-client', version: '1.0' },
    elicit ? { capabilities: { elicitation: {} } } : {}
  );
  if (elicit) {
    client.setRequestHandler(ElicitRequestSchema, (request) => elicitMock(request) as never);
  }
  await client.connect(clientTransport);
  return { client, elicitMock, cleanup: () => client.close() };
}

function getText(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

const noFromArgs = { to: 'user@example.com', subject: 'Hello', text: 'Hi' };

describe('send_email elicitation: missing from', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('asks for the sender when neither from nor WRAPS_FROM_EMAIL is set, and sends with the elicited address', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-from-1', requestId: 'r' });
    const { client, elicitMock, cleanup } = await createElicitClient(
      { ...baseConfig, fromEmail: undefined },
      {
        elicitHandler: () => ({
          action: 'accept',
          content: { from: 'typed@example.com' },
        }),
      }
    );
    const result = await client.callTool({ name: 'send_email', arguments: noFromArgs });
    await cleanup();

    expect(elicitMock).toHaveBeenCalledTimes(1);
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'typed@example.com', to: 'user@example.com' })
    );
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toBe('Email sent successfully. messageId: msg-from-1');
    expect(result.structuredContent).toEqual({
      messageId: 'msg-from-1',
      to: ['user@example.com'],
      from: 'typed@example.com',
    });
  });

  it('returns the original no-from error when the user declines', async () => {
    const { client, cleanup } = await createElicitClient(
      { ...baseConfig, fromEmail: undefined },
      { elicitHandler: () => ({ action: 'decline' }) }
    );
    const result = await client.callTool({ name: 'send_email', arguments: noFromArgs });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(NO_FROM_TEXT);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('returns the original no-from error when the user cancels', async () => {
    const { client, cleanup } = await createElicitClient(
      { ...baseConfig, fromEmail: undefined },
      { elicitHandler: () => ({ action: 'cancel' }) }
    );
    const result = await client.callTool({ name: 'send_email', arguments: noFromArgs });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(NO_FROM_TEXT);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('returns the original no-from error when the elicitation handler throws', async () => {
    const { client, cleanup } = await createElicitClient(
      { ...baseConfig, fromEmail: undefined },
      {
        elicitHandler: () => {
          throw new Error('client exploded');
        },
      }
    );
    const result = await client.callTool({ name: 'send_email', arguments: noFromArgs });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(NO_FROM_TEXT);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('treats a malformed elicited address as a decline', async () => {
    const { client, cleanup } = await createElicitClient(
      { ...baseConfig, fromEmail: undefined },
      { elicitHandler: () => ({ action: 'accept', content: { from: 'not-an-address' } }) }
    );
    const result = await client.callTool({ name: 'send_email', arguments: noFromArgs });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(NO_FROM_TEXT);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('does not ask for a sender when WRAPS_FROM_EMAIL is set', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-cfg', requestId: 'r' });
    const { client, elicitMock, cleanup } = await createElicitClient(baseConfig);
    const result = await client.callTool({ name: 'send_email', arguments: noFromArgs });
    await cleanup();

    expect(elicitMock).not.toHaveBeenCalled();
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'noreply@example.com' })
    );
    expect(result.isError).toBeUndefined();
  });

  it('does not ask for a sender when input.from is given and WRAPS_FROM_EMAIL is unset', async () => {
    mockEmailSend.mockResolvedValueOnce({ messageId: 'msg-explicit', requestId: 'r' });
    const { client, elicitMock, cleanup } = await createElicitClient({
      ...baseConfig,
      fromEmail: undefined,
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { ...noFromArgs, from: 'given@example.com' },
    });
    await cleanup();

    expect(elicitMock).not.toHaveBeenCalled();
    expect(mockEmailSend).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'given@example.com' })
    );
    expect(result.isError).toBeUndefined();
  });

  it('gives the same no-from error as today when the client has no elicitation capability', async () => {
    const { client, elicitMock, cleanup } = await createElicitClient(
      { ...baseConfig, fromEmail: undefined },
      { elicit: false }
    );
    const result = await client.callTool({ name: 'send_email', arguments: noFromArgs });
    await cleanup();

    expect(elicitMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(NO_FROM_TEXT);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('does not ask for a sender when the call has no body either', async () => {
    const { client, elicitMock, cleanup } = await createElicitClient({
      ...baseConfig,
      fromEmail: undefined,
    });
    const { html: _html, text: _text, ...noBodyArgs } = noFromArgs as Record<string, unknown>;
    const result = await client.callTool({ name: 'send_email', arguments: noBodyArgs });
    await cleanup();

    expect(elicitMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(NO_FROM_TEXT);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });
});

describe('send_email elicitation: guards run before any prompt', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Each case has no from and no WRAPS_FROM_EMAIL, so the only thing stopping a
  // send is the guard under test. The client must never receive a request.
  it('refuses when write is disabled, before asking for a sender', async () => {
    const { client, elicitMock, cleanup } = await createElicitClient({
      ...baseConfig,
      fromEmail: undefined,
      writeEnabled: false,
    });
    const result = await client.callTool({ name: 'send_email', arguments: noFromArgs });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('WRAPS_WRITE_ENABLED');
    expect(elicitMock).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('refuses when over maxRecipients, before asking for a sender', async () => {
    const { client, elicitMock, cleanup } = await createElicitClient({
      ...baseConfig,
      fromEmail: undefined,
      maxRecipients: 1,
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { ...noFromArgs, to: ['a@example.com', 'b@example.com'] },
    });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toMatch(/Too many recipients \(2\); max is 1/);
    expect(elicitMock).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it('refuses when the recipient is not allowlisted, before asking for a sender', async () => {
    const { client, elicitMock, cleanup } = await createElicitClient({
      ...baseConfig,
      fromEmail: undefined,
      allowedRecipients: ['ok@example.com'],
    });
    const result = await client.callTool({ name: 'send_email', arguments: noFromArgs });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('One or more recipients are not in the configured allowlist.');
    expect(elicitMock).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();
  });
});

describe('send_email elicitation: SES sandbox recipient rejection', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('on accept, retries exactly once to the simulator and reports it as the simulator send', async () => {
    mockEmailSend
      .mockRejectedValueOnce(sandboxRejection())
      .mockResolvedValueOnce({ messageId: 'msg-sim', requestId: 'r2' });
    const { client, elicitMock, cleanup } = await createElicitClient(baseConfig, {
      elicitHandler: () => ({ action: 'accept', content: { confirm: true } }),
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'someone@example.com', subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();

    expect(elicitMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(elicitMock.mock.calls[0][0])).toContain(SES_SIMULATOR_SUCCESS);
    expect(mockEmailSend).toHaveBeenCalledTimes(2);
    expect(mockEmailSend.mock.calls[0][0]).toEqual(
      expect.objectContaining({ to: 'someone@example.com' })
    );
    expect(mockEmailSend.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        to: SES_SIMULATOR_SUCCESS,
        from: 'noreply@example.com',
        subject: 'Hello',
        html: '<p>Hi</p>',
      })
    );
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toContain(SES_SIMULATOR_SUCCESS);
    expect(getText(result)).toContain('someone@example.com did not receive');
    expect(result.structuredContent).toEqual({
      messageId: 'msg-sim',
      to: [SES_SIMULATOR_SUCCESS],
      from: 'noreply@example.com',
    });
  });

  it('on accept with confirm false, treats it as a decline and returns the original guidance', async () => {
    mockEmailSend.mockRejectedValueOnce(sandboxRejection());
    const { client, cleanup } = await createElicitClient(baseConfig, {
      elicitHandler: () => ({ action: 'accept', content: { confirm: false } }),
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'someone@example.com', subject: 'Hello', text: 'Hi' },
    });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('this AWS SES account is in the sandbox');
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
  });

  it.each(['decline', 'cancel'] as const)(
    'on %s, returns the original guidance text and does not retry',
    async (action) => {
      mockEmailSend.mockRejectedValueOnce(sandboxRejection());
      const { client, cleanup } = await createElicitClient(baseConfig, {
        elicitHandler: () => ({ action }),
      });
      const withElicit = await client.callTool({
        name: 'send_email',
        arguments: { to: 'someone@example.com', subject: 'Hello', text: 'Hi' },
      });
      await cleanup();

      expect(withElicit.isError).toBe(true);
      expect(getText(withElicit)).toContain('this AWS SES account is in the sandbox');
      expect(getText(withElicit)).toContain(SANDBOX_REJECTION_MESSAGE);
      expect(mockEmailSend).toHaveBeenCalledTimes(1);
    }
  );

  it('returns the original guidance when the elicitation handler throws', async () => {
    mockEmailSend.mockRejectedValueOnce(sandboxRejection());
    const { client, cleanup } = await createElicitClient(baseConfig, {
      elicitHandler: () => {
        throw new Error('client exploded');
      },
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'someone@example.com', subject: 'Hello', text: 'Hi' },
    });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('this AWS SES account is in the sandbox');
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
  });

  it('returns the retry error and does not retry a second time when the simulator send fails', async () => {
    mockEmailSend
      .mockRejectedValueOnce(sandboxRejection())
      .mockRejectedValueOnce(new Error('simulator throttled'));
    const { client, elicitMock, cleanup } = await createElicitClient(baseConfig, {
      elicitHandler: () => ({ action: 'accept', content: { confirm: true } }),
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'someone@example.com', subject: 'Hello', text: 'Hi' },
    });
    await cleanup();

    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('Failed to send email to the SES simulator: simulator throttled');
    expect(elicitMock).toHaveBeenCalledTimes(1);
    expect(mockEmailSend).toHaveBeenCalledTimes(2);
  });

  it('does not offer the simulator when the original recipient was allowlisted and the simulator is not', async () => {
    mockEmailSend.mockRejectedValueOnce(sandboxRejection());
    const { client, elicitMock, cleanup } = await createElicitClient(
      { ...baseConfig, allowedRecipients: ['someone@example.com'] },
      { elicitHandler: () => ({ action: 'accept', content: { confirm: true } }) }
    );
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'someone@example.com', subject: 'Hello', text: 'Hi' },
    });
    await cleanup();

    expect(elicitMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('this AWS SES account is in the sandbox');
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
  });

  it('gives identical guidance text with and without the elicitation capability', async () => {
    mockEmailSend.mockRejectedValueOnce(sandboxRejection());
    const withoutCapability = await createElicitClient(baseConfig, { elicit: false });
    const plain = await withoutCapability.client.callTool({
      name: 'send_email',
      arguments: { to: 'someone@example.com', subject: 'Hello', text: 'Hi' },
    });
    await withoutCapability.cleanup();

    mockEmailSend.mockRejectedValueOnce(sandboxRejection());
    const withCapability = await createElicitClient(baseConfig, {
      elicitHandler: () => ({ action: 'decline' }),
    });
    const declined = await withCapability.client.callTool({
      name: 'send_email',
      arguments: { to: 'someone@example.com', subject: 'Hello', text: 'Hi' },
    });
    await withCapability.cleanup();

    expect(withCapability.elicitMock).toHaveBeenCalledTimes(1);
    expect(getText(declined)).toBe(getText(plain));
    expect(declined.isError).toBe(plain.isError);
  });

  it('does not prompt for a sandbox rejection when the client has no elicitation capability', async () => {
    mockEmailSend.mockRejectedValueOnce(sandboxRejection());
    const { client, elicitMock, cleanup } = await createElicitClient(baseConfig, {
      elicit: false,
    });
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'someone@example.com', subject: 'Hello', text: 'Hi' },
    });
    await cleanup();

    expect(elicitMock).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('this AWS SES account is in the sandbox');
    expect(mockEmailSend).toHaveBeenCalledTimes(1);
  });
});
