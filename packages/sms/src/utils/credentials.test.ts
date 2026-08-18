import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSMSClient } from './credentials';
import { resolveRegion } from './region';

// Deliberately NOT mocking @aws-sdk/client-pinpoint-sms-voice-v2: the point of
// these tests is what the real AWS client actually resolves its region to.

const REGION_ENV_KEYS = [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_PROFILE',
  'AWS_ROLE_ARN',
] as const;

describe('resolveRegion', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of REGION_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of REGION_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('prefers an explicit region over the environment', () => {
    process.env.AWS_REGION = 'eu-west-1';
    expect(resolveRegion('ap-southeast-2')).toBe('ap-southeast-2');
  });

  it('reads AWS_REGION when no explicit region is given', () => {
    process.env.AWS_REGION = 'eu-west-1';
    expect(resolveRegion()).toBe('eu-west-1');
  });

  it('falls back to AWS_DEFAULT_REGION', () => {
    process.env.AWS_DEFAULT_REGION = 'eu-central-1';
    expect(resolveRegion()).toBe('eu-central-1');
  });

  it('prefers AWS_REGION over AWS_DEFAULT_REGION', () => {
    process.env.AWS_REGION = 'eu-west-1';
    process.env.AWS_DEFAULT_REGION = 'eu-central-1';
    expect(resolveRegion()).toBe('eu-west-1');
  });

  it('returns undefined when nothing is set, leaving the AWS chain to resolve', () => {
    expect(resolveRegion()).toBeUndefined();
  });

  it('does not treat an empty AWS_REGION as a region', () => {
    process.env.AWS_REGION = '';
    process.env.AWS_DEFAULT_REGION = 'us-west-2';
    expect(resolveRegion()).toBe('us-west-2');
  });
});

describe('createSMSClient region resolution', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of REGION_ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of REGION_ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it('honours AWS_REGION — the defect this replaces pinned us-east-1', async () => {
    process.env.AWS_REGION = 'eu-west-1';

    const client = createSMSClient({});
    await expect(client.config.region()).resolves.toBe('eu-west-1');
    client.destroy();
  });

  it('honours AWS_DEFAULT_REGION', async () => {
    process.env.AWS_DEFAULT_REGION = 'ap-southeast-2';

    const client = createSMSClient({});
    await expect(client.config.region()).resolves.toBe('ap-southeast-2');
    client.destroy();
  });

  it('lets an explicit config region win over the environment', async () => {
    process.env.AWS_REGION = 'eu-west-1';

    const client = createSMSClient({ region: 'us-west-2' });
    await expect(client.config.region()).resolves.toBe('us-west-2');
    client.destroy();
  });

  it('does not silently substitute us-east-1', async () => {
    process.env.AWS_REGION = 'eu-central-1';

    const client = createSMSClient({});
    await expect(client.config.region()).resolves.not.toBe('us-east-1');
    client.destroy();
  });
});

describe('createSMSClient user agent', () => {
  it('tags requests as wraps-sms/<version>', () => {
    const client = createSMSClient({ region: 'us-east-1' });

    // Asserted against package.json so a stale or missing build-time define
    // fails here rather than shipping `0.0.0-dev` to AWS.
    const { version: packageVersion } = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    ) as { version: string };

    // The AWS SDK normalizes a string customUserAgent into a UserAgent pair
    // list; a single-element pair renders verbatim in the User-Agent header.
    expect(client.config.customUserAgent).toEqual([[`wraps-sms/${packageVersion}`]]);

    client.destroy();
  });

  it('leaves a caller-supplied client untouched', () => {
    const preconfigured = createSMSClient({ region: 'us-east-1' });
    const wrapped = createSMSClient({ client: preconfigured });

    expect(wrapped).toBe(preconfigured);
    preconfigured.destroy();
  });
});
