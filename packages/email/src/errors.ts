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
