export class WrapsMCPError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WrapsMCPError';
  }
}

export class ConfigError extends WrapsMCPError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
