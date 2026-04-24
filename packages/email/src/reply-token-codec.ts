// Duplicated from @wraps/core — must stay byte-identical.
// When @wraps/core is published, this file should be replaced with:
//   export { encodeReplyToken, generateConversationId, generateSendId } from '@wraps/core';
// The verifier Lambda uses @wraps/core's decodeReplyToken/verifyReplyToken; this encoder
// MUST produce bytes that the verifier accepts. See KAT in reply-threading.test.ts.

import { createHmac, randomBytes } from 'node:crypto';

export const REPLY_TOKEN_VERSION = 1;
const PAYLOAD_LEN = 22;
const HMAC_LEN = 16;

export type EncodeReplyTokenInput = {
  kid: number;
  convId: Buffer;
  sendId: Buffer;
  exp: number;
  secret: Buffer;
};

function hmac16(payload: Buffer, secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(payload).digest().subarray(0, HMAC_LEN);
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Encode a signed reply token.
 *
 * Produces the 51-char base64url local-part that the inbound Lambda verifies.
 * Byte-identical to `@wraps/core`'s `encodeReplyToken`.
 */
export function encodeReplyToken(input: EncodeReplyTokenInput): string {
  if (input.convId.length !== 8) {
    throw new Error('convId must be 8 bytes');
  }
  if (input.sendId.length !== 8) {
    throw new Error('sendId must be 8 bytes');
  }
  const payload = Buffer.alloc(PAYLOAD_LEN);
  payload.writeUInt8(REPLY_TOKEN_VERSION, 0);
  payload.writeUInt8(input.kid & 0xff, 1);
  input.convId.copy(payload, 2);
  input.sendId.copy(payload, 10);
  payload.writeUInt32BE(input.exp >>> 0, 18);

  const mac = hmac16(payload, input.secret);
  return toBase64Url(Buffer.concat([payload, mac]));
}

/**
 * Generate a random 11-char base64url conversation id (8 random bytes).
 */
export function generateConversationId(): string {
  return toBase64Url(randomBytes(8));
}

/**
 * Generate a random 11-char base64url send id (8 random bytes).
 */
export function generateSendId(): string {
  return toBase64Url(randomBytes(8));
}
