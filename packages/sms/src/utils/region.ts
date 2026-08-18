/**
 * Resolve the AWS region for the SMS client.
 *
 * Precedence matches `resolveRegion()` in `@wraps.dev/mcp` (`src/config.ts`):
 * an explicit value first, then the environment. Anything past that — the
 * `region` key of the active profile in ~/.aws/config, ECS/EC2 metadata — is
 * resolved by the AWS SDK's own asynchronous chain, so this returns
 * `undefined` and the caller leaves `region` off the client config entirely.
 *
 * Returning `undefined` rather than a hardcoded default is the whole point:
 * setting `region` explicitly *disables* the SDK's resolution chain, which is
 * how `AWS_REGION` came to be silently ignored.
 */
export function resolveRegion(explicitRegion?: string): string | undefined {
  if (explicitRegion) {
    return explicitRegion;
  }

  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || undefined;
}
