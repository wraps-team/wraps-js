// Replaced at build time with the literal `version` from package.json — by
// tsup's `define` for the published bundles, and by vitest's for tests. Reading
// it from the manifest rather than hardcoding keeps the user-agent from drifting
// away from what is actually published.
declare const __WRAPS_EMAIL_VERSION__: string;

export const VERSION: string =
  typeof __WRAPS_EMAIL_VERSION__ === 'string' ? __WRAPS_EMAIL_VERSION__ : '0.0.0-dev';

/**
 * `customUserAgent` for every AWS client this SDK creates, so Wraps-originated
 * SES traffic is identifiable in the customer's own account (CloudTrail, support
 * cases, and telling Wraps sends apart from other SES traffic).
 *
 * Identification only — this SDK sends no telemetry anywhere.
 */
export const USER_AGENT = `wraps-email/${VERSION}`;
