import type { SESv2Client } from '@aws-sdk/client-sesv2';
import {
  DeleteSuppressedDestinationCommand,
  GetSuppressedDestinationCommand,
  ListSuppressedDestinationsCommand,
  PutSuppressedDestinationCommand,
} from '@aws-sdk/client-sesv2';
import { SESError, ValidationError } from './errors';
import type {
  SuppressionEntry,
  SuppressionListOptions,
  SuppressionListResult,
  SuppressionReason,
} from './types';

export class WrapsEmailSuppression {
  constructor(private client: SESv2Client) {}

  /**
   * Check if an email is on the suppression list
   * Returns the entry if suppressed, null if not
   */
  async get(email: string): Promise<SuppressionEntry | null> {
    if (!email) {
      throw new ValidationError('Email address is required', 'email');
    }

    try {
      const response = await this.client.send(
        new GetSuppressedDestinationCommand({ EmailAddress: email }),
      );

      const dest = response.SuppressedDestination!;
      return {
        email: dest.EmailAddress!,
        reason: dest.Reason as SuppressionReason,
        lastUpdated: dest.LastUpdateTime!,
        messageId: dest.Attributes?.MessageId,
        feedbackId: dest.Attributes?.FeedbackId,
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFoundException') {
        return null;
      }
      throw this.handleError(error);
    }
  }

  /**
   * Add an email to the suppression list
   * Idempotent — succeeds silently if already suppressed
   */
  async add(email: string, reason: SuppressionReason): Promise<void> {
    if (!email) {
      throw new ValidationError('Email address is required', 'email');
    }
    if (reason !== 'BOUNCE' && reason !== 'COMPLAINT') {
      throw new ValidationError('Reason must be BOUNCE or COMPLAINT', 'reason');
    }

    try {
      await this.client.send(
        new PutSuppressedDestinationCommand({
          EmailAddress: email,
          Reason: reason,
        }),
      );
    } catch (error) {
      throw this.handleError(error);
    }
  }

  /**
   * Remove an email from the suppression list
   * Idempotent — silently succeeds if email is not on the list
   */
  async remove(email: string): Promise<void> {
    if (!email) {
      throw new ValidationError('Email address is required', 'email');
    }

    try {
      await this.client.send(
        new DeleteSuppressedDestinationCommand({ EmailAddress: email }),
      );
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFoundException') {
        return;
      }
      throw this.handleError(error);
    }
  }

  /**
   * List suppressed emails with optional filters
   */
  async list(options: SuppressionListOptions = {}): Promise<SuppressionListResult> {
    try {
      const response = await this.client.send(
        new ListSuppressedDestinationsCommand({
          Reasons: options.reason ? [options.reason] : undefined,
          StartDate: options.startDate,
          EndDate: options.endDate,
          PageSize: options.maxResults || 100,
          NextToken: options.continuationToken,
        }),
      );

      const entries: SuppressionEntry[] = (response.SuppressedDestinationSummaries || []).map(
        (s) => ({
          email: s.EmailAddress!,
          reason: s.Reason as SuppressionReason,
          lastUpdated: s.LastUpdateTime!,
        }),
      );

      return {
        entries,
        nextToken: response.NextToken,
      };
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private handleError(error: unknown): Error {
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
        err.$retryable?.throttling || false,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
