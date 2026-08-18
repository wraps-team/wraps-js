import { type SESv2Client, SendBulkEmailCommand } from '@aws-sdk/client-sesv2';
import {
  isCredentialsChainError,
  isUnverifiedIdentityError,
  mapAwsSdkError,
  SESError,
  ValidationError,
} from './errors';
import { renderReactEmail } from './react';
import type { BatchEmailEntry, BatchEntryResult, SendBatchParams, SendBatchResult } from './types';
import { htmlToPlainText } from './utils/html-to-text';
import { normalizeEmailAddress, normalizeEmailAddresses } from './utils/validation';

const MAX_ENTRIES = 100;
const CHUNK_SIZE = 50;

interface ResolvedEntry {
  to: string;
  subject: string;
  html: string;
  text: string;
  tags?: Record<string, string>;
}

/**
 * Pre-process entries: validate and render React components
 */
async function resolveEntries(entries: BatchEmailEntry[]): Promise<ResolvedEntry[]> {
  const resolved: ResolvedEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];

    if (!entry.subject) {
      throw new ValidationError(
        `Entry ${i}: missing required field "subject"`,
        `entries[${i}].subject`
      );
    }

    if (!entry.to) {
      throw new ValidationError(`Entry ${i}: missing required field "to"`, `entries[${i}].to`);
    }

    if (!entry.html && !entry.text && !entry.react) {
      throw new ValidationError(
        `Entry ${i}: must provide at least one of "html", "text", or "react"`,
        `entries[${i}]`
      );
    }

    if (entry.html && entry.react) {
      throw new ValidationError(
        `Entry ${i}: cannot provide both "html" and "react"`,
        `entries[${i}]`
      );
    }

    let html = entry.html || '';
    let text = entry.text || '';

    if (entry.react) {
      const rendered = await renderReactEmail(entry.react);
      html = rendered.html;
      text = text || rendered.text;
    }

    // Auto-generate plain text from HTML when not explicitly provided
    if (html && !text) {
      text = htmlToPlainText(html);
    }

    resolved.push({
      to: normalizeEmailAddress(entry.to),
      subject: entry.subject,
      html,
      text,
      tags: entry.tags,
    });
  }

  return resolved;
}

/**
 * Send a chunk of up to 50 entries via SES v2 SendBulkEmailCommand
 */
async function sendChunk(
  sesv2Client: SESv2Client,
  params: SendBatchParams,
  resolvedEntries: ResolvedEntry[],
  startIndex: number
): Promise<BatchEntryResult[]> {
  const command = new SendBulkEmailCommand({
    FromEmailAddress: normalizeEmailAddress(params.from),
    ReplyToAddresses: params.replyTo ? normalizeEmailAddresses(params.replyTo) : undefined,
    DefaultContent: {
      Template: {
        TemplateContent: {
          Subject: '{{subject}}',
          Html: '{{htmlContent}}',
          Text: '{{textContent}}',
        },
        TemplateData: JSON.stringify({ subject: '', htmlContent: '', textContent: '' }),
      },
    },
    BulkEmailEntries: resolvedEntries.map((entry) => ({
      Destination: {
        ToAddresses: [entry.to],
      },
      ReplacementEmailContent: {
        ReplacementTemplate: {
          ReplacementTemplateData: JSON.stringify({
            subject: entry.subject,
            htmlContent: entry.html,
            textContent: entry.text,
          }),
        },
      },
      ReplacementTags: entry.tags
        ? Object.entries(entry.tags).map(([Name, Value]) => ({ Name, Value }))
        : undefined,
    })),
    DefaultEmailTags: params.tags
      ? Object.entries(params.tags).map(([Name, Value]) => ({ Name, Value }))
      : undefined,
    ConfigurationSetName: params.configurationSetName,
  });

  // Errors propagate raw: the caller maps them once, with the resolved region.
  const response = await sesv2Client.send(command);

  if (!response.BulkEmailEntryResults) {
    throw new Error('Invalid response from SES: missing BulkEmailEntryResults');
  }

  return response.BulkEmailEntryResults.map((result, i) => {
    const status = result.Status === 'SUCCESS' ? 'success' : 'failure';
    return {
      index: startIndex + i,
      messageId: result.MessageId,
      status,
      error: result.Error,
    } as BatchEntryResult;
  });
}

/**
 * Region the batch client actually sends to, so a chunk failure caused by an
 * identity verified elsewhere reads as a region problem rather than a mystery.
 */
async function resolveClientRegion(sesv2Client: SESv2Client): Promise<string | undefined> {
  try {
    return await sesv2Client.config.region();
  } catch {
    return undefined;
  }
}

function describeChunkError(error: unknown, region: string | undefined): string {
  const mapped = mapAwsSdkError(error, 'SES request failed', { region });
  if (mapped instanceof SESError) {
    return `${mapped.code}: ${mapped.message}${mapped.retryable ? ' (retryable)' : ''}`;
  }
  if (mapped instanceof Error) {
    return mapped.message;
  }
  return 'Chunk-level SES error';
}

/**
 * Send batch emails with unique content per recipient.
 *
 * Uses SES v2 `SendBulkEmailCommand` with inline template content.
 * Each entry can have its own subject, html, and text.
 *
 * Never rejects on a send failure — partial *and* total failures come back as
 * per-entry `status: 'failure'` rows in the resolved result, including
 * chunk-level SES errors. Always inspect `failureCount`.
 *
 * A credential-chain failure is the exception: nothing was ever sent, so it
 * throws rather than reporting every entry as failed with the same message.
 *
 * @param sesv2Client - SES v2 client instance
 * @param params - Batch send parameters
 * @returns Aggregated results for all entries
 * @throws {ValidationError} On an empty, oversized, or malformed entries array.
 * @throws {CredentialsError} When the AWS credential chain produced nothing.
 */
export async function sendBatch(
  sesv2Client: SESv2Client,
  params: SendBatchParams
): Promise<SendBatchResult> {
  if (!params.entries || params.entries.length === 0) {
    throw new ValidationError('entries array must not be empty', 'entries');
  }

  if (params.entries.length > MAX_ENTRIES) {
    throw new ValidationError(
      `Maximum ${MAX_ENTRIES} entries allowed per batch (got ${params.entries.length})`,
      'entries'
    );
  }

  const resolved = await resolveEntries(params.entries);

  const chunkOffsets: number[] = [];
  for (let offset = 0; offset < resolved.length; offset += CHUNK_SIZE) {
    chunkOffsets.push(offset);
  }

  // Only the unverified-identity message names the region, and resolving it can
  // walk to IMDS. Resolve on first need, at most once for the whole batch.
  let regionOnce: Promise<string | undefined> | undefined;
  const region = () => {
    regionOnce ??= resolveClientRegion(sesv2Client);
    return regionOnce;
  };

  const chunkResultSets = await Promise.all(
    chunkOffsets.map(async (offset) => {
      const chunk = resolved.slice(offset, offset + CHUNK_SIZE);
      try {
        return await sendChunk(sesv2Client, params, chunk, offset);
      } catch (error) {
        // Nothing was signed, so no entry was attempted. Reporting this as N
        // identical failure rows would bury one credential problem in N copies
        // of the same multi-line guidance.
        if (isCredentialsChainError(error)) {
          throw mapAwsSdkError(error, 'SES request failed');
        }
        const detail = describeChunkError(
          error,
          isUnverifiedIdentityError(error) ? await region() : undefined
        );
        return chunk.map((_, i) => ({
          index: offset + i,
          status: 'failure' as const,
          error: detail,
        }));
      }
    })
  );

  const allResults: BatchEntryResult[] = chunkResultSets.flat().sort((a, b) => a.index - b.index);

  const successCount = allResults.filter((r) => r.status === 'success').length;
  const failureCount = allResults.filter((r) => r.status === 'failure').length;

  return {
    results: allResults,
    successCount,
    failureCount,
  };
}
