import type { SESv2Client } from '@aws-sdk/client-sesv2';
import {
  DeleteSuppressedDestinationCommand,
  GetSuppressedDestinationCommand,
  ListSuppressedDestinationsCommand,
  PutSuppressedDestinationCommand,
} from '@aws-sdk/client-sesv2';
import { isUnverifiedIdentityError, mapAwsSdkError, ValidationError } from './errors';
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
        new GetSuppressedDestinationCommand({ EmailAddress: email })
      );

      const dest = response.SuppressedDestination;
      if (!dest?.EmailAddress || !dest.LastUpdateTime) {
        return null;
      }
      return {
        email: dest.EmailAddress,
        reason: dest.Reason as SuppressionReason,
        lastUpdated: dest.LastUpdateTime,
        messageId: dest.Attributes?.MessageId,
        feedbackId: dest.Attributes?.FeedbackId,
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFoundException') {
        return null;
      }
      throw await this.handleError(error);
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
        })
      );
    } catch (error) {
      throw await this.handleError(error);
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
      await this.client.send(new DeleteSuppressedDestinationCommand({ EmailAddress: email }));
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFoundException') {
        return;
      }
      throw await this.handleError(error);
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
        })
      );

      const entries: SuppressionEntry[] = [];
      for (const s of response.SuppressedDestinationSummaries || []) {
        if (!s.EmailAddress || !s.LastUpdateTime) {
          continue;
        }
        entries.push({
          email: s.EmailAddress,
          reason: s.Reason as SuppressionReason,
          lastUpdated: s.LastUpdateTime,
        });
      }

      return {
        entries,
        nextToken: response.NextToken,
      };
    } catch (error) {
      throw await this.handleError(error);
    }
  }

  /**
   * Route through the shared mapper so a credential-chain failure here becomes
   * a `CredentialsError` rather than escaping as raw AWS text, exactly as it
   * does on the send path.
   */
  private async handleError(error: unknown): Promise<Error> {
    return mapAwsSdkError(error, 'SES request failed', { region: await this.errorRegion(error) });
  }

  /**
   * The region to name in an error, resolved only when the message will use it.
   * Resolution can walk to IMDS, so every other failure skips it.
   */
  private async errorRegion(error: unknown): Promise<string | undefined> {
    if (!isUnverifiedIdentityError(error)) {
      return undefined;
    }
    try {
      return await this.client.config.region();
    } catch {
      return undefined;
    }
  }
}
