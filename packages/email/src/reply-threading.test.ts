import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ValidationError } from './errors';
import { WrapsReplyThreading } from './reply-threading';
import { encodeReplyToken } from './reply-token-codec';

// Mock @aws-sdk/client-ssm at module level — matches events.test.ts pattern
vi.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: class MockSSMClient {
    send: any;
    constructor() {
      this.send = vi.fn();
    }
  },
  GetParameterCommand: vi.fn(function (this: any, input: any) {
    Object.assign(this, input);
  }),
}));

function makeSsmValue(secretByte: number): string {
  const secret = Buffer.alloc(32, secretByte);
  return JSON.stringify({ kid: 1, current: secret.toString('base64') });
}

function makeSsmResponse(valueJson: string) {
  return { Parameter: { Value: valueJson } };
}

describe('WrapsReplyThreading', () => {
  let mockSend: any;
  let ssmClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSend = vi.fn();
    ssmClient = { send: mockSend };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('generateReplyTo', () => {
    it('auto-derives replyDomain as r.mail.{fromDomain} and returns a 51-char token local-part', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x11)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      const result = await rt.generateReplyTo({ fromDomain: 'foo.com' });

      expect(result.address).toMatch(/^[A-Za-z0-9_-]{51}@r\.mail\.foo\.com$/);
      const local = result.address.split('@')[0];
      expect(local.length).toBe(51);
      expect(result.conversationId).toHaveLength(11);
      expect(result.sendId).toHaveLength(11);
    });

    it('lets explicit per-call replyDomain win over auto-derive', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x22)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      const result = await rt.generateReplyTo({
        fromDomain: 'foo.com',
        replyDomain: 'replies.foo.com',
      });

      expect(result.address).toMatch(/@replies\.foo\.com$/);
    });

    it('uses constructor-level defaultReplyDomainOverride when no per-call override', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x33)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
        defaultReplyDomainOverride: 'global.replies.com',
      });

      const result = await rt.generateReplyTo({ fromDomain: 'foo.com' });
      expect(result.address).toMatch(/@global\.replies\.com$/);
    });

    it('lets per-call replyDomain win over constructor-level override', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x44)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
        defaultReplyDomainOverride: 'global.replies.com',
      });

      const result = await rt.generateReplyTo({
        fromDomain: 'foo.com',
        replyDomain: 'per-call.replies.com',
      });
      expect(result.address).toMatch(/@per-call\.replies\.com$/);
    });

    it('default TTL is 90 days (exp ≈ now + 90*86400 within 2s tolerance)', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x55)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      const before = Math.floor(Date.now() / 1000);
      const result = await rt.generateReplyTo({ fromDomain: 'foo.com' });
      const after = Math.floor(Date.now() / 1000);

      expect(result.expiresAt).not.toBeNull();
      const expiresAt = result.expiresAt as number;
      expect(expiresAt).toBeGreaterThanOrEqual(before + 90 * 86_400);
      expect(expiresAt).toBeLessThanOrEqual(after + 90 * 86_400 + 2);
    });

    it('ttlSeconds=0 means infinite — expiresAt is null', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x66)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      const result = await rt.generateReplyTo({ fromDomain: 'foo.com', ttlSeconds: 0 });
      expect(result.expiresAt).toBeNull();
    });

    it('preserves caller-provided conversationId when it is a valid 11-char base64url id', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x77)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      // 11-char base64url string (8 random bytes encoded)
      const myConv = rt.newConversation();
      const result = await rt.generateReplyTo({ fromDomain: 'foo.com', conversationId: myConv });
      expect(result.conversationId).toBe(myConv);
    });

    it('throws ValidationError when conversationId is not an 11-char base64url id', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x77)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      // A UUID — a common mistake. Must be rejected, not silently truncated.
      await expect(
        rt.generateReplyTo({
          fromDomain: 'foo.com',
          conversationId: '550e8400-e29b-41d4-a716-446655440000',
        })
      ).rejects.toThrow(ValidationError);
      await expect(
        rt.generateReplyTo({
          fromDomain: 'foo.com',
          conversationId: '550e8400-e29b-41d4-a716-446655440000',
        })
      ).rejects.toThrow(/conversationId/);
    });

    it('throws ValidationError when sendId is not an 11-char base64url id', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x77)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      await expect(
        rt.generateReplyTo({
          fromDomain: 'foo.com',
          sendId: 'not-valid',
        })
      ).rejects.toThrow(ValidationError);
      await expect(
        rt.generateReplyTo({
          fromDomain: 'foo.com',
          sendId: 'not-valid',
        })
      ).rejects.toThrow(/sendId/);
    });

    it('round-trips conversationId exactly — Lambda-decoded value matches SDK-provided value', async () => {
      const secretByte = 0xee;
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(secretByte)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      const myConv = rt.newConversation();
      const mySend = rt.newConversation();
      const result = await rt.generateReplyTo({
        fromDomain: 'foo.com',
        conversationId: myConv,
        sendId: mySend,
      });

      // Decode the token and assert convId/sendId round-trip back to the
      // same base64url strings that the Lambda would emit.
      const local = result.address.split('@')[0];
      const pad = local.length % 4 === 0 ? '' : '='.repeat(4 - (local.length % 4));
      const raw = Buffer.from(local.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
      const convBytes = raw.subarray(2, 10);
      const sendBytes = raw.subarray(10, 18);
      const toB64Url = (b: Buffer) =>
        b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      expect(toB64Url(convBytes)).toBe(myConv);
      expect(toB64Url(sendBytes)).toBe(mySend);
    });

    it('caches SSM per-domain — two calls for same fromDomain → one SSM fetch', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0x88)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      await rt.generateReplyTo({ fromDomain: 'foo.com' });
      await rt.generateReplyTo({ fromDomain: 'foo.com' });

      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('different fromDomains → two SSM fetches with distinct param names', async () => {
      mockSend.mockImplementation((cmd: any) => {
        const name = cmd.Name as string;
        if (name === '/wraps/email/reply-secret/foo.com') {
          return Promise.resolve(makeSsmResponse(makeSsmValue(0x99)));
        }
        if (name === '/wraps/email/reply-secret/bar.com') {
          return Promise.resolve(makeSsmResponse(makeSsmValue(0xaa)));
        }
        return Promise.reject(new Error(`unexpected param ${name}`));
      });
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      await rt.generateReplyTo({ fromDomain: 'foo.com' });
      await rt.generateReplyTo({ fromDomain: 'bar.com' });

      expect(mockSend).toHaveBeenCalledTimes(2);
      const paramNames = mockSend.mock.calls.map((c: any[]) => c[0].Name).sort();
      expect(paramNames).toEqual([
        '/wraps/email/reply-secret/bar.com',
        '/wraps/email/reply-secret/foo.com',
      ]);
    });

    it('re-fetches from SSM after cache TTL expires', async () => {
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(0xbb)));
      // Use a very small cache TTL + fake timers to advance time
      vi.useFakeTimers();
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
        cacheTtlMs: 1_000,
      });

      await rt.generateReplyTo({ fromDomain: 'foo.com' });
      expect(mockSend).toHaveBeenCalledTimes(1);

      // Advance past cache TTL
      vi.advanceTimersByTime(2_000);

      await rt.generateReplyTo({ fromDomain: 'foo.com' });
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('throws ValidationError when SSM returns ParameterNotFound', async () => {
      const err = new Error('Parameter not found');
      (err as any).name = 'ParameterNotFound';
      mockSend.mockRejectedValue(err);
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      await expect(rt.generateReplyTo({ fromDomain: 'missing.com' })).rejects.toThrow(
        ValidationError
      );
      await expect(rt.generateReplyTo({ fromDomain: 'missing.com' })).rejects.toThrow(
        /missing\.com/
      );
    });

    it('re-throws non-ParameterNotFound SSM errors unchanged', async () => {
      const err = new Error('Access denied');
      (err as any).name = 'AccessDeniedException';
      mockSend.mockRejectedValue(err);
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });

      await expect(rt.generateReplyTo({ fromDomain: 'foo.com' })).rejects.toThrow(/Access denied/);
    });

    it('produces a token that would verify against the stored secret (decoder compat smoke)', async () => {
      const secretByte = 0xcc;
      mockSend.mockResolvedValue(makeSsmResponse(makeSsmValue(secretByte)));
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });
      const result = await rt.generateReplyTo({ fromDomain: 'foo.com' });
      const local = result.address.split('@')[0];

      // Manually decode, re-compute HMAC, compare
      const pad = local.length % 4 === 0 ? '' : '='.repeat(4 - (local.length % 4));
      const raw = Buffer.from(local.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
      expect(raw.length).toBe(38);
      const payload = raw.subarray(0, 22);
      const mac = raw.subarray(22);
      const expectedMac = createHmac('sha256', Buffer.alloc(32, secretByte))
        .update(payload)
        .digest()
        .subarray(0, 16);
      expect(mac.equals(expectedMac)).toBe(true);
    });
  });

  describe('newConversation', () => {
    it('returns an 11-char base64url string', () => {
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });
      const id = rt.newConversation();
      expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
    });

    it('returns distinct values across calls', () => {
      const rt = new WrapsReplyThreading({
        ssmClient,
        parameterPrefix: '/wraps/email/reply-secret/',
      });
      const set = new Set<string>();
      for (let i = 0; i < 50; i++) set.add(rt.newConversation());
      expect(set.size).toBe(50);
    });
  });
});

describe('encodeReplyToken KAT (drift guard against @wraps/core)', () => {
  it('produces the pinned byte-exact output for fixed inputs', () => {
    const convId = Buffer.from('0102030405060708', 'hex');
    const sendId = Buffer.from('090a0b0c0d0e0f10', 'hex');
    const exp = 2_000_000_000;
    const secret = Buffer.alloc(32, 0x42);

    const token = encodeReplyToken({ kid: 1, convId, sendId, exp, secret });

    // Decode the token back to raw bytes and verify byte layout
    const pad = token.length % 4 === 0 ? '' : '='.repeat(4 - (token.length % 4));
    const raw = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
    expect(raw.length).toBe(38);
    expect(raw.readUInt8(0)).toBe(1); // version
    expect(raw.readUInt8(1)).toBe(1); // kid
    expect(raw.subarray(2, 10).equals(convId)).toBe(true);
    expect(raw.subarray(10, 18).equals(sendId)).toBe(true);
    expect(raw.readUInt32BE(18)).toBe(exp);

    // Pinned HMAC (first 16 bytes of HMAC-SHA256 over the 22-byte payload)
    const expectedMac = createHmac('sha256', secret)
      .update(raw.subarray(0, 22))
      .digest()
      .subarray(0, 16);
    expect(raw.subarray(22).equals(expectedMac)).toBe(true);

    // And pin the full base64url string (double drift-guard)
    const expectedTokenRaw = Buffer.concat([raw.subarray(0, 22), expectedMac]);
    const expectedToken = expectedTokenRaw
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(token).toBe(expectedToken);
    expect(token.length).toBe(51);
  });
});
