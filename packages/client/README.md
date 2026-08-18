# @wraps.dev/client

Type-safe client for the Wraps Platform API, plus the `define*` helpers that the Wraps CLI reads.

This package talks to `https://api.wraps.dev` over HTTPS with a Wraps API key. It does **not**
talk to AWS and needs no AWS credentials — sending email and SMS is
[`@wraps.dev/email`](https://www.npmjs.com/package/@wraps.dev/email) and
[`@wraps.dev/sms`](https://www.npmjs.com/package/@wraps.dev/sms).

## What's in the box

Two halves that ship together but are used in different places:

| Half | Exports | Runs |
|---|---|---|
| **Platform API client** | `createPlatformClient` | At runtime, in your server code — contacts, event tracking, broadcasts, template/workflow sync, agent mailboxes |
| **Project definitions** | `defineConfig`, `defineBrand`, `defineWorkflow`, step helpers | At authoring time, in `wraps.config.ts` / `brand.ts` / `workflows/*.ts` — read by the `wraps` CLI, never sent by this package |

The `define*` functions are identity functions: they return their argument unchanged (`defineWorkflow`
additionally flattens `steps`). They exist so your editor type-checks those files. Calling them does
no I/O.

## Installation

```bash
pnpm add @wraps.dev/client
```

Node 20+. Ships dual CJS + ESM builds.

## Authentication

One credential: a Wraps API key. Create one at
`https://app.wraps.dev/<your-org>/settings/api-keys`. Keys are prefixed `wraps_` and are sent as
`Authorization: Bearer <key>` on every request — the client attaches the header for you.

```typescript
import { createPlatformClient } from '@wraps.dev/client';

const client = createPlatformClient({
  apiKey: process.env.WRAPS_API_KEY,
  // baseUrl defaults to https://api.wraps.dev — override for self-hosted
  // baseUrl: 'https://api.internal.example.com',
});
```

The key carries organization scope. Every request is scoped to the organization that owns the key —
there is no org parameter to pass. Treat the key as a server-side secret; it is not safe in browser
code.

## Quick start

```typescript
import { createPlatformClient } from '@wraps.dev/client';

const client = createPlatformClient({ apiKey: process.env.WRAPS_API_KEY });

const { data, error } = await client.GET('/v1/contacts/', {
  params: { query: { page: '1', pageSize: '20', emailStatus: 'active' } },
});

if (error) {
  throw new Error('Failed to list contacts');
}

for (const contact of data.contacts) {
  console.log(contact.email, contact.emailStatus);
}
```

## The API client

`createPlatformClient()` returns an [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) client
typed against the Wraps OpenAPI schema, with two extra methods (`track`, `trackBatch`) attached.

```typescript
client.GET(path, init)
client.POST(path, init)
client.PATCH(path, init)
client.PUT(path, init)
client.DELETE(path, init)
```

Paths, query parameters, request bodies, and response shapes are all typed from the schema, so a
wrong path or a misspelled field is a compile error. `params.query` and `params.path` carry the
parameters; `body` carries the request body.

```typescript
// Create a contact
const created = await client.POST('/v1/contacts/', {
  body: {
    email: 'user@example.com',
    firstName: 'Ada',
    emailStatus: 'active',
    properties: { plan: 'pro' },
  },
});

if (created.error) {
  throw new Error(created.error.error);
}
console.log(created.data.id);
```

Note the field name is `properties`, not `metadata`, and the list filter is `emailStatus`, not
`status`. When in doubt, let the types tell you — they are generated from the live API.

### What you can reach

| Path group | What it covers |
|---|---|
| `/v1/contacts/`, `/v1/contacts/{id}`, `/v1/contacts/{id}/topics` | Contact CRUD, bulk delete (max 100), topic subscriptions |
| `/v1/events/`, `/v1/events/batch` | Event tracking (also wrapped by `track` / `trackBatch` below) |
| `/v1/batch/`, `/v1/batch/{id}`, `/{id}/send`, `/{id}/resume` | Broadcast / batch sends and their status |
| `/v1/templates/push`, `/push/batch`, `/pull` | Template sync — what `wraps email templates push` calls |
| `/v1/workflows/push`, `/push/batch`, `/pull` | Workflow sync — what `wraps email workflows push` calls |
| `/v1/workflows/{workflowId}/trigger`, `/trigger/batch` | Trigger a workflow for one or many contacts |
| `/v1/workflows/executions/{executionId}/retry`, `/cancel` | Execution control |
| `/v1/workflow-schedules/{workflowId}`, `/enable`, `/disable` | Scheduled-workflow control |
| `/v1/email/logs/`, `/v1/email/logs/{messageId}` | Send history |
| `/v1/connections/`, `/v1/connections/{id}` | Connected AWS accounts |
| `/v1/agents/…`, `/v1/agents/approvals/…` | Agent mailboxes, kill switch, approval queue |

The generated schema also contains paths that are *not* API-key routes — `/health`, `/tools/email-check`,
`/unsubscribe/{token}`, `/webhooks/ses/{awsAccountNumber}`, and `/v1/preference-events/` authenticate
differently or not at all. They are typed because they are in the OpenAPI document, not because this
client is the way to call them.

There is no segments endpoint: segments are referenced by ID (`segmentId`) when creating a batch
send, but are created and managed in the dashboard.

## Event tracking

`track` and `trackBatch` wrap `POST /v1/events/` and `POST /v1/events/batch`. Unlike the raw HTTP
methods, they unwrap the response and **throw** on API errors.

```typescript
const result = await client.track('purchase.completed', {
  contactEmail: 'ada@example.com',
  createIfMissing: true,
  properties: { orderId: 'ord_123', amount: 99 },
});
// { success: true, contactCreated: false, workflowsTriggered: 1, executionsResumed: 0 }
```

Identify the contact with exactly one of `contactId`, `contactEmail`, or `contactExternalId`. Set
`createIfMissing: true` (with `contactEmail`, optionally `contactName`) to create the contact when
it doesn't exist yet — otherwise an unknown contact is an error.

```typescript
const batch = await client.trackBatch([
  { name: 'page.viewed', contactEmail: 'ada@example.com', properties: { page: '/pricing' } },
  { name: 'feature.used', contactId: 'con_abc', properties: { feature: 'api-keys' } },
]);
// { success: true, processed: 2, workflowsTriggered: 0, executionsResumed: 0, errors: [] }
```

`trackBatch` is partial-failure tolerant: it resolves with `errors: string[]` describing the events
that failed rather than throwing for them. Check `errors` — a resolved promise does not mean every
event landed.

Events are what resume workflows parked on `waitForEvent`, and what fire `trigger: { type: 'event' }`
workflows.

## Error handling

There are no error classes in this package. Two different mechanisms, depending on which method you
call:

| Call | On HTTP error |
|---|---|
| `client.GET` / `POST` / `PATCH` / `PUT` / `DELETE` | Resolves with `{ error, response }` — never throws |
| `client.track` / `client.trackBatch` | Throws a plain `Error` with the API's message |
| Any of them, on network failure | The underlying `fetch` rejection propagates |

```typescript
const { data, error, response } = await client.GET('/v1/contacts/', {});

if (response.status === 401) {
  // API key missing, revoked, or from another org
}
if (error) {
  // ...
}
```

**Sharp edge:** the type of `error` comes from the OpenAPI schema, and only 15 of 42 operations
declare a non-2xx response. For the rest — including `GET /v1/contacts/` — `error` is typed `never`,
so `error.error` is a compile error even though a real 401 or 500 populates it at runtime. Branch on
`response.status` (or `response.ok`) when you need to handle failures on those endpoints; use `error`
where the schema declares it (`POST /v1/contacts/`, `GET /v1/contacts/{id}`, `POST /v1/events/`, and
the agent endpoints, among others). Error bodies are consistently `{ error: string }`.

The client adds no retries, no timeout, and no rate-limit backoff. It calls `fetch` once. Wrap it
yourself if you need those.

## Project definitions

These three helpers type the files the `wraps` CLI reads. They never make a network call.

### `defineConfig` — `wraps.config.ts`

```typescript
import { defineConfig } from '@wraps.dev/client';

export default defineConfig({
  org: 'my-company',
  from: { email: 'hello@myapp.com', name: 'My App' },
  replyTo: 'support@myapp.com',
  region: 'us-east-1',
  templatesDir: './templates',
  workflowsDir: './workflows',
  brandFile: './brand.ts',
  environments: {
    staging: { from: { email: 'staging@myapp.com' } },
  },
  defaultEnv: 'production',
});
```

`from` is an object (`{ email, name? }`), not a string. Only `org` is required.

### `defineBrand` — `brand.ts`

```typescript
import { defineBrand } from '@wraps.dev/client';

export default defineBrand({
  primaryColor: '#5046e5',
  secondaryColor: '#a5b4fc',
  fontFamily: 'Inter, sans-serif',
  buttonStyle: 'rounded',
  companyName: 'My Company',
  companyAddress: '123 Main St, Denver, CO 80202',
  logoUrl: 'https://myapp.com/logo.png',
  socialLinks: [{ platform: 'github', url: 'https://github.com/mycompany' }],
});
```

The brand kit is flat — `primaryColor`, `fontFamily`, `buttonRadius`, and so on, not nested `colors`
or `fonts` objects. `primaryColor` is the only required field. `socialLinks` is an array of
`{ platform, url }`.

### `defineWorkflow` — `workflows/*.ts`

```typescript
import {
  condition,
  defineWorkflow,
  delay,
  exit,
  sendEmail,
} from '@wraps.dev/client';

export default defineWorkflow({
  name: 'Welcome Sequence',
  description: 'Onboarding drip for new contacts',
  trigger: { type: 'contact_created' },
  settings: { allowReentry: false },
  steps: [
    sendEmail('welcome', { template: 'welcome' }),
    delay('wait-1-day', { days: 1 }),
    condition('activated', {
      field: 'contact.properties.hasActivated',
      operator: 'is_true',
      branches: {
        yes: [exit('done', { reason: 'Already activated', markAs: 'completed' })],
        no: [sendEmail('tips', { template: 'getting-started-tips' })],
      },
    }),
  ],
});
```

Trigger types are snake_case: `event`, `contact_created`, `contact_updated`, `segment_entry`,
`segment_exit`, `schedule`, `api`, `topic_subscribed`, `topic_unsubscribed`. An `event` trigger also
takes `eventName`; `schedule` takes `schedule` (cron) and `timezone`.

Every step helper takes a unique `id` as its first argument — that id is how branches and
transitions refer to the step, so keep it stable across edits.

| Helper | Step |
|---|---|
| `sendEmail(id, { template \| subject + body, from?, fromName?, replyTo? })` | Send an email |
| `sendSms(id, { template \| message, senderId? })` | Send an SMS |
| `delay(id, { days \| hours \| minutes })` | Wait a fixed duration |
| `condition(id, { field, operator, value?, branches })` | Branch on a contact field |
| `waitForEvent(id, { eventName, timeout? })` | Park until an event arrives |
| `waitForEmailEngagement(id, { emailStepId, engagementType, timeout? })` | Park until an open or click |
| `updateContact(id, { updates })` | Set / increment / append contact fields |
| `subscribeTopic(id, { topicId, channel? })` / `unsubscribeTopic(...)` | Topic membership |
| `webhook(id, { url, method?, headers?, body? })` | Call an external URL (defaults to `POST`) |
| `exit(id, { reason?, markAs? })` | End the execution |
| `cascade(id, { channels })` | Expands to several steps — see below |

`delay` takes one unit. If you pass `{ days: 1, hours: 2 }` it uses days and drops hours; if you pass
nothing it defaults to one hour. Use the largest single unit you mean.

`condition` operators: `equals`, `not_equals`, `contains`, `not_contains`, `starts_with`,
`ends_with`, `greater_than`, `less_than`, `greater_than_or_equals`, `less_than_or_equals`, `is_set`,
`is_not_set`, `is_true`, `is_false`. The last four take no `value`.

### `cascade`

`cascade()` returns an **array** of steps, not one step, and expands to
send → wait for engagement → condition → fall through to the next channel. `defineWorkflow` flattens
nested arrays, so either spreading it or nesting it works.

```typescript
import { cascade, defineWorkflow } from '@wraps.dev/client';

export default defineWorkflow({
  name: 'Cross-channel notify',
  trigger: { type: 'event', eventName: 'invoice.due' },
  steps: [
    ...cascade('notify', {
      channels: [
        { type: 'email', template: 'invoice-due', waitFor: { hours: 2 }, engagement: 'opened' },
        { type: 'sms', template: 'invoice-due-sms' },
      ],
    }),
  ],
});
```

A channel only produces a wait-and-check if it sets `waitFor` and is not the last channel. Without
`waitFor`, the cascade sends every channel back-to-back — which is probably not what you want.

## Sharp edges

Things that are true today and will surprise you otherwise:

- **`waitForEmailEngagement` binds to the previous email, not to `emailStepId`.** The emitted step
  config carries only `timeoutSeconds`; `emailStepId` and `engagementType` shape the step's display
  name. At execution time the platform waits on the most recently completed `send_email` step in that
  execution (scoped to the cascade group, when there is one). It cannot reach back to an arbitrary
  earlier email.
- **`defineWorkflow` validates nothing.** It flattens `steps` and returns. Duplicate step ids,
  branches pointing at nothing, and a `condition` with no reachable branch all pass silently and
  fail later. `wraps email workflows validate` is the check.
- **The `define*` helpers are pure.** Editing `wraps.config.ts` changes nothing until the CLI pushes.
- **`error` is typed `never` on most endpoints.** See [Error handling](#error-handling).
- **No browser use.** The API allows cross-origin requests, so nothing stops a browser call
  technically — which is the problem. The API key is a server-side secret with full organization
  scope; anything in browser JavaScript is readable by the user.

## TypeScript

`paths` and `operations` are re-exported straight from the generated OpenAPI schema, so you can name
any request or response shape without hand-writing it:

```typescript
import type { paths } from '@wraps.dev/client';

type ListContacts = paths['/v1/contacts/']['get'];
type Contact = ListContacts['responses'][200]['content']['application/json']['contacts'][number];
```

`PlatformClient` is the type of `createPlatformClient(...)` — use it when passing the client around.

The schema is regenerated from the live API with `pnpm generate` in this package. If an endpoint
exists in the API but not in your types, the schema in your installed version predates it — upgrade.

## Docs

- Platform SDK reference — <https://wraps.dev/docs/client-sdk-reference>
- API reference — <https://wraps.dev/docs/reference/api>
- CLI reference — <https://wraps.dev/docs/cli-reference>
- Issues — <https://github.com/wraps-team/wraps-js/issues>

## License

MIT
