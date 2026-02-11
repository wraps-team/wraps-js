import { SendBulkEmailCommand, type SESv2Client } from '@aws-sdk/client-sesv2';
import { SESError, ValidationError } from './errors';
import { renderReactEmail } from './react';
import type {
  BatchEmailEntry,
  BatchEntryResult,
  SendBatchParams,
  SendBatchResult,
} from './types';
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
      throw new ValidationError(`Entry ${i}: missing required field "subject"`, `entries[${i}].subject`);
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

  try {
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
  } catch (error) {
    throw handleSESv2Error(error);
  }
}

function handleSESv2Error(error: unknown): Error {
  const err = error as {
    $metadata?: { requestId?: string };
    $retryable?: { throttling?: boolean };
    message?: string;
    name?: string;
  };
  if (err.$metadata) {
    return new SESError(
      err.message || 'SES request failed',
      err.name || 'Unknown',
      err.$metadata.requestId || 'unknown',
      err.$retryable?.throttling || false
    );
  }
  return error as Error;
}

/**
 * Send batch emails with unique content per recipient.
 *
 * Uses SES v2 `SendBulkEmailCommand` with inline template content.
 * Each entry can have its own subject, html, and text.
 *
 * @param sesv2Client - SES v2 client instance
 * @param params - Batch send parameters
 * @returns Aggregated results for all entries
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

  const allResults: BatchEntryResult[] = [];

  // Process in chunks of 50
  for (let offset = 0; offset < resolved.length; offset += CHUNK_SIZE) {
    const chunk = resolved.slice(offset, offset + CHUNK_SIZE);

    try {
      const chunkResults = await sendChunk(sesv2Client, params, chunk, offset);
      allResults.push(...chunkResults);
    } catch {
      // Chunk-level failure: mark all entries in this chunk as failed
      for (let i = 0; i < chunk.length; i++) {
        allResults.push({
          index: offset + i,
          status: 'failure',
          error: 'Chunk-level SES error',
        });
      }
    }
  }

  const successCount = allResults.filter((r) => r.status === 'success').length;
  const failureCount = allResults.filter((r) => r.status === 'failure').length;

  return {
    results: allResults,
    successCount,
    failureCount,
  };
}
