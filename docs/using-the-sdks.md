# AGENTS.md — writing code that uses the Wraps SDKs

For agents **calling** these packages. If you are modifying this repository, read
[CLAUDE.md](./CLAUDE.md) and [CONTRIBUTING.md](./CONTRIBUTING.md) instead.

Read this before writing a line — the sharp edges below are the ones that compile clean and fail at
runtime.

## Pick a package

| Task | Package | Talks to |
|---|---|---|
| Send transactional email, manage SES templates, read inbound mail, read send events, manage the suppression list | `@wraps.dev/email` | AWS SES (your account) |
| Send SMS, manage phone numbers and opt-outs | `@wraps.dev/sms` | AWS End User Messaging (your account) |
| Contacts, event tracking, broadcasts, workflow/template sync, agent mailboxes | `@wraps.dev/client` | `api.wraps.dev` |
| Give an MCP host (Claude Code, Claude Desktop) email tools | `@wraps.dev/mcp` | AWS SES (your account) |

Two credential worlds, and they do not overlap:

- `email`, `sms`, `mcp` are **BYOC** — they call AWS in the user's account with AWS credentials.
  Nothing is proxied through Wraps.
- `client` uses a **Wraps API key** and never touches AWS.

Sending an email needs `@wraps.dev/email`; `@wraps.dev/client` cannot send one.

## Install and authenticate

```bash
pnpm add @wraps.dev/email    # or npm install / yarn add / bun add
pnpm add @wraps.dev/sms
pnpm add @wraps.dev/client
```

### AWS credentials (`email`, `sms`, `mcp`)

Resolution order, highest first:

1. `client` — a pre-configured AWS SDK client you pass in
2. `roleArn` — OIDC role assumption (Vercel, GitHub Actions, EKS)
3. `credentials` — a static `{ accessKeyId, secretAccessKey, sessionToken? }` or a provider function
4. Nothing — the standard AWS credential chain (env vars, `~/.aws/credentials`, `AWS_PROFILE`,
   instance role)

Never tell a user which of these to use. All four are valid; the right one depends on where the code
runs.

**Region** resolves as: explicit `region` in the constructor → `AWS_REGION` → `AWS_DEFAULT_REGION`
→ the active profile in `~/.aws/config` or IMDS. The tail differs: `@wraps.dev/email` falls back to
`us-east-1` when the whole chain comes up empty, while `@wraps.dev/sms` leaves `region` unset and
lets the AWS SDK raise its own "region not configured" error. Passing `region` explicitly is always
unambiguous and is what to do when you know it.

Published versions before this chain landed hardcoded `us-east-1` and silently ignored `AWS_REGION`,
so a user on an older install can be sending to the wrong region without knowing it. The symptom is
not a region error: SES in the wrong region has never heard of their domain, so the failure reads
"Email address is not verified" and points at the wrong problem. `SandboxError.region` (email)
records the region actually used — read it before believing a verification error.

### Wraps API key (`client`)

One env var, `WRAPS_API_KEY`. Keys are prefixed `wraps_`, created at
`https://app.wraps.dev/<org>/settings/api-keys`, and carry organization scope — there is no org
parameter. Server-side only.

## The minimal correct call

### `@wraps.dev/email`

```typescript
import { WrapsEmail } from '@wraps.dev/email';

const email = new WrapsEmail({ region: 'us-east-1' });

const { messageId } = await email.send({
  from: 'hello@yourdomain.com',   // must be a verified SES identity
  to: 'user@example.com',
  subject: 'Welcome',
  html: '<h1>Hello</h1>',         // at least one of html / text / react
});
```

`send()` returns `{ messageId, requestId }`. `from` may be `'Name <a@b.com>'` or
`{ email, name }`; `to`, `cc`, `bcc`, `replyTo` each accept one address or an array.

Other surface on the instance: `sendBatch`, `sendTemplate`, `sendBulkTemplate`, `templates.*`
(`create`, `createFromReact`, `update`, `get`, `list`, `delete`), `suppression.*`, and `destroy()`.
`email.inbox` and `email.events` are `null` unless you construct with `inboxBucketName` /
`historyTableName` — check for null before use.

For Cloudflare Workers and other `workerd` runtimes, import `@wraps.dev/email/workers`. That entry
requires both `region` and `credentials` (no credential chain at the edge) and drops `react`,
`attachments`, templates, inbox, events, and reply threading. The main entry does not run on Workers.

### `@wraps.dev/sms`

```typescript
import { WrapsSMS } from '@wraps.dev/sms';

const sms = new WrapsSMS({ region: 'us-east-1' });

const result = await sms.send({
  to: '+14155551234',            // E.164, single recipient
  message: 'Your code is 123456',
});
```

The whole public surface is `send`, `sendBatch`, `numbers.list` / `numbers.get`, `optOuts.list` /
`check` / `add` / `remove`, and `destroy()`, plus the standalone `calculateSegments`,
`validatePhoneNumber`, and `sanitizePhoneNumber` helpers. **There is no inbound, no MMS, and no
scheduling.** Older versions exported types (`ScheduleOptions`, `IncomingMessage`, `MediaOptions`,
`InboxListOptions`, `ScheduledMessage`) with no implementation behind them; they are gone.

`sms.send` throws `OptedOutError` when the recipient opted out and `RateLimitError` when throttled;
both are real and both are exported.

An SMS account needs `npx @wraps.dev/cli sms init` first — phone number, opt-out list, and the rest are
infrastructure the CLI provisions.

### `@wraps.dev/client`

```typescript
import { createPlatformClient } from '@wraps.dev/client';

const client = createPlatformClient({ apiKey: process.env.WRAPS_API_KEY });

// Typed REST — resolves with { data, error, response }, never throws on HTTP errors
const { data, error } = await client.GET('/v1/contacts/', {
  params: { query: { page: '1', pageSize: '20', emailStatus: 'active' } },
});

// Event tracking — unwraps the response and DOES throw on API errors
await client.track('purchase.completed', {
  contactEmail: 'ada@example.com',
  createIfMissing: true,
  properties: { orderId: 'ord_123' },
});
```

Paths, params, bodies, and responses are typed from the OpenAPI schema, so wrong paths and misspelled
fields are compile errors. The same package exports `defineConfig`, `defineBrand`, `defineWorkflow`,
and the workflow step helpers — pure identity functions for the files the `wraps` CLI reads. Full
detail in [packages/client/README.md](./packages/client/README.md).

### `@wraps.dev/mcp`

An MCP stdio server, run as `npx -y @wraps.dev/mcp` (binary name `wraps-mcp`). Host config:

```json
{
  "mcpServers": {
    "wraps": {
      "command": "npx",
      "args": ["-y", "@wraps.dev/mcp"],
      "env": {
        "AWS_REGION": "us-east-1",
        "AWS_PROFILE": "your-profile",
        "WRAPS_FROM_EMAIL": "hello@yourdomain.com"
      }
    }
  }
}
```

`AWS_REGION` is required in practice — without it, and without a region in the active profile, the
server refuses to start with an actionable message. Tools: `send_email`, `list_recent_sends`,
`get_email_event_log`, `verify_domain_status`, `list_suppressions`, `get_setup_status`,
`estimate_cost`, and `check_send_status` (enforced mode only). `estimate_cost` needs no AWS access.

Sending is off by default: `send_email` refuses unless `WRAPS_WRITE_ENABLED=true`. Other env:
`WRAPS_HISTORY_TABLE_NAME` (default `wraps-email-history`), `WRAPS_CONFIGURATION_SET`,
`WRAPS_ALLOWED_RECIPIENTS`, `WRAPS_ALLOWED_RECIPIENT_DOMAINS`, `WRAPS_MAX_RECIPIENTS` (default 50),
`WRAPS_ALLOW_FROM_OVERRIDE`, `WRAPS_ACCOUNT_ID`. Setting both `WRAPS_AGENT_ID` and
`WRAPS_AGENT_ENFORCER_ARN` switches to enforced mode, where a customer-side Lambda decides every
send and results come back as `sent`, `pending_approval`, or `blocked`.

## Sharp edges

### The SES sandbox is the most likely reason a first send fails

Every new AWS SES account starts in the sandbox: it can send **only to verified identities**, capped
at 200 messages/day and 1/second. A sandboxed send to an unverified recipient fails at the API with
a message about unverified addresses — which is also what a wrong-region send says, so the error
alone does not tell you which one you hit.

Prove the pipeline without waiting on AWS by sending to the mailbox simulator:

```typescript
await email.send({
  from: 'hello@yourdomain.com',       // sender must still be verified
  to: 'success@simulator.amazonses.com',
  subject: 'Pipeline test',
  text: 'Hello',
});
```

AWS pre-verifies that address, so it is deliverable from a sandbox account and produces a real
Delivery event. The email package exports it as `SES_SIMULATOR_SUCCESS`. Sending to anyone else
requires production access — an AWS support review that neither Wraps nor you can shortcut. If the
MCP server is available, `get_setup_status` reports sandbox state and the recommended next step.

The email SDK raises `SandboxError` (a subclass of `SESError`) for this rejection, with `.region`
attached, because the same AWS error is produced by a region mismatch.

### Region

Covered above, and worth repeating because it is silent: pass `region` explicitly. The symptom of
getting it wrong is a verification error, not a region error.

### Email body invariants

`SendEmailParams` is a union: a send needs at least one of `html`, `text`, or `react`, and `html`
together with `react` is rejected. Both invariants are type errors in TypeScript and are re-checked
at runtime for JavaScript callers. When you pass `html` without `text`, plain text is generated
automatically.

### Errors

Both AWS-facing SDKs root everything at `WrapsEmailError` / `WrapsSMSError`, so one `instanceof`
check on the base class catches every error the SDK throws.

| Error | Package | Carries |
|---|---|---|
| `ValidationError` | both | `.field` |
| `SESError` / `SMSError` | email / sms | `.code`, `.requestId`, `.retryable` |
| `SandboxError` (extends `SESError`) | email | `.region` — the region the request actually used |
| `CredentialsError` | both | `.cause` — the underlying AWS error |
| `DynamoDBError` | email | `.code`, `.requestId`, `.retryable` |
| `OptedOutError` | sms | `.phoneNumber` |
| `RateLimitError` | sms | `.retryAfter` |
| `ConfigurationError`, `SendingRestrictionError` | sms | setup and sending-restriction failures |

Credential-chain failures are wrapped in `CredentialsError` rather than escaping as a raw AWS
`CredentialsProviderError`. Its message lists every way credentials can be supplied without ranking
them — when relaying it, do not pick a favourite either.

`@wraps.dev/client` has no error classes at all. Its REST methods resolve with `{ error }` and never
throw for HTTP status; `track` / `trackBatch` throw a plain `Error`. And `error` is typed `never` on
most endpoints because the OpenAPI schema declares no non-2xx response for them — branch on
`response.status` there.

### Nothing is proxied, nothing is metered

These SDKs make direct AWS API calls from the user's process with the user's credentials. No traffic
passes through Wraps and no telemetry is sent anywhere. AWS clients are tagged
`wraps-email/<version>` / `wraps-sms/<version>` in the User-Agent so the user can tell Wraps traffic
apart in their own CloudTrail — identification in their account, not reporting to ours.

A send that fails, fails in the user's AWS account, and the AWS-side error is the whole truth. Do not
suggest checking a Wraps dashboard to diagnose an SDK-level send failure — check CloudWatch and the
SES console.

### Bulk limits

Email `sendBatch` accepts up to 100 entries and chunks them 50 per SES call; `sendBulkTemplate`
rejects more than 50 destinations outright. SMS is one recipient per `send` — use `sendBatch` for
more. The MCP server caps recipients at `WRAPS_MAX_RECIPIENTS` (default 50), and in enforced mode
allows exactly one recipient per send.

## Verify before release

Every item below was verified against the working tree on 2026-08-18, while three other packages were
being changed in parallel. Re-check each against the published artifact before a release, and against
`node_modules` before trusting it in a user's project:

- **Region chain** — `packages/email/src/utils/credentials.ts` (`resolveRegion`) and
  `packages/sms/src/utils/region.ts`. Confirm `AWS_REGION` is honoured with no explicit `region`.
- **`CredentialsError` wrapping** — email `errors.ts:isCredentialsChainError` /
  `awsErrorToWrapsError`, and the sms equivalent. Confirm a no-credentials run throws
  `CredentialsError`, not a raw `CredentialsProviderError`.
- **`SandboxError` and `SES_SIMULATOR_SUCCESS`** — both exported from `@wraps.dev/email`; confirm
  they survive to the published `dist`.
- **`BatchError` gone from `@wraps.dev/email`** — absent from `src/index.ts` as of writing. This file
  never documents it; confirm it is actually gone rather than re-added.
- **SMS phantom types gone** — `ScheduleOptions`, `IncomingMessage`, `MediaOptions`,
  `InboxListOptions`, `ScheduledMessage` are absent from `packages/sms/src/index.ts`.
- **`SendEmailParams` union** — `packages/email/src/types.ts`; confirm a body-less send and an
  `html` + `react` send are both compile errors in the published `.d.ts`, not just in source.
- **User-agent tagging** — `wraps-email/<version>` / `wraps-sms/<version>` come from a build-time
  `define`. Confirm the published bundle carries the real version, not `0.0.0-dev`.
- **MCP tool inventory** — `packages/mcp/src/tools/index.ts`; seven tools always, plus
  `check_send_status` in enforced mode. Re-read if tools were added or annotated.
- **`@wraps.dev/client` schema** — regenerated from the live API with `pnpm generate`. The endpoint
  table in the client README goes stale when the API adds routes.

## Docs

- Quickstart — <https://wraps.dev/docs/quickstart>
- Email SDK — <https://wraps.dev/docs/sdk-reference>
- SMS SDK — <https://wraps.dev/docs/sms-sdk-reference>
- Platform SDK — <https://wraps.dev/docs/client-sdk-reference>
- CLI — <https://wraps.dev/docs/cli-reference>
- Everything in one file, for agents — <https://wraps.dev/llms-full.txt>
