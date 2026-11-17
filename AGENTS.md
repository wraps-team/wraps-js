# AGENTS.md - Wraps JS SDKs

`CLAUDE.md` is a symlink to this file; edit this one.

> Writing code that **uses** these packages? Read [docs/using-the-sdks.md](./docs/using-the-sdks.md).
> This file is for changing the repo.

Four packages under the `@wraps.dev` npm namespace: `email` (SES), `sms` (End User Messaging),
`client` (Wraps Platform API, OpenAPI-generated) and `mcp` (MCP server: SES tools over the email SDK,
plus Wraps platform tools). Run what `.github/workflows/ci.yml` runs (lint, typecheck, build, test)
before committing, and update the package `README.md` when you add public API.

## Rules

### BYOC

`email` and `sms` call AWS directly in the user's account with the user's credentials. Nothing goes
through Wraps and nothing reports back: the `wraps-email/<version>` user-agent only identifies
traffic in the user's own CloudTrail. `mcp` does the same for its SES tools, and also calls the
Wraps API for its platform tools (`packages/mcp/src/api-client.ts`). `client` talks only to Wraps,
with an API key, and never touches AWS.

### Credential resolution order

`email` and `sms` resolve credentials in this order. Keep it identical in both:

1. `client`: a pre-configured AWS client, used as-is
2. `roleArn` (or `AWS_ROLE_ARN`): OIDC role assumption
3. `credentials`: a static `{ accessKeyId, secretAccessKey, sessionToken? }` or a provider function
4. Nothing: the AWS credential chain

Accept `credentials` as either shape. A provider function (or any object without `accessKeyId`) goes
to the AWS client untouched; only a static object is destructured.

Region has the same first steps in three places (`packages/email/src/utils/credentials.ts`,
`packages/sms/src/utils/region.ts`, `packages/mcp/src/config.ts`): explicit value, `AWS_REGION`,
`AWS_DEFAULT_REGION`, then the profile or IMDS. Change them together. Hand the AWS client a lazy
resolver (email) or no `region` at all (sms) when none was supplied: a hardcoded `region` turns off
the SDK's own resolution chain, which is how `AWS_REGION` once got ignored.

### Errors

- Every error a package throws extends its base class (`WrapsEmailError`, `WrapsSMSError`), so one
  `instanceof` on the base catches all of them. Wrap AWS's `CredentialsProviderError` in
  `CredentialsError` rather than passing it through.
- Set `this.name` in every error constructor, and give AWS-facing errors a `retryable` boolean.
- `sendBatch()` reports per-entry send failures in its result. A credential failure throws, because
  nothing was attempted. There is no `BatchError`.
- Tests assert error properties (`code`, `requestId`, `retryable`, `field`), not only the class.

### Dependencies

- Declare `@aws-sdk/*` under `dependencies` in email, sms and mcp, so consumers get them installed.
  Keep the ranges wide (`^3.928.0`): a floor raise forces every BYOC consumer onto a newer AWS SDK.
- `react` and `@react-email/components` are the only `peerDependencies`, optional and on email only:
  React.email rendering is opt-in.
- `dist` never inlines the AWS SDK or React. `@vercel/oidc-aws-credentials-provider` is a
  `devDependency` loaded by dynamic import, so keep it in the `external` list of the email and sms
  tsup configs; tsup would otherwise inline it.

### JSDoc

Every public method has JSDoc with `@param`, `@returns`, `@throws` and `@example`. `WrapsEmail.send`
in `packages/email/src/client.ts` is the model.

### Optional features

Features that need extra config are nullable properties: `inbox` is `null` without
`inboxBucketName`, `events` is `null` without `historyTableName`, `suppression` is always there.
Follow that shape for new ones.

### Generated client schema

`packages/client/src/schema.d.ts` is generated. Regenerate it with `pnpm generate` in
`packages/client`; the weekly `.github/workflows/schema-drift.yml` also opens a PR when the API
changes.

## Releasing

Each package versions independently.

1. Bump `version` in `packages/<pkg>/package.json` and commit as `chore(<pkg>): release vX.Y.Z`.
   For `mcp`, also bump both versions in `packages/mcp/server.json` (top level and `packages[0]`)
   and the version in `packages/mcp/mcpb-manifest.json`. CI checks `server.json`, not the manifest.
2. Walk "Verify before release" below. `packages/email/PRE-PUBLISH-CHECKLIST.md` is the longer
   checklist written for email's first publish.
3. Create a GitHub release tagged `{package}-vX.Y.Z` (`email-v`, `sms-v`, `client-v`, `mcp-v`).
   `.github/workflows/publish.yml` runs on `created`: it builds, tests, fails when the package
   version differs from the tag, then runs `npm publish --access public --provenance` through npm
   OIDC Trusted Publishing (there is no `NPM_TOKEN`). For `mcp` it also checks that both
   `server.json` versions match, waits for npm to serve the version, then publishes to the MCP
   Registry.
4. If npm went out but a later step failed, run the Publish workflow by hand (workflow_dispatch)
   with `package`, `version` and `skip_npm=true`. It checks out the release tag unless you pass
   `ref`.
5. A package's first publish is manual: `cd packages/<pkg> && pnpm clean && pnpm build && npm publish
   --access public`. Then add Trusted Publishing for `wraps-team/wraps-js` and `publish.yml` on
   npmjs.com, and add the package to the tag parser and the `package` options in `publish.yml`,
   which know only the four above.

### Verify before release

Check each against the published artifact, not only the source:

- **Region chain**: `AWS_REGION` is honoured with no explicit `region` (the three files under
  "Credential resolution order").
- **`CredentialsError` wrapping**: a no-credentials run throws `CredentialsError`, not a raw
  `CredentialsProviderError`. Email: `isCredentialsChainError` and `awsErrorToWrapsError` in
  `packages/email/src/errors.ts`. SMS: `packages/sms/src/utils/aws-errors.ts`.
- **`SandboxError` and `SES_SIMULATOR_SUCCESS`**: both exported from `@wraps.dev/email` and present
  in the published `dist`.
- **`BatchError`**: still absent from `packages/email/src/index.ts`.
- **SMS phantom types**: `ScheduleOptions`, `IncomingMessage`, `MediaOptions`, `InboxListOptions`
  and `ScheduledMessage` are still absent from `packages/sms/src/index.ts`.
- **`SendEmailParams` union** (`packages/email/src/types.ts`): a body-less send and an `html` plus
  `react` send are both compile errors against the published type declarations.
- **User-agent version**: the published bundle carries the real version, not `0.0.0-dev`; the
  build-time `define` in each tsup config sets it.
- **MCP tool inventory**: re-read `packages/mcp/src/tools/index.ts`. When the tool set changed,
  update the tool list in `docs/using-the-sdks.md`.
- **`@wraps.dev/client` schema**: regenerate it, and update the endpoint list in
  `packages/client/README.md` when the API added routes.
