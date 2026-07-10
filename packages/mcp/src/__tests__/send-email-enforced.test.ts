import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MCPConfig } from '../config.ts';
import { registerCheckSendStatus } from '../tools/check-send-status.ts';
import { registerSendEmail } from '../tools/send-email.ts';

const { mockLambdaSend, mockEmailSend, mockEmailDestroy, capturedInvokeCommands } = vi.hoisted(
  () => ({
    mockLambdaSend: vi.fn(),
    mockEmailSend: vi.fn(),
    mockEmailDestroy: vi.fn(),
    capturedInvokeCommands: [] as Array<Record<string, unknown>>,
  })
);

vi.mock('@aws-sdk/client-lambda', () => ({
  LambdaClient: class MockLambdaClient {
    send = mockLambdaSend;
    destroy = vi.fn();
  },
  InvokeCommand: class MockInvokeCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      capturedInvokeCommands.push(input);
    }
  },
}));

vi.mock('@wraps.dev/email', () => ({
  WrapsEmail: class MockWrapsEmail {
    send = mockEmailSend;
    destroy = mockEmailDestroy;
  },
}));

const enforcedConfig: MCPConfig = {
  region: 'us-east-1',
  historyTableName: 'wraps-email-history',
  accountId: '123456789012',
  writeEnabled: false,
  fromEmail: 'agent@example.com',
  configurationSetName: undefined,
  allowedRecipients: [],
  allowedRecipientDomains: [],
  maxRecipients: 50,
  allowFromOverride: false,
  agentId: 'agent-123',
  enforcerFunction: 'wraps-agent-enforcer',
  enforcedMode: true,
};

async function createTestClient(
  register: (server: McpServer, config: MCPConfig) => void,
  config: MCPConfig = enforcedConfig
): Promise<{ client: Client; cleanup: () => Promise<void> }> {
  const server = new McpServer({ name: 'test', version: '1.0' });
  register(server, config);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '1.0' });
  await client.connect(clientTransport);
  return { client, cleanup: () => client.close() };
}

function lambdaPayload(command: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(command.Payload as Uint8Array));
}

function encodeResponse(response: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(response));
}

function getText(result: { content: unknown }): string {
  return (result.content as Array<{ type: string; text: string }>)[0].text;
}

describe('send_email enforced mode', () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedInvokeCommands.length = 0;
  });

  it('invokes the enforcer Lambda (not SES) and returns a non-error pending_approval result', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      Payload: encodeResponse({ status: 'pending_approval', approvalId: 'appr-1' }),
    });
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();

    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(mockLambdaSend).toHaveBeenCalledOnce();
    expect(capturedInvokeCommands[0]).toEqual(
      expect.objectContaining({
        FunctionName: 'wraps-agent-enforcer',
        InvocationType: 'RequestResponse',
      })
    );
    const sent = lambdaPayload(capturedInvokeCommands[0]);
    expect(sent).toEqual(
      expect.objectContaining({
        action: 'send',
        agentId: 'agent-123',
        payload: expect.objectContaining({
          from: 'agent@example.com',
          to: 'user@example.com',
          subject: 'Hello',
          html: '<p>Hi</p>',
        }),
      })
    );
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      status: 'pending_approval',
      approvalId: 'appr-1',
    });
  });

  it('maps a blocked enforcer verdict to a non-error structured result with reason', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      Payload: encodeResponse({ status: 'blocked', reason: 'recipient not on allowlist' }),
    });
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();

    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(mockLambdaSend).toHaveBeenCalledOnce();
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      status: 'blocked',
      reason: 'recipient not on allowlist',
    });
    expect(getText(result)).toContain('recipient not on allowlist');
  });

  it('maps a sent enforcer verdict to a non-error structured result with messageId', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      Payload: encodeResponse({ status: 'sent', messageId: 'msg-42' }),
    });
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ status: 'sent', messageId: 'msg-42' });
  });

  it('returns isError (transport class) and never calls SES when the Lambda invoke rejects', async () => {
    mockLambdaSend.mockRejectedValueOnce(new Error('ECONNRESET'));
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();

    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(mockLambdaSend).toHaveBeenCalledOnce();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain('Failed to reach agent enforcer');
    expect(getText(result)).toContain('ECONNRESET');
  });

  it('maps a Lambda FunctionError payload to isError (enforcer-fault class, not a fake disposition)', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      FunctionError: 'Unhandled',
      Payload: encodeResponse({ errorMessage: 'boom', errorType: 'Error' }),
    });
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: 'user@example.com', subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();

    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain('Agent enforcer returned an error');
  });

  it('unwraps a single-element array recipient to a string in the Lambda payload', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      Payload: encodeResponse({ status: 'pending_approval', approvalId: 'appr-9' }),
    });
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: { to: ['solo@example.com'], subject: 'Hello', html: '<p>Hi</p>' },
    });
    await cleanup();

    expect(mockLambdaSend).toHaveBeenCalledOnce();
    const sent = lambdaPayload(capturedInvokeCommands[0]);
    expect((sent.payload as { to: unknown }).to).toBe('solo@example.com');
    expect(result.isError).toBeFalsy();
  });

  it('rejects a multi-recipient array with isError and never invokes the Lambda', async () => {
    const { client, cleanup } = await createTestClient(registerSendEmail);
    const result = await client.callTool({
      name: 'send_email',
      arguments: {
        to: ['a@example.com', 'b@example.com'],
        subject: 'Hello',
        html: '<p>Hi</p>',
      },
    });
    await cleanup();

    expect(mockLambdaSend).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    // The `.length(1)` schema rejects the multi-recipient array at input
    // validation, before the handler's defensive single-recipient guard.
    expect(getText(result)).toContain('Input validation error');
    expect(getText(result)).toContain('to');
  });
});

describe('check_send_status tool', () => {
  afterEach(() => {
    vi.clearAllMocks();
    capturedInvokeCommands.length = 0;
  });

  it('invokes the enforcer with action:"status" and maps the response to a structured result', async () => {
    mockLambdaSend.mockResolvedValueOnce({
      Payload: encodeResponse({ status: 'sent', messageId: 'msg-999' }),
    });
    const { client, cleanup } = await createTestClient(registerCheckSendStatus);
    const result = await client.callTool({
      name: 'check_send_status',
      arguments: { approvalId: 'appr-1' },
    });
    await cleanup();

    expect(mockLambdaSend).toHaveBeenCalledOnce();
    const sent = lambdaPayload(capturedInvokeCommands[0]);
    expect(sent).toEqual(expect.objectContaining({ action: 'status', approvalId: 'appr-1' }));
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ status: 'sent', messageId: 'msg-999' });
  });
});
