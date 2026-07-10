# @wraps.dev/mcp

MCP server for [Wraps](https://wraps.dev) email infrastructure. Gives AI agents access to your AWS SES sending history, domain status, suppression list, and — optionally — the ability to send email.

Runs locally via stdio. Your AWS credentials never leave your machine.

## Prerequisites

- Wraps email stack deployed (`wraps email deploy`)
- AWS credentials configured in your environment (same profile used for the Wraps CLI)

## Tools

| Tool | Description | Write? |
|------|-------------|--------|
| `send_email` | Send a transactional email via your SES account | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `list_recent_sends` | List recent sends from your email history | No |
| `get_email_event_log` | Get the full delivery event log for a message (Send, Delivery, Bounce, Complaint, Open, Click) | No |
| `verify_domain_status` | Check verification and DKIM status of a sending domain | No |
| `list_suppressions` | List addresses on your SES suppression list, optionally filtered by BOUNCE or COMPLAINT | No |
| `check_send_status` | Poll the outcome of a `pending_approval` send by `approvalId` (enforced mode only) | No |

## Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wraps": {
      "command": "npx",
      "args": ["-y", "@wraps.dev/mcp"],
      "env": {
        "AWS_REGION": "us-east-1",
        "AWS_PROFILE": "your-aws-profile"
      }
    }
  }
}
```

### Claude Code

Add to `.mcp.json` in your project root:

```json
{
  "mcpServers": {
    "wraps": {
      "command": "npx",
      "args": ["-y", "@wraps.dev/mcp"]
    }
  }
}
```

Claude Code inherits your shell's AWS environment, so no extra `env` config is needed if your credentials are already set.

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_REGION` | Yes | — | AWS region where your Wraps stack is deployed |
| `WRAPS_HISTORY_TABLE_NAME` | No | `wraps-email-history` | DynamoDB table name for email history |
| `WRAPS_ACCOUNT_ID` | No | auto-detected via STS | Your AWS account ID (skip STS call if set) |
| `WRAPS_WRITE_ENABLED` | No | `false` | Set to `true` to enable `send_email` |
| `WRAPS_FROM_EMAIL` | No | — | Default `from` address for `send_email` |

## Write Mode

`send_email` is disabled by default. Set `WRAPS_WRITE_ENABLED=true` to enable it. The `from` address must be a domain verified in your SES account.

```json
{
  "mcpServers": {
    "wraps": {
      "command": "npx",
      "args": ["-y", "@wraps.dev/mcp"],
      "env": {
        "AWS_REGION": "us-east-1",
        "WRAPS_WRITE_ENABLED": "true",
        "WRAPS_FROM_EMAIL": "you@yourdomain.com"
      }
    }
  }
}
```

## Send guardrails

When write mode is enabled, the `send_email` tool can reach any SES-verified address by default. Use these env vars to restrict the agent's sending scope:

| Variable | Default | Description |
|----------|---------|-------------|
| `WRAPS_ALLOWED_RECIPIENTS` | — (no restriction) | Comma-separated exact addresses the agent may send to. If set, any address not in this list (or `WRAPS_ALLOWED_RECIPIENT_DOMAINS`) is rejected. |
| `WRAPS_ALLOWED_RECIPIENT_DOMAINS` | — (no restriction) | Comma-separated domains (e.g. `company.com,partner.org`) the agent may send to. Combined with `WRAPS_ALLOWED_RECIPIENTS`; a recipient is allowed if it matches either list. Matching is exact: `example.com` allows `user@example.com` but NOT subdomains like `user@mail.example.com` — list each subdomain explicitly. |
| `WRAPS_MAX_RECIPIENTS` | `50` | Maximum number of recipients per `send_email` call. |
| `WRAPS_ALLOW_FROM_OVERRIDE` | `false` | Set to `true` to let the agent supply a `from` address that differs from `WRAPS_FROM_EMAIL`. When `false` (default), the caller-supplied `from` is rejected if it does not match the configured address. |

> **Note:** Running with `WRAPS_WRITE_ENABLED=true` and no allowlist gives the agent unrestricted send capability to any address in your SES account.

## Enforced mode (agent enforcer)

For agents provisioned via `wraps email agent create`, the MCP server runs in **enforced mode**. The agent's AWS credential can only invoke a customer-side enforcer Lambda — never SES directly. All policy (kill-switch, recipient allowlist, hourly/daily caps) is decided by that Lambda, so the local guardrails above are skipped.

| Variable | Required | Description |
|----------|----------|-------------|
| `WRAPS_AGENT_ID` | Yes (for enforced mode) | The agent's ID. Enables enforced mode when set together with the enforcer function. |
| `WRAPS_AGENT_ENFORCER_ARN` | Yes (for enforced mode) | Qualified per-agent alias ARN of the customer's `wraps-agent-enforcer` Lambda (`arn:aws:lambda:<region>:<acct>:function:wraps-agent-enforcer:agent-<agentId>`). A bare function name or unqualified ARN invokes `$LATEST`, which the enforcer treats as a platform caller and blocks agent sends. |

When both are set, `send_email` invokes the enforcer instead of SES and returns a structured disposition rather than an error for policy outcomes:

- `sent` — delivered, with `messageId`.
- `pending_approval` — an operator must approve; poll `check_send_status` with the returned `approvalId`.
- `blocked` — refused by policy (kill-switch, allowlist, or caps), with a `reason`.

Only transport or configuration failures are returned as errors. The `check_send_status` tool is registered only in enforced mode.

Enforced mode supports **a single recipient per send**. Pass one address as a string, or a one-element array; a `to` array with more than one recipient is rejected as an error (send one email per recipient). Note that `WRAPS_ALLOWED_RECIPIENTS`, `WRAPS_ALLOWED_RECIPIENT_DOMAINS`, `WRAPS_MAX_RECIPIENTS`, and `WRAPS_ALLOW_FROM_OVERRIDE` do not apply in enforced mode — recipient and sender policy is enforced entirely by the Lambda.

## License

MIT
