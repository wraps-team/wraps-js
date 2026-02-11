<p align="center">
  <a href="https://wraps.dev">
    <img src="https://wraps.dev/wraps-dark-logo.png" alt="Wraps" width="200" />
  </a>
</p>

<p align="center">
  <strong>TypeScript SDKs for AWS services. Your infrastructure, great DX.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@wraps.dev/email"><img src="https://img.shields.io/npm/v/@wraps.dev/email?label=email&color=blue" alt="email version" /></a>
  <a href="https://www.npmjs.com/package/@wraps.dev/sms"><img src="https://img.shields.io/npm/v/@wraps.dev/sms?label=sms&color=blue" alt="sms version" /></a>
  <a href="https://www.npmjs.com/package/@wraps.dev/client"><img src="https://img.shields.io/npm/v/@wraps.dev/client?label=client&color=blue" alt="client version" /></a>
  <a href="https://github.com/wraps-team/wraps-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript" />
</p>

---

## Packages

### [@wraps.dev/email](./packages/email) — AWS SES

```bash
pnpm add @wraps.dev/email
```

```typescript
import { WrapsEmail } from '@wraps.dev/email';

const email = new WrapsEmail();

const { messageId } = await email.send({
  from: 'hello@yourapp.com',
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello from Wraps!</h1>',
});
```

React.email support, template management, bulk sending, inbox reading, event history, and suppression lists. [SDK docs →](https://wraps.dev/docs/sdk-reference)

### [@wraps.dev/sms](./packages/sms) — AWS End User Messaging

```bash
pnpm add @wraps.dev/sms
```

```typescript
import { WrapsSMS } from '@wraps.dev/sms';

const sms = new WrapsSMS();

await sms.send({
  to: '+14155551234',
  message: 'Your verification code is 123456',
});
```

Batch sending, opt-out management, and E.164 validation. [SMS docs →](https://wraps.dev/docs/sms)

### [@wraps.dev/client](./packages/client) — Wraps Platform API

```bash
pnpm add @wraps.dev/client
```

```typescript
import { createPlatformClient } from '@wraps.dev/client';

const client = createPlatformClient({ apiKey: 'your-api-key' });

const { data } = await client.GET('/v1/contacts/', {
  params: { query: { page: '1', pageSize: '10' } },
});
```

Auto-generated types from OpenAPI, workflow definitions, and brand kit configuration.

## Documentation

| Resource | Link |
|----------|------|
| Quickstart | [wraps.dev/docs/quickstart](https://wraps.dev/docs/quickstart) |
| SDK Reference | [wraps.dev/docs/sdk-reference](https://wraps.dev/docs/sdk-reference) |
| SMS Docs | [wraps.dev/docs/sms](https://wraps.dev/docs/sms) |
| CLI (deploy infra) | [wraps.dev/docs/cli-reference](https://wraps.dev/docs/cli-reference) |

## Community

- [GitHub Issues](https://github.com/wraps-team/wraps-js/issues) — Bug reports and feature requests
- [GitHub Discussions](https://github.com/wraps-team/wraps/discussions) — Questions and ideas
- [Contributing](CONTRIBUTING.md) — Development setup and guidelines

## License

MIT — see [LICENSE](LICENSE) for details.
