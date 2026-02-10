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
    private tableName: string,
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
      const response = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'messageId = :mid',
          ExpressionAttributeValues: {
            ':mid': messageId,
          },
          ScanIndexForward: true,
        }),
      );

      if (!response.Items || response.Items.length === 0) {
        return null;
      }

      return this.aggregateStatus(response.Items);
    } catch (error) {
      throw this.handleDynamoDBError(error);
    }
  }

  /**
   * List emails with events, queried via the accountId-sentAt GSI
   * Requires accountId for efficient querying
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
          Buffer.from(options.continuationToken, 'base64').toString('utf-8'),
        );
      } catch {
        throw new ValidationError('Invalid continuation token', 'continuationToken');
      }
    }

    try {
      const response = await this.client.send(
        new QueryCommand({
          TableName: this.tableName,
          IndexName: 'accountId-sentAt-index',
          KeyConditionExpression: keyCondition,
          ExpressionAttributeValues: expressionValues,
          ScanIndexForward: false,
          Limit: limit,
          ExclusiveStartKey: exclusiveStartKey,
        }),
      );

      const items = response.Items || [];

      // Group items by messageId
      const grouped = new Map<string, Record<string, unknown>[]>();
      for (const item of items) {
        const mid = item.messageId as string;
        if (!grouped.has(mid)) {
          grouped.set(mid, []);
        }
        grouped.get(mid)!.push(item);
      }

      // Aggregate each group into an EmailStatus
      const emails: EmailStatus[] = [];
      for (const groupItems of grouped.values()) {
        emails.push(this.aggregateStatus(groupItems));
      }

      let nextToken: string | undefined;
      if (response.LastEvaluatedKey) {
        nextToken = Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64');
      }

      return { emails, nextToken };
    } catch (error) {
      throw this.handleDynamoDBError(error);
    }
  }

  private aggregateStatus(items: Record<string, unknown>[]): EmailStatus {
    const first = items[0];

    const events: EmailEvent[] = items.map((item) => {
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

    // Sort events chronologically
    events.sort((a, b) => a.timestamp - b.timestamp);

    const to = Array.isArray(first.to) ? (first.to as string[]) : [first.to as string];

    return {
      messageId: first.messageId as string,
      from: first.from as string,
      to,
      subject: (first.subject as string) || '',
      status: deriveStatus(events),
      sentAt: events[0].timestamp,
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
        err.$retryable?.throttling || false,
      );
    }
    return error instanceof Error ? error : new Error(String(error));
  }
}
