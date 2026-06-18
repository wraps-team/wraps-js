export class WrapsEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrapsEmailError';
  }
}

export class ValidationError extends WrapsEmailError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
  }
}

export class SESError extends WrapsEmailError {
  public readonly code: string;
  public readonly requestId: string;
  public readonly retryable: boolean;

  constructor(message: string, code: string, requestId: string, retryable: boolean) {
    super(message);
    this.name = 'SESError';
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

export class DynamoDBError extends WrapsEmailError {
  public readonly code: string;
  public readonly requestId: string;
  public readonly retryable: boolean;

  constructor(message: string, code: string, requestId: string, retryable: boolean) {
    super(message);
    this.name = 'DynamoDBError';
    this.code = code;
    this.requestId = requestId;
    this.retryable = retryable;
  }
}

export class BatchError extends WrapsEmailError {
  public readonly results: import('./types').BatchEntryResult[];
  public readonly successCount: number;
  public readonly failureCount: number;

  constructor(
    message: string,
    results: import('./types').BatchEntryResult[],
    successCount: number,
    failureCount: number
  ) {
    super(message);
    this.name = 'BatchError';
    this.results = results;
    this.successCount = successCount;
    this.failureCount = failureCount;
  }
}

/**
 * Map an AWS SDK v3 client error into a {@link SESError}. AWS SDK errors carry
 * `$metadata` (with `requestId`) and an optional `$retryable.throttling` flag.
 * Non-AWS errors are returned unchanged.
 *
 * @param error - The caught error from an AWS SDK `.send()` call.
 * @param fallbackMessage - Message used when the error has no `.message`.
 * @returns A `SESError` when the error looks like an AWS SDK error, else the
 *   original error.
 */
export function mapAwsSdkError(error: unknown, fallbackMessage = 'SES request failed'): Error {
  const err = error as {
    $metadata?: { requestId?: string };
    $retryable?: { throttling?: boolean };
    message?: string;
    name?: string;
  };
  if (err.$metadata) {
    return new SESError(
      err.message || fallbackMessage,
      err.name || 'Unknown',
      err.$metadata.requestId || 'unknown',
      err.$retryable?.throttling || false
    );
  }
  return error as Error;
}
