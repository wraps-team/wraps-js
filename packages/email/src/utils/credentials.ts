import { SESClient } from '@aws-sdk/client-ses';
import type { WrapsEmailConfig } from '../types';

export function createSESClient(config: WrapsEmailConfig): SESClient {
  const clientConfig: any = {
    region: config.region || 'us-east-1',
  };

  // If explicit credentials provided, use them
  if (config.credentials) {
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
