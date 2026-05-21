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

## License

MIT
