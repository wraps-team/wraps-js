# @wraps.dev/mcp

MCP server for Amazon SES. Lets AI agents send email from your own AWS account, check domain verification and DKIM, look up the suppression list, and see whether the account is still in the SES sandbox.

Works with any SES account. [Wraps](https://wraps.dev) adds send history and delivery events on top.

Runs locally via stdio. Your AWS credentials never leave your machine.

## Prerequisites

- AWS credentials configured in your environment (a profile, SSO, or environment variables)
- An SES account in the region you point it at
- For `list_recent_sends` and `get_email_event_log` only: the Wraps event pipeline, deployed with `npx @wraps.dev/cli email init`
- For the API-backed tools: a `WRAPS_API_KEY`, or a session from `wraps auth login`

## Tools

| Tool | Description | Needs Wraps? | Write? |
|------|-------------|--------------|--------|
| `send_email` | Send a transactional email via your SES account | No | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `verify_domain_status` | Check verification and DKIM status of a sending domain | No | No |
| `list_suppressions` | List addresses on your SES suppression list (paginated, with an explicit truncation notice), or check one address exactly with `email` | No | No |
| `get_setup_status` | Check whether the account is in the SES sandbox, and get the next step toward a first send | No | No |
| `estimate_cost` | Estimate monthly Wraps + AWS cost for a send volume, including which SES pricing plan the account is on. No AWS credentials needed | No | No |
| `list_recent_sends` | List recent sends from your email history | Yes | No |
| `get_email_event_log` | Get the full delivery event log for a message (Send, Delivery, Bounce, Complaint, Open, Click) | Yes | No |
| `check_send_status` | Poll the outcome of a `pending_approval` send by `approvalId` (enforced mode only) | Yes | No |
| `list_contacts` | List contacts in your Wraps organization, optionally filtered by email status, SMS status, preferred channel, or a search string on email or phone. | Yes (API key or `wraps auth login`) | No |
| `get_contact` | Get one contact in full, including its topic subscriptions. | Yes (API key or `wraps auth login`) | No |
| `create_contact` | Create one new contact. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `update_contact` | Change one existing contact. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `set_contact_topics` | REPLACE the full topic subscription list of one contact. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `delete_contact` | Permanently delete ONE contact by UUID, email, or externalId. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `validate_contact_emails` | Check up to 100 email addresses with SES Email Address Insights and return a deliverability verdict (HIGH, MEDIUM, LOW, or UNKNOWN) for each. | Yes (API key or `wraps auth login`) | No |
| `list_segments` | List the audience segments saved in this Wraps organization, with each segment's live member count. | Yes (API key or `wraps auth login`) | No |
| `get_segment` | Get one audience segment by id, including its full filter condition and live member count. | Yes (API key or `wraps auth login`) | No |
| `preview_segment` | Preview the audience an unsaved filter condition would reach, without saving a segment. | Yes (API key or `wraps auth login`) | No |
| `create_segment` | Save a new audience segment from a filter condition. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `update_segment` | Change an existing audience segment: rename it, edit its description, replace its condition, or toggle trackMembership. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `delete_segment` | Permanently delete an audience segment. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `list_topics` | List the organization's subscription topics with live audience counts: subscriberCount (opted in), sendableCount (a broadcast would reach now) and pendingCount (waiting on double opt-in). | Yes (API key or `wraps auth login`) | No |
| `get_topic` | Get one subscription topic by id, with its audience counts (subscriberCount, sendableCount, pendingCount) and its creator. | Yes (API key or `wraps auth login`) | No |
| `list_topic_subscribers` | List the contacts subscribed to one topic, filtered by status (subscribed, pending for double opt-in not yet confirmed, or unsubscribed). | Yes (API key or `wraps auth login`) | No |
| `create_topic` | Create a subscription topic that contacts can subscribe to and broadcasts can target. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `update_topic` | Change a subscription topic's name, slug, description, public flag or double opt-in setting. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `delete_topic` | Permanently delete a subscription topic and every subscription to it. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `list_templates` | List the Wraps email and SMS templates in your organization. | Yes (API key or `wraps auth login`) | No |
| `get_template` | Get one Wraps template by id: its metadata, status, variables, and by default its React Email source, compiled HTML, and compiled text. | Yes (API key or `wraps auth login`) | No |
| `create_template` | Create a new Wraps email or SMS template as a DRAFT. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `update_template` | Change an existing Wraps template. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `duplicate_template` | Copy an existing Wraps template to start a variant. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `publish_template` | Publish a Wraps template to SES, so sends and workflows that use it get this content. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `list_broadcasts` | List broadcasts (email or SMS batch sends) for your organization, with their status and delivery counts. | Yes (API key or `wraps auth login`) | No |
| `get_broadcast` | Get the status and delivery counts of ONE broadcast by id. | Yes (API key or `wraps auth login`) | No |
| `list_broadcast_recipients` | List the per-recipient outcome of one broadcast: who was sent to, and whether each send was delivered, bounced, suppressed or failed, with the error reason. | Yes (API key or `wraps auth login`) | No |
| `get_broadcast_clicks` | Get the link-click breakdown for ONE broadcast: which URLs were clicked and how often, plus the unsubscribe click count. | Yes (API key or `wraps auth login`) | No |
| `create_broadcast` | Create a NEW broadcast as a draft. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `update_broadcast` | Edit a SCHEDULED broadcast before it sends: its content, sender, audience, template, AWS account or send time. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `duplicate_broadcast` | Copy an existing broadcast into a NEW draft, whatever the status of the original. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `send_broadcast` | Send a DRAFT broadcast to its audience, now or at scheduledFor. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `resume_broadcast` | Resume an email broadcast that stopped part-way, from the last chunk it finished, so recipients who were not yet sent to get the message. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `cancel_broadcast` | Cancel a broadcast that is scheduled, queued or processing, so the messages that have not gone out yet are not sent. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `list_events` | List custom events tracked for this Wraps organization, newest first, optionally filtered by event name, contact, text search, or date range. | Yes (API key or `wraps auth login`) | No |
| `get_event` | Get one custom event by id: its name, properties, time, and the contact it belongs to. | Yes (API key or `wraps auth login`) | No |
| `get_event_analytics` | Get custom-event totals for this organization over the last 7 or 30 days: events in the period, active contacts, average events per contact, a zero-filled daily series, and the top event names. | Yes (API key or `wraps auth login`) | No |
| `list_event_names` | List every distinct custom event name recorded for this Wraps organization, sorted. | Yes (API key or `wraps auth login`) | No |
| `track_event` | Record a custom event for one contact. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `remove_suppression` | Remove one address from the SES account-level suppression list of one AWS account, so Wraps sends to it again. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `list_workflows` | List the email and SMS automation workflows in your Wraps organization, newest first, with status and execution counts. | Yes (API key or `wraps auth login`) | No |
| `get_workflow` | Get one workflow by id, including its trigger config, steps and transitions, so you can see what it does before triggering it or changing its schedule. | Yes (API key or `wraps auth login`) | No |
| `list_workflow_executions` | List the executions of one workflow (one run per contact), newest first, each with its contact and status. | Yes (API key or `wraps auth login`) | No |
| `get_workflow_execution` | Get one workflow execution by id, with its step trace (every step it reached and that step status), its contact, the workflow name and per-step engagement. | Yes (API key or `wraps auth login`) | No |
| `enable_workflow_schedule` | Turn on the recurring schedule of a schedule-triggered workflow by creating its next one-time run from a cron expression and timezone. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `disable_workflow_schedule` | Turn off the recurring schedule of a schedule-triggered workflow by deleting its pending scheduled run. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `trigger_workflow` | Start one run of an API-triggered workflow for one contact, so the workflow steps begin for that contact now. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `retry_workflow_execution` | Retry a failed workflow execution from the step where it failed. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `cancel_workflow_execution` | Cancel a workflow execution that is still running (pending, active, paused or waiting), so no further steps run for that contact and its scheduled steps are removed. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `list_agent_approvals` | List the approval queue for agents: the sends that an agent asked to make and that were held for a human decision. | Yes (API key or `wraps auth login`) | No |
| `approve_agent_approval` | Approve one send that an agent asked to make and that was held for a human decision, so Wraps sends it now. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `reject_agent_approval` | Reject one send that an agent asked to make and that was held for a human decision, so it is never delivered. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |
| `get_email_metrics` | Get aggregate email sending metrics for this organization over a time window: sent, delivered, bounced (split into permanent, transient and undetermined), complained, suppressed, opened, clicked, failed, and an estimated costUsd. | Yes (API key or `wraps auth login`) | No |
| `list_inbound_emails` | List one page of parsed inbound emails that the customer's SES inbound bucket received, across the organization's connected AWS accounts. | Yes (API key or `wraps auth login`) | No |
| `get_inbound_email` | Get one parsed inbound email from the customer's SES inbound bucket by emailId, with its from/to/cc, subject, date, headers, text body, HTML body and attachment metadata. | Yes (API key or `wraps auth login`) | No |
| `list_brand_kits` | List the organization's brand kits: name, logo, colors, fonts, button style, company details and social links, with isDefault marking the one default kit. | Yes (API key or `wraps auth login`) | No |
| `get_brand_kit` | Get one brand kit by id: logo, colors, fonts, button style, company details, social links, and isDefault. | Yes (API key or `wraps auth login`) | No |
| `create_brand_kit` | Create a brand kit: a name, logo, colors, fonts, button style, company details and social links that email templates can use. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `update_brand_kit` | Change one or more fields of a brand kit: name, logo, colors, fonts, button style, company details, social links. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `set_default_brand_kit` | Make one brand kit the default for the organization. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` |
| `delete_brand_kit` | Delete a brand kit permanently. | Yes (API key or `wraps auth login`) | Yes — requires `WRAPS_WRITE_ENABLED=true` and `confirm: true` |

The API-backed rows ("Needs Wraps?" = Yes) need a Wraps API credential. See [Wraps API tools](#wraps-api-tools).

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
      "args": ["-y", "@wraps.dev/mcp"],
      "env": {
        "AWS_REGION": "us-east-1"
      }
    }
  }
}
```

Set `AWS_REGION` to the region your Wraps stack is deployed in — SES identities are per-region, and a domain verified in another region reads as "not found". Claude Code inherits your shell's AWS environment, so you can drop the `env` block entirely if `AWS_REGION` (or a region in your active AWS profile) is already set there; the server fails at startup if neither supplies one.

## Configuration

All configuration is via environment variables.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AWS_REGION` | Yes* | — | AWS region where your Wraps stack is deployed. *Required unless your active AWS profile (`~/.aws/config`) supplies a region — the server resolves `AWS_REGION`, then `AWS_DEFAULT_REGION`, then the profile, and errors at startup if none of them do. |
| `WRAPS_HISTORY_TABLE_NAME` | No | `wraps-email-history` | DynamoDB table name for email history |
| `WRAPS_ACCOUNT_ID` | No | auto-detected via STS | Your AWS account ID (skip STS call if set) |
| `WRAPS_WRITE_ENABLED` | No | `false` | Set to `true` to enable `send_email` and every write or destructive API-backed tool |
| `WRAPS_FROM_EMAIL` | No | — | Default `from` address for `send_email` |
| `WRAPS_API_KEY` | No | — | Wraps API key (`wraps_...`) for the API-backed tools. Without it, the session from `wraps auth login` is used |
| `WRAPS_API_URL` | No | `https://api.wraps.dev` | Wraps API base URL. Set it for a self-hosted control plane |
| `WRAPS_ORG_ID` | No | — | Organization to act in when the session belongs to several. Sent as `x-organization-id` |

## Wraps API tools

The tools marked "Needs Wraps? Yes (API key or `wraps auth login`)" call the Wraps API for your organization. They register at startup only when a credential is present. The server uses the first of these that it finds:

1. `WRAPS_API_KEY`, a `wraps_...` key.
2. The unexpired session stored by `wraps auth login` (or `wraps selfhost login` for a self-hosted instance).

With neither, only the AWS tools register. An expired or revoked credential does not stop startup; the call returns a tool error that names the fix.

Write tools need `WRAPS_WRITE_ENABLED=true`. Destructive tools also need `confirm: true` in the call, so set it only after the user has confirmed the change. When `WRAPS_AGENT_ID` is set (enforced mode), `approve_agent_approval` and `reject_agent_approval` are not registered.

```json
{
  "mcpServers": {
    "wraps": {
      "command": "npx",
      "args": ["-y", "@wraps.dev/mcp"],
      "env": {
        "AWS_REGION": "us-east-1",
        "WRAPS_API_KEY": "wraps_..."
      }
    }
  }
}
```

## Write Mode

`send_email` and the other write tools are disabled by default. Set `WRAPS_WRITE_ENABLED=true` to enable them. The `from` address must be a domain verified in your SES account.

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

## Asking for missing input (elicitation)

If your MCP client supports elicitation, `send_email` asks you for input it is missing instead of failing. It never asks you to confirm an ordinary send, and it asks only after the write, recipient-count and allowlist checks above have passed.

- **No sender.** If the call has no `from` and `WRAPS_FROM_EMAIL` is not set, the client prompts for the sender address.
- **SES sandbox.** If SES rejects the recipient because the account is in the sandbox, the client offers to send the message to the AWS mailbox simulator (`success@simulator.amazonses.com`) instead, to prove sending works. This happens once, and the simulator address must pass your recipient allowlist. The result says the message went to the simulator and not to the original recipient.

If you decline or cancel, or the client does not support elicitation, you get the same error as before. No setting is needed. Enforced mode does not use elicitation; its approvals stay with the operator.

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

### Replies and threading

Enforced-mode `send_email` accepts three optional fields for conversational sends —
an SDR sequence, a scheduling follow-up, anything where a human replies:

| Field | Purpose |
|-------|---------|
| `replyTo` | A single address where a human's reply should land. Without it, replies reach the agent's own mailbox — right for `support@`, wrong when a person should pick the conversation up. |
| `inReplyTo` | `Message-ID` of the message being replied to, e.g. `<abc@mail.example.com>`. |
| `references` | Space-separated `Message-ID` chain of the conversation so far. Set it alongside `inReplyTo` so a follow-up threads instead of arriving as an orphan. |

`replyTo` does **not** loosen sender pinning: `from` is still forced to the agent's own
verified identity, and pointing `replyTo` at a teammate is the intended use. The enforcer
rejects a `replyTo` carrying more than one address, and rejects `inReplyTo`/`references`
containing newlines or non-printable characters — both come back as a `blocked` disposition
with a reason, and neither consumes a rate-limit slot.

Requires an enforcer Lambda built from `@wraps/core` 2026-08-28 or later; against an older
enforcer the fields are ignored rather than erroring.

## License

MIT
