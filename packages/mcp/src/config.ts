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
  agentId: string | undefined;
  enforcerFunction: string | undefined;
  enforcedMode: boolean;
}

let cachedAccountId: string | undefined;

const REGION_NOT_FOUND = `Wraps couldn't resolve an AWS region. Any of these work:

MCP server config:
  add "env": { "AWS_REGION": "us-east-1" } to the wraps entry in your MCP config file

Environment variables:
  export AWS_REGION=us-east-1
  export AWS_DEFAULT_REGION=us-east-1

AWS profile (~/.aws/config):
  aws configure set region us-east-1
  export AWS_PROFILE=<profile-name>`;

/**
 * Resolve the region the way every other AWS tool does: environment first, then
 * the `region` key of the active profile in ~/.aws/config. The SDK's own client
 * config runs that chain, so a user with only AWS_PROFILE set is not blocked.
 */
async function resolveRegion(): Promise<string> {
  const fromEnv = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (fromEnv) {
    return fromEnv;
  }

  const probe = new STSClient({});
  try {
    const resolved = await probe.config.region();
    if (resolved) {
      return resolved;
    }
  } catch {
    // The SDK resolver throws when nothing in the chain supplies a region.
    // Fall through to the ConfigError below, which is the actionable message.
  } finally {
    probe.destroy();
  }

  throw new ConfigError(REGION_NOT_FOUND);
}

export async function loadConfig(): Promise<MCPConfig> {
  const region = await resolveRegion();

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
    const parsed = Number(maxRecipientsRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new ConfigError(
        `Invalid WRAPS_MAX_RECIPIENTS: "${maxRecipientsRaw}". Must be a positive integer.`
      );
    }
    maxRecipients = parsed;
  }

  const allowFromOverride = process.env.WRAPS_ALLOW_FROM_OVERRIDE === 'true';

  const agentId = process.env.WRAPS_AGENT_ID || undefined;
  const enforcerFunction = process.env.WRAPS_AGENT_ENFORCER_ARN || undefined;
  const enforcedMode = Boolean(agentId && enforcerFunction);

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
    agentId,
    enforcerFunction,
    enforcedMode,
  };
}

export function resetAccountIdCache(): void {
  cachedAccountId = undefined;
}
