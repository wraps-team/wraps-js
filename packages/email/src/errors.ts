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
