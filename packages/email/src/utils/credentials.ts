import { SESClient, type SESClientConfig } from '@aws-sdk/client-ses';
import { fromTokenFile } from '@aws-sdk/credential-providers';
import type { WrapsEmailConfig } from '../types';
import { USER_AGENT } from '../version';

/** Last resort only, after the whole resolution chain has come up empty. */
const FALLBACK_REGION = 'us-east-1';

/** Async region provider, the shape AWS SDK v3 client config accepts. */
export type RegionProvider = () => Promise<string>;

async function resolveRegionOnce(explicit?: string): Promise<string> {
  if (explicit) {
    return explicit;
  }

  const fromEnv = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (fromEnv) {
    return fromEnv;
  }

  // A region-less client runs the SDK's own chain (shared config profile, then
  // IMDS). Probing it costs no network call unless the caller is actually on
  // EC2 with nothing else configured.
  const probe = new SESClient({});
  try {
    const resolved = await probe.config.region();
    if (resolved) {
      return resolved;
    }
  } catch {
    // The SDK resolver throws when nothing in the chain supplies a region.
    // Fall through to the fallback below.
  } finally {
    probe.destroy();
  }

  return FALLBACK_REGION;
}

/**
 * Resolve the region the way every other AWS tool does, in this order:
 * explicit config > `AWS_REGION` > `AWS_DEFAULT_REGION` > active profile
 * (`~/.aws/config`) or IMDS > `us-east-1`.
 *
 * Ported from `resolveRegion()` in `@wraps.dev/mcp` (`src/config.ts`). Returns a
 * provider rather than a string so the profile/IMDS legs stay lazy and off the
 * constructor's synchronous path; the result is memoized, so the probe runs at
 * most once per client.
 *
 * The previous `config.region || 'us-east-1'` hardcoded the fallback into the
 * client config, which *disabled* the SDK's own resolution and silently ignored
 * `AWS_REGION`.
 */
export function resolveRegion(explicit?: string): RegionProvider {
  let cached: Promise<string> | undefined;
  return () => {
    if (!cached) {
      cached = resolveRegionOnce(explicit);
    }
    return cached;
  };
}

/**
 * Region + user-agent every AWS client this SDK creates should carry. Callers
 * pass a shared `region` provider so one WrapsEmail instance resolves the region
 * once for all of its clients.
 */
export function baseClientConfig(region: RegionProvider): {
  region: RegionProvider;
  customUserAgent: string;
} {
  return { region, customUserAgent: USER_AGENT };
}

export function createSESClient(config: WrapsEmailConfig, region?: RegionProvider): SESClient {
  // Priority 1: If pre-configured client is provided, use it directly
  if (config.client) {
    return config.client;
  }

  // Priority 2+: Create client based on config options
  const clientConfig: SESClientConfig = baseClientConfig(region ?? resolveRegion(config.region));

  // Resolve roleArn from config or AWS_ROLE_ARN environment variable
  const roleArn = config.roleArn || process.env.AWS_ROLE_ARN;

  if (roleArn) {
    const roleSessionName = config.roleSessionName || 'wraps-email-session';

    if (process.env.VERCEL) {
      // Vercel uses @vercel/oidc-aws-credentials-provider for OIDC token exchange.
      // Dynamic import keeps it out of the bundle and defers loading to credential resolution time.
      clientConfig.credentials = async () => {
        let awsCredentialsProvider: typeof import('@vercel/oidc-aws-credentials-provider').awsCredentialsProvider;

        // Only the import is guarded — a missing package is the one failure we
        // can give actionable advice for. Everything after this rethrows as-is
        // so real STS/OIDC failures aren't misreported as a missing dependency.
        try {
          ({ awsCredentialsProvider } = await import('@vercel/oidc-aws-credentials-provider'));
        } catch (err) {
          const error = new Error(
            'On Vercel with roleArn requires @vercel/oidc-aws-credentials-provider. Install it: pnpm add @vercel/oidc-aws-credentials-provider'
          );
          // Assigned rather than passed to the constructor: this package targets
          // ES2020, which predates the Error `cause` option.
          (error as Error & { cause?: unknown }).cause = err;
          throw error;
        }

        return awsCredentialsProvider({ roleArn, roleSessionName })();
      };
    } else {
      // EKS, GitHub Actions, and other OIDC environments use AWS_WEB_IDENTITY_TOKEN_FILE
      clientConfig.credentials = fromTokenFile({
        roleArn,
        roleSessionName,
      });
    }
  }
  // If explicit credentials provided, use them
  else if (config.credentials) {
    // Check if it's a credential provider (function) or static credentials (object with accessKeyId)
    if (typeof config.credentials === 'function' || !('accessKeyId' in config.credentials)) {
      // It's a credential provider - pass it directly to SESClient
      clientConfig.credentials = config.credentials;
    } else {
      // It's static credentials - structure them correctly
      clientConfig.credentials = {
        accessKeyId: config.credentials.accessKeyId,
        secretAccessKey: config.credentials.secretAccessKey,
        sessionToken: config.credentials.sessionToken,
      };
    }
  }
  // Otherwise, AWS SDK will use credential chain:
  // 1. Environment variables (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
  // 2. Shared credentials file (~/.aws/credentials)
  // 3. ECS container credentials
  // 4. EC2 instance metadata

  // Custom endpoint for testing
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
  }

  return new SESClient(clientConfig);
}
