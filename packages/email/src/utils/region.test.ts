import { SESClient } from '@aws-sdk/client-ses';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WrapsEmail } from '../client';
import { USER_AGENT, VERSION } from '../version';
import { createSESClient, resolveRegion } from './credentials';

// Region resolution reads real env vars and, when they're empty, the AWS SDK's
// own chain — so these tests own the environment for their duration.
const OWNED_ENV = [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_CONFIG_FILE',
  'AWS_SDK_LOAD_CONFIG',
  'AWS_EC2_METADATA_DISABLED',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const key of OWNED_ENV) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  // Keep the profile/IMDS leg from reaching the developer's real ~/.aws/config
  // or hanging on instance metadata in CI.
  process.env.AWS_CONFIG_FILE = '/nonexistent/wraps-email-test-config';
  process.env.AWS_EC2_METADATA_DISABLED = 'true';
});

afterEach(() => {
  for (const key of OWNED_ENV) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }
});

describe('resolveRegion', () => {
  it('honors AWS_REGION when no region is passed', async () => {
    process.env.AWS_REGION = 'eu-west-1';

    await expect(resolveRegion()()).resolves.toBe('eu-west-1');
  });

  it('falls back to AWS_DEFAULT_REGION when AWS_REGION is unset', async () => {
    process.env.AWS_DEFAULT_REGION = 'ap-southeast-2';

    await expect(resolveRegion()()).resolves.toBe('ap-southeast-2');
  });

  it('reads AWS_DEFAULT_REGION itself, because the AWS SDK chain does not', async () => {
    process.env.AWS_DEFAULT_REGION = 'ap-southeast-2';

    // Measured on @aws-sdk/client-ses 3.928.0: the SDK's own resolution chain
    // honors AWS_REGION only and throws "Region is missing" for
    // AWS_DEFAULT_REGION. So the explicit env read in resolveRegion() is
    // load-bearing — deleting it in favor of "just let the SDK resolve" would
    // silently send AWS_DEFAULT_REGION users to us-east-1.
    const bare = new SESClient({});
    await expect(bare.config.region()).rejects.toThrow(/Region is missing/);
    bare.destroy();

    await expect(resolveRegion()()).resolves.toBe('ap-southeast-2');
  });

  it('prefers AWS_REGION over AWS_DEFAULT_REGION', async () => {
    process.env.AWS_REGION = 'eu-central-1';
    process.env.AWS_DEFAULT_REGION = 'us-west-2';

    await expect(resolveRegion()()).resolves.toBe('eu-central-1');
  });

  it('lets an explicit region win over both env vars', async () => {
    process.env.AWS_REGION = 'eu-west-1';
    process.env.AWS_DEFAULT_REGION = 'us-west-2';

    await expect(resolveRegion('ca-central-1')()).resolves.toBe('ca-central-1');
  });

  it('falls back to us-east-1 only when the whole chain is empty', async () => {
    await expect(resolveRegion()()).resolves.toBe('us-east-1');
  });

  it('resolves once and reuses the answer', async () => {
    process.env.AWS_REGION = 'eu-west-1';
    const provider = resolveRegion();

    await expect(provider()).resolves.toBe('eu-west-1');
    // A later env change must not shift the region under an in-flight client.
    process.env.AWS_REGION = 'us-west-2';
    await expect(provider()).resolves.toBe('eu-west-1');
  });
});

describe('SES client region', () => {
  it('sends to AWS_REGION, not the hardcoded default', async () => {
    process.env.AWS_REGION = 'eu-west-1';
    const client = createSESClient({});

    await expect(client.config.region()).resolves.toBe('eu-west-1');
    client.destroy();
  });

  it('uses an explicit region over AWS_REGION', async () => {
    process.env.AWS_REGION = 'eu-west-1';
    const client = createSESClient({ region: 'us-west-2' });

    await expect(client.config.region()).resolves.toBe('us-west-2');
    client.destroy();
  });

  it('gives every client the WrapsEmail instance builds the same region', async () => {
    process.env.AWS_REGION = 'ap-northeast-1';
    const email = new WrapsEmail({ historyTableName: 'wraps-email-history' });

    const clients = email as unknown as {
      sesClient: SESClient;
      sesv2Client: { config: { region: () => Promise<string> } };
    };

    await expect(clients.sesClient.config.region()).resolves.toBe('ap-northeast-1');
    await expect(clients.sesv2Client.config.region()).resolves.toBe('ap-northeast-1');
    email.destroy();
  });
});

describe('user agent', () => {
  it('tags SES traffic as wraps-email/<version>', async () => {
    const client = createSESClient({});

    expect(USER_AGENT).toBe(`wraps-email/${VERSION}`);
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    // The SDK normalizes the string into its UserAgent pair form, which
    // serializes back to `wraps-email/<version>` in the request header.
    expect(client.config.customUserAgent).toEqual([[USER_AGENT]]);
    client.destroy();
  });

  it('matches the version in package.json', async () => {
    const pkg = await import('../../package.json', { with: { type: 'json' } });

    expect(VERSION).toBe((pkg.default ?? pkg).version);
  });
});
