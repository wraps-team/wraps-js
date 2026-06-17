import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { ConfigError } from './errors.ts';

export interface MCPConfig {
  region: string;
  historyTableName: string;
  accountId: string;
  writeEnabled: boolean;
  fromEmail: string | undefined;
  configurationSetName: string | undefined;
  allowedRecipients: string[];
  allowedRecipientDomains: string[];
  maxRecipients: number;
  allowFromOverride: boolean;
}

let cachedAccountId: string | undefined;

export async function loadConfig(): Promise<MCPConfig> {
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new ConfigError('AWS region is required. Set AWS_REGION or AWS_DEFAULT_REGION.');
  }

  const historyTableName = process.env.WRAPS_HISTORY_TABLE_NAME || 'wraps-email-history';
  const writeEnabled = process.env.WRAPS_WRITE_ENABLED === 'true';
  const fromEmail = process.env.WRAPS_FROM_EMAIL;
  const configurationSetName = process.env.WRAPS_CONFIGURATION_SET;

  const allowedRecipients = (process.env.WRAPS_ALLOWED_RECIPIENTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const allowedRecipientDomains = (process.env.WRAPS_ALLOWED_RECIPIENT_DOMAINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);

  const maxRecipientsRaw = process.env.WRAPS_MAX_RECIPIENTS;
  let maxRecipients = 50;
  if (maxRecipientsRaw !== undefined) {
    const parsed = Number.parseInt(maxRecipientsRaw, 10);
    if (Number.isNaN(parsed) || parsed <= 0) {
      throw new ConfigError(
        `Invalid WRAPS_MAX_RECIPIENTS: "${maxRecipientsRaw}". Must be a positive integer.`
      );
    }
    maxRecipients = parsed;
  }

  const allowFromOverride = process.env.WRAPS_ALLOW_FROM_OVERRIDE === 'true';

  let accountId = process.env.WRAPS_ACCOUNT_ID || cachedAccountId;
  if (!accountId) {
    const sts = new STSClient({ region });
    const response = await sts.send(new GetCallerIdentityCommand({}));
    if (!response.Account) {
      throw new ConfigError('STS GetCallerIdentity did not return an Account ID.');
    }
    accountId = response.Account;
    cachedAccountId = accountId;
  }

  return {
    region,
    historyTableName,
    accountId,
    writeEnabled,
    fromEmail,
    configurationSetName,
    allowedRecipients,
    allowedRecipientDomains,
    maxRecipients,
    allowFromOverride,
  };
}

export function resetAccountIdCache(): void {
  cachedAccountId = undefined;
}
