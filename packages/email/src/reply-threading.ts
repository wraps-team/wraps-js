import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';
import { ValidationError } from './errors';
import { encodeReplyToken, generateConversationId, generateSendId } from './reply-token-codec';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_TTL_SECONDS = 90 * 86_400; // 90 days

type CachedSecret = {
  kid: number;
  current: Buffer;
  previous?: Buffer;
  fetchedAt: number;
};

type StoredSecret = {
  kid: number;
  current: string; // base64
  previous?: string; // base64
};

export type WrapsReplyThreadingOptions = {
  /**
   * SSM client used to fetch per-domain signing secrets.
   * Injected (not constructed inline) for testability.
   */
  ssmClient: SSMClient;

  /**
   * SSM parameter name prefix. Full name = prefix + fromDomain.
   * Typically `"/wraps/email/reply-secret/"`.
   */
  parameterPrefix: string;

  /**
   * Per-domain secret cache TTL in milliseconds. Defaults to 5 minutes.
   */
  cacheTtlMs?: number;

  /**
   * Default exp (seconds from now) baked into tokens. Defaults to 90 days.
   * `0` means infinite (no expiry).
   */
  defaultTtlSeconds?: number;

  /**
   * Constructor-level override for the reply domain. If unset, the reply
   * domain is auto-derived as `r.mail.{fromDomain}`. Per-call `replyDomain`
   * still wins over this.
   */
  defaultReplyDomainOverride?: string;
};

export type GenerateReplyToParams = {
  fromDomain: string;
  replyDomain?: string;
  conversationId?: string;
  sendId?: string;
  /**
   * Override default TTL for this token. `0` = infinite.
   */
  ttlSeconds?: number;
};

export type GenerateReplyToResult = {
  /** Full signed reply-to address: `<51-char-token>@{replyDomain}` */
  address: string;
  conversationId: string;
  sendId: string;
  /** Unix seconds when the token expires; `null` when infinite. */
  expiresAt: number | null;
};

/**
 * WrapsReplyThreading - Mint signed reply-to addresses for email threading.
 *
 * Per-domain secrets are fetched from SSM and cached for `cacheTtlMs`
 * (default 5 minutes) so rotation eventually-converges without constant
 * SSM traffic. One instance handles N sending domains transparently.
 */
export class WrapsReplyThreading {
  private ssmClient: SSMClient;
  private parameterPrefix: string;
  private cacheTtlMs: number;
  private defaultTtlSeconds: number;
  private defaultReplyDomainOverride?: string;
  private cache: Map<string, CachedSecret> = new Map();

  constructor(opts: WrapsReplyThreadingOptions) {
    this.ssmClient = opts.ssmClient;
    this.parameterPrefix = opts.parameterPrefix;
    this.cacheTtlMs = opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.defaultTtlSeconds = opts.defaultTtlSeconds ?? DEFAULT_TTL_SECONDS;
    this.defaultReplyDomainOverride = opts.defaultReplyDomainOverride;
  }

  /**
   * Generate a new conversation id (11-char base64url from 8 random bytes).
   * Synchronous — no SSM call.
   */
  newConversation(): string {
    return generateConversationId();
  }

  /**
   * Mint a signed reply-to address for the given sending domain.
   *
   * @throws {ValidationError} if reply threading is not enabled for `fromDomain`
   *   (SSM parameter missing).
   */
  async generateReplyTo(params: GenerateReplyToParams): Promise<GenerateReplyToResult> {
    const fromDomain = params.fromDomain.toLowerCase();
    const replyDomain =
      params.replyDomain ?? this.defaultReplyDomainOverride ?? `r.mail.${fromDomain}`;

    const secret = await this.getSecret(fromDomain);

    const conversationId = params.conversationId ?? generateConversationId();
    const sendId = params.sendId ?? generateSendId();

    const convBytes = b64urlToBuffer8(conversationId, 'conversationId');
    const sendBytes = b64urlToBuffer8(sendId, 'sendId');

    const ttlSeconds = params.ttlSeconds ?? this.defaultTtlSeconds;
    const nowSeconds = Math.floor(Date.now() / 1000);
    const exp = ttlSeconds > 0 ? nowSeconds + ttlSeconds : 0;
    const expiresAt = ttlSeconds > 0 ? exp : null;

    const token = encodeReplyToken({
      kid: secret.kid,
      convId: convBytes,
      sendId: sendBytes,
      exp,
      secret: secret.current,
    });

    return {
      address: `${token}@${replyDomain}`,
      conversationId,
      sendId,
      expiresAt,
    };
  }

  private async getSecret(fromDomain: string): Promise<CachedSecret> {
    const cached = this.cache.get(fromDomain);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < this.cacheTtlMs) {
      return cached;
    }

    const paramName = this.parameterPrefix + fromDomain;
    try {
      const response = await this.ssmClient.send(
        new GetParameterCommand({ Name: paramName, WithDecryption: true })
      );
      const value = response.Parameter?.Value;
      if (!value) {
        throw new ValidationError(
          `Reply threading not enabled for domain ${fromDomain}`,
          'fromDomain'
        );
      }
      const parsed = JSON.parse(value) as StoredSecret;
      const entry: CachedSecret = {
        kid: parsed.kid,
        current: Buffer.from(parsed.current, 'base64'),
        previous: parsed.previous ? Buffer.from(parsed.previous, 'base64') : undefined,
        fetchedAt: now,
      };
      this.cache.set(fromDomain, entry);
      return entry;
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (name === 'ParameterNotFound') {
        throw new ValidationError(
          `Reply threading not enabled for domain ${fromDomain}`,
          'fromDomain'
        );
      }
      throw error;
    }
  }
}

/**
 * Convert an 11-char base64url id back to 8 raw bytes for encoding.
 * Rejects any input that does not cleanly round-trip — silent truncation
 * would cause the Lambda to emit a `conversationId` that does not match
 * what the caller supplied, breaking threading lookups. Callers must use
 * `generateConversationId()` / `generateSendId()` (or preserve ids from
 * previous send results) to ensure round-trip fidelity.
 */
function b64urlToBuffer8(s: string, fieldName: string): Buffer {
  if (typeof s !== 'string' || s.length !== 11 || !/^[A-Za-z0-9_-]{11}$/.test(s)) {
    throw new ValidationError(
      `${fieldName} must be an 11-character base64url id (use WrapsReplyThreading#newConversation or a value returned by send())`,
      fieldName
    );
  }
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const raw = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
  if (raw.length !== 8) {
    throw new ValidationError(
      `${fieldName} must decode to exactly 8 bytes`,
      fieldName
    );
  }
  return raw;
}
