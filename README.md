<p align="center">
  <a href="https://wraps.dev">
    <img src="https://wraps.dev/wraps-dark-logo.png" alt="Wraps" width="200" />
  </a>
</p>

<p align="center">
  <strong>TypeScript SDKs and an MCP server for AWS services. Your infrastructure, great DX.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@wraps.dev/email"><img src="https://img.shields.io/npm/v/@wraps.dev/email?label=email&color=blue" alt="email version" /></a>
  <a href="https://www.npmjs.com/package/@wraps.dev/sms"><img src="https://img.shields.io/npm/v/@wraps.dev/sms?label=sms&color=blue" alt="sms version" /></a>
  <a href="https://www.npmjs.com/package/@wraps.dev/client"><img src="https://img.shields.io/npm/v/@wraps.dev/client?label=client&color=blue" alt="client version" /></a>
  <a href="https://www.npmjs.com/package/@wraps.dev/mcp"><img src="https://img.shields.io/npm/v/@wraps.dev/mcp?label=mcp&color=blue" alt="mcp version" /></a>
  <a href="https://github.com/wraps-team/wraps-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-blue" alt="TypeScript" />
</p>

---

**AI agents:** start with [AGENTS.md](./AGENTS.md) — which package to reach for, auth, the minimal correct call for each, and the sharp edges. For the full docs in one file, fetch [wraps.dev/llms-full.txt](https://wraps.dev/llms-full.txt), or [wraps.dev/llms.txt](https://wraps.dev/llms.txt) for an agent-oriented index.

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

Batch sending, opt-out management, and E.164 validation. [SMS docs →](https://wraps.dev/docs/sms-sdk-reference)

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

### [@wraps.dev/mcp](./packages/mcp) — MCP server for Amazon SES

A Model Context Protocol server that lets AI agents send email from your own AWS account and inspect it. It runs locally over stdio, built on the official MCP TypeScript SDK, and reads AWS credentials from your environment.

```json
{
  "mcpServers": {
    "wraps": {
      "command": "npx",
      "args": ["-y", "@wraps.dev/mcp"],
      "env": { "AWS_REGION": "us-east-1", "AWS_PROFILE": "your-aws-profile" }
    }
  }
}
```

Tools: `send_email` (off unless `WRAPS_WRITE_ENABLED=true`), `verify_domain_status`, `list_suppressions`, `get_setup_status`, and `estimate_cost` work on any SES account. `list_recent_sends` and `get_email_event_log` read send history from a Wraps deploy. Also runs from the [Dockerfile](./Dockerfile) at the repo root: `docker build -t wraps-mcp . && docker run -i --rm -e AWS_REGION wraps-mcp`. [MCP docs →](https://wraps.dev/docs/mcp-reference)

## Documentation

| Resource | Link |
|----------|------|
| Quickstart | [wraps.dev/docs/quickstart](https://wraps.dev/docs/quickstart) |
| SDK Reference | [wraps.dev/docs/sdk-reference](https://wraps.dev/docs/sdk-reference) |
| SMS Docs | [wraps.dev/docs/sms-sdk-reference](https://wraps.dev/docs/sms-sdk-reference) |
| MCP Server | [wraps.dev/docs/mcp-reference](https://wraps.dev/docs/mcp-reference) |
| CLI (deploy infra) | [wraps.dev/docs/cli-reference](https://wraps.dev/docs/cli-reference) |

## Community

- [GitHub Issues](https://github.com/wraps-team/wraps-js/issues) — Bug reports and feature requests
- [GitHub Discussions](https://github.com/wraps-team/wraps/discussions) — Questions and ideas
- [Contributing](CONTRIBUTING.md) — Development setup and guidelines

## License

MIT — see [LICENSE](LICENSE) for details.
