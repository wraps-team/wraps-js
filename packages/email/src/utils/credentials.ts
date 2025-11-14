import { SESClient, type SESClientConfig } from '@aws-sdk/client-ses';
import { fromTokenFile } from '@aws-sdk/credential-providers';
import type { WrapsEmailConfig } from '../types';

export function createSESClient(config: WrapsEmailConfig): SESClient {
  const clientConfig: SESClientConfig = {
    region: config.region || 'us-east-1',
  };

  // If roleArn is provided, use AssumeRoleWithWebIdentity for OIDC federation
  if (config.roleArn) {
    // fromTokenFile automatically reads from AWS_WEB_IDENTITY_TOKEN_FILE environment variable
    // This is commonly set in EKS, GitHub Actions, and other OIDC-enabled environments
    clientConfig.credentials = fromTokenFile({
      roleArn: config.roleArn,
      roleSessionName: config.roleSessionName || 'wraps-email-session',
      // Optionally specify a custom token file path (defaults to AWS_WEB_IDENTITY_TOKEN_FILE env var)
      // webIdentityTokenFile: process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
    });
  }
  // If explicit credentials provided, use them
  else if (config.credentials) {
    clientConfig.credentials = {
      accessKeyId: config.credentials.accessKeyId,
      secretAccessKey: config.credentials.secretAccessKey,
      sessionToken: config.credentials.sessionToken,
    };
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
