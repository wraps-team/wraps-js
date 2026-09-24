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

/**
 * The history tools read a DynamoDB table that only a Wraps deploy creates. On a
 * plain SES account the SDK surfaces that as a bare "Requested resource not
 * found", which names neither the table nor the fix. Matched on the positive
 * name only: v3 error names are unreliable, so a non-match proves nothing.
 */
export function missingHistoryTableMessage(
  error: unknown,
  tableName: string,
  region: string
): string | undefined {
  const err = error as { name?: string; message?: string };
  const notFound =
    err?.name === 'ResourceNotFoundException' ||
    (typeof err?.message === 'string' && err.message.includes('Requested resource not found'));
  if (!notFound) {
    return undefined;
  }
  return [
    `No email history table named ${tableName} in ${region}.`,
    '',
    'Send history and delivery events are recorded by the Wraps event pipeline, which `wraps email init` deploys into your AWS account. If it is deployed in another region, restart this MCP server with AWS_REGION set to that region; if the table has a custom name, set WRAPS_HISTORY_TABLE_NAME.',
    '',
    'The other tools (send_email, verify_domain_status, list_suppressions, get_setup_status, estimate_cost) work on any SES account without it.',
  ].join('\n');
}
