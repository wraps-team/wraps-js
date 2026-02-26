import { SESClient, type SESClientConfig } from '@aws-sdk/client-ses';
import { fromTokenFile } from '@aws-sdk/credential-providers';
import type { WrapsEmailConfig } from '../types';

export function createSESClient(config: WrapsEmailConfig): SESClient {
  // Priority 1: If pre-configured client is provided, use it directly
  if (config.client) {
    return config.client;
  }

  // Priority 2+: Create client based on config options
  const clientConfig: SESClientConfig = {
    region: config.region || 'us-east-1',
  };

  // Resolve roleArn from config or AWS_ROLE_ARN environment variable
  const roleArn = config.roleArn || process.env.AWS_ROLE_ARN;

  if (roleArn) {
    const roleSessionName = config.roleSessionName || 'wraps-email-session';

    if (process.env.VERCEL) {
      // Vercel uses @vercel/oidc-aws-credentials-provider for OIDC token exchange
      try {
        const { awsCredentialsProvider } = require('@vercel/oidc-aws-credentials-provider');
        clientConfig.credentials = awsCredentialsProvider({
          roleArn,
          roleSessionName,
        });
      } catch {
        throw new Error(
          'On Vercel with roleArn requires @vercel/oidc-aws-credentials-provider. Install it: pnpm add @vercel/oidc-aws-credentials-provider',
        );
      }
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
