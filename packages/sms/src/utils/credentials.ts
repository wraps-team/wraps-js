import {
  PinpointSMSVoiceV2Client,
  type PinpointSMSVoiceV2ClientConfig,
} from '@aws-sdk/client-pinpoint-sms-voice-v2';
import { fromTokenFile, fromWebToken } from '@aws-sdk/credential-providers';
import type { WrapsSMSConfig } from '../types';

/**
 * Create a configured Pinpoint SMS Voice V2 client based on the provided config
 */
export function createSMSClient(config: WrapsSMSConfig): PinpointSMSVoiceV2Client {
  // Priority 1: If pre-configured client is provided, use it directly
  if (config.client) {
    return config.client;
  }

  // Priority 2+: Create client based on config options
  const clientConfig: PinpointSMSVoiceV2ClientConfig = {
    region: config.region || 'us-east-1',
  };

  // If roleArn is provided, use AssumeRoleWithWebIdentity for OIDC federation
  if (config.roleArn) {
    const roleSessionName = config.roleSessionName || 'wraps-sms-session';
    const vercelToken = process.env.VERCEL_OIDC_TOKEN;

    if (vercelToken) {
      // Vercel provides OIDC tokens via environment variable, not a token file
      clientConfig.credentials = fromWebToken({
        roleArn: config.roleArn,
        roleSessionName,
        webIdentityToken: vercelToken,
      });
    } else {
      // EKS, GitHub Actions, and other OIDC environments use AWS_WEB_IDENTITY_TOKEN_FILE
      clientConfig.credentials = fromTokenFile({
        roleArn: config.roleArn,
        roleSessionName,
      });
    }
  }
  // If explicit credentials provided, use them
  // This can be either static credentials or a credential provider
  else if (config.credentials) {
    // Check if it's a credential provider (function) or static credentials (object with accessKeyId)
    if (typeof config.credentials === 'function' || !('accessKeyId' in config.credentials)) {
      // It's a credential provider - pass it directly
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

  // Custom endpoint for testing (e.g., LocalStack)
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
  }

  return new PinpointSMSVoiceV2Client(clientConfig);
}
