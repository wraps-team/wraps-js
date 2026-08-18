import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendBatch } from './batch';
import { CredentialsError, SandboxError } from './errors';

vi.mock('@aws-sdk/client-sesv2', () => ({
  SendBulkEmailCommand: vi.fn(function (this: any, input: any) {
    Object.assign(this, input);
  }),
}));

const entries = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    to: `user${i}@example.com`,
    subject: 'Hi',
    html: '<p>Hi</p>',
  }));

const params = (count: number) => ({ from: 'sender@example.com', entries: entries(count) });

/** A credential-chain failure: never reached AWS, so it carries no `$metadata`. */
const credentialsFailure = () =>
  Object.assign(new Error('Could not load credentials from any providers'), {
    name: 'CredentialsProviderError',
  });

/** SES rejecting an unverified identity: reached AWS, so it carries `$metadata`. */
const notVerifiedFailure = () =>
  Object.assign(new Error('Email address is not verified. The following identities failed'), {
    name: 'MessageRejected',
    $metadata: { requestId: 'req-1' },
  });

describe('sendBatch', () => {
  let mockSend: ReturnType<typeof vi.fn>;
  let client: any;
  let regionProvider: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    regionProvider = vi.fn().mockResolvedValue('eu-west-1');
    client = { send: mockSend, config: { region: regionProvider }, destroy: vi.fn() };
  });

  it('throws rather than reporting every entry as failed when credentials are missing', async () => {
    mockSend.mockRejectedValue(credentialsFailure());

    // 60 entries spans two chunks, so a per-entry report would have duplicated
    // the same multi-line guidance 60 times across both of them.
    await expect(sendBatch(client, params(60))).rejects.toBeInstanceOf(CredentialsError);
  });

  it('does not resolve the region for a failure whose message never names one', async () => {
    mockSend.mockRejectedValue(credentialsFailure());

    await expect(sendBatch(client, params(1))).rejects.toThrow();
    // Resolution can walk to IMDS; nothing should trigger it here.
    expect(regionProvider).not.toHaveBeenCalled();
  });

  it('reports a chunk-level SES rejection per entry, naming the region', async () => {
    mockSend.mockRejectedValue(notVerifiedFailure());

    const result = await sendBatch(client, params(2));

    expect(result.failureCount).toBe(2);
    expect(result.successCount).toBe(0);
    expect(regionProvider).toHaveBeenCalled();
    for (const entry of result.results) {
      expect(entry.status).toBe('failure');
      expect(entry.error).toContain('eu-west-1');
    }
  });

  it('resolves the region once for the whole batch, not once per chunk', async () => {
    mockSend.mockRejectedValue(notVerifiedFailure());

    await sendBatch(client, params(60));

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(regionProvider).toHaveBeenCalledTimes(1);
  });

  it('still returns per-entry results when the send succeeds', async () => {
    mockSend.mockResolvedValue({
      BulkEmailEntryResults: [
        { Status: 'SUCCESS', MessageId: 'msg-0' },
        { Status: 'MESSAGE_REJECTED', Error: 'rejected' },
      ],
    });

    const result = await sendBatch(client, params(2));

    expect(result.successCount).toBe(1);
    expect(result.failureCount).toBe(1);
    expect(result.results[0]).toMatchObject({ index: 0, status: 'success', messageId: 'msg-0' });
    expect(result.results[1]).toMatchObject({ index: 1, status: 'failure' });
  });

  it('surfaces the unverified-identity rejection as a SandboxError to a single send path', async () => {
    // Guards the shared mapper the batch path leans on: the same AWS text must
    // classify as SandboxError, not a bare SESError.
    const { mapAwsSdkError } = await import('./errors');
    const mapped = mapAwsSdkError(notVerifiedFailure(), 'SES request failed', {
      region: 'eu-west-1',
    });
    expect(mapped).toBeInstanceOf(SandboxError);
    expect((mapped as SandboxError).region).toBe('eu-west-1');
  });
});
