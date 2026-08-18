import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBError, ValidationError } from './errors';
import type { EmailEvent, EmailListOptions, EmailListResult, EmailStatus } from './types';

const EVENT_TYPE_MAP: Record<string, EmailStatus['status']> = {
  send: 'sent',
  delivery: 'delivered',
  open: 'opened',
  click: 'clicked',
  bounce: 'bounced',
  complaint: 'complained',
  suppressed: 'suppressed',
};

const STATUS_PRIORITY: Record<string, number> = {
  sent: 3,
  delivered: 4,
  opened: 5,
  clicked: 6,
  suppressed: 7,
  complained: 8,
  bounced: 9,
};

/** Rough events-per-message ratio, used to size the GSI scan against a message limit. */
const EVENTS_PER_MESSAGE_ESTIMATE = 4;

/** Ceiling on GSI pages read per list() call, so a sparse account cannot scan forever. */
const MAX_SCAN_PAGES = 10;

/** Base table keys plus GSI keys — everything DynamoDB needs to resume a query. */
const KEY_ATTRIBUTES = ['messageId', 'sentAt', 'accountId'] as const;

function keyOf(item: Record<string, unknown>): Record<string, unknown> {
  const key: Record<string, unknown> = {};
  for (const attribute of KEY_ATTRIBUTES) {
    if (item[attribute] !== undefined) {
      key[attribute] = item[attribute];
    }
  }
  return key;
}

function deriveStatus(events: EmailEvent[]): EmailStatus['status'] {
  let highest: EmailStatus['status'] = 'sent';
  let highestPriority = STATUS_PRIORITY.sent;

  for (const event of events) {
    const normalized = event.type.toLowerCase();
    const mapped = EVENT_TYPE_MAP[normalized] || normalized;
    const priority = STATUS_PRIORITY[mapped] || 0;
    if (priority > highestPriority) {
      highest = mapped as EmailStatus['status'];
      highestPriority = priority;
    }
  }

  return highest;
}

export class WrapsEmailEvents {
  constructor(
    private client: DynamoDBDocumentClient,
    private tableName: string
  ) {}

  /**
   * Get all events for a single email by messageId
   * Returns null if no events found
   */
  async get(messageId: string): Promise<EmailStatus | null> {
    if (!messageId) {
      throw new ValidationError('messageId is required', 'messageId');
    }

    try {
      return await this.fetchMessage(messageId);
    } catch (error) {
      throw this.handleDynamoDBError(error);
    }
  }

  /**
   * List emails with events, queried via the accountId-sentAt GSI
   * Requires accountId for efficient querying
   *
   * `maxResults` bounds *messages*, not events. The GSI stores one row per
   * event, so a single DynamoDB page holds a mix of partial event sets; this
   * pages until enough distinct messages are found, then re-reads each message's
   * full event set from the base table. Without that second read `sentAt` would
   * be whichever event happened to fall inside the scan window.
   */
  async list(options: EmailListOptions): Promise<EmailListResult> {
    if (!options.accountId) {
      throw new ValidationError('accountId is required for listing events', 'accountId');
    }

    const limit = options.maxResults || 50;

    let keyCondition = 'accountId = :aid';
    const expressionValues: Record<string, unknown> = {
      ':aid': options.accountId,
    };

    if (options.startTime && options.endTime) {
      keyCondition += ' AND sentAt BETWEEN :start AND :end';
      expressionValues[':start'] = options.startTime.getTime();
      expressionValues[':end'] = options.endTime.getTime();
    } else if (options.startTime) {
      keyCondition += ' AND sentAt >= :start';
      expressionValues[':start'] = options.startTime.getTime();
    } else if (options.endTime) {
      keyCondition += ' AND sentAt <= :end';
      expressionValues[':end'] = options.endTime.getTime();
    }

    let exclusiveStartKey: Record<string, unknown> | undefined;
    if (options.continuationToken) {
      try {
        exclusiveStartKey = JSON.parse(
          Buffer.from(options.continuationToken, 'base64').toString('utf-8')
        );
      } catch {
        throw new ValidationError('Invalid continuation token', 'continuationToken');
      }
    }

    // Events per message vary (send, delivery, opens, clicks...), so scan wider
    // than the message limit and page when a scan still comes up short.
    const scanSize = Math.min(Math.max(limit * EVENTS_PER_MESSAGE_ESTIMATE, 40), 500);

    try {
      const messageIds: string[] = [];
      const seen = new Set<string>();
      // Where the next page resumes: the first row of the first message we did
      // not have room for, so nothing between pages is skipped or repeated.
      let cutKey: Record<string, unknown> | undefined;
      let pagesRead = 0;
      let exhausted = false;

      scan: while (pagesRead < MAX_SCAN_PAGES) {
        const response = await this.client.send(
          new QueryCommand({
            TableName: this.tableName,
            IndexName: 'accountId-sentAt-index',
            KeyConditionExpression: keyCondition,
            ExpressionAttributeValues: expressionValues,
            ScanIndexForward: false,
            Limit: scanSize,
            ExclusiveStartKey: exclusiveStartKey,
          })
        );
        pagesRead++;

        for (const item of response.Items || []) {
          const mid = item.messageId as string;
          if (seen.has(mid)) {
            continue;
          }
          if (messageIds.length === limit) {
            cutKey = keyOf(item);
            break scan;
          }
          seen.add(mid);
          messageIds.push(mid);
        }

        exclusiveStartKey = response.LastEvaluatedKey;
        if (!exclusiveStartKey) {
          exhausted = true;
          break;
        }
      }

      // Re-read each message whole. The scan only proves a message exists; its
      // event set is almost always split across the window boundary.
      const hydrated = await Promise.all(messageIds.map((mid) => this.fetchMessage(mid)));
      const emails = hydrated.filter((email): email is EmailStatus => email !== null);
      emails.sort((a, b) => b.sentAt - a.sentAt);

      const resumeKey = cutKey ?? (exhausted ? undefined : exclusiveStartKey);
      const nextToken = resumeKey
        ? Buffer.from(JSON.stringify(resumeKey)).toString('base64')
        : undefined;

      return { emails, nextToken };
    } catch (error) {
      throw this.handleDynamoDBError(error);
    }
  }

  /** All events for one messageId, read from the base table's partition. */
  private async fetchMessage(messageId: string): Promise<EmailStatus | null> {
    const response = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'messageId = :mid',
        ExpressionAttributeValues: {
          ':mid': messageId,
        },
        ScanIndexForward: true,
      })
    );

    if (!response.Items || response.Items.length === 0) {
      return null;
    }

    return this.aggregateStatus(response.Items);
  }

  private aggregateStatus(items: Record<string, unknown>[]): EmailStatus {
    const ordered = [...items].sort((a, b) => (a.sentAt as number) - (b.sentAt as number));

    const events: EmailEvent[] = ordered.map((item) => {
      let metadata: Record<string, unknown> | undefined;
      if (item.additionalData) {
        try {
          metadata = JSON.parse(item.additionalData as string);
        } catch {
          // If parsing fails, skip metadata
        }
      }

      return {
        type: (item.eventType as string).toLowerCase(),
        timestamp: item.sentAt as number,
        metadata,
      };
    });

    // The send event carries the true send time and the envelope fields; opens
    // and bounces may carry neither. Fall back to the earliest event only when
    // the send row is genuinely absent.
    const sendIndex = events.findIndex((event) => event.type === 'send');
    const primaryIndex = sendIndex >= 0 ? sendIndex : 0;
    const primary = ordered[primaryIndex];

    const to = Array.isArray(primary.to) ? (primary.to as string[]) : [primary.to as string];

    return {
      messageId: primary.messageId as string,
      from: primary.from as string,
      to,
      subject: (primary.subject as string) || '',
      status: deriveStatus(events),
      sentAt: events[primaryIndex].timestamp,
      lastEventAt: events[events.length - 1].timestamp,
      events,
    };
  }

  private handleDynamoDBError(error: unknown): Error {
    const err = error as {
      $metadata?: { requestId?: string };
      $retryable?: { throttling?: boolean };
      message?: string;
      name?: string;
    };
    if (err.$metadata) {
      return new DynamoDBError(
        err.message || 'DynamoDB request failed',
        err.name || 'Unknown',
        err.$metadata.requestId || 'unknown',
        err.$retryable?.throttling || false
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
