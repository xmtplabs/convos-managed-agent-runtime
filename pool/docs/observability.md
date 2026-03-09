# Pool Observability

The pool manager sends structured logs and metrics to Datadog. Both require `DATADOG_API_KEY` to be set.

## Configuration

| Env var | Purpose |
|---------|---------|
| `DATADOG_API_KEY` | Enables both logs and metrics |
| `DATADOG_SITE` | DD region (default: `datadoghq.com`) |
| `POOL_ENVIRONMENT` | Environment tag (`dev`, `staging`, `production`) — falls back to `RAILWAY_ENVIRONMENT_NAME` |

## Structured Logs

Logs are sent via the [DD HTTP log intake API](https://docs.datadoghq.com/api/latest/logs/#send-logs). Every log entry includes:

| Field | Example | Description |
|-------|---------|-------------|
| `env` | `dev` | Pool environment |
| `branch` | `dev` | Deploy branch |
| `ddsource` | `convos-pool` | DD source facet |
| `service` | `convos-pool` | Service name |
| `level` | `info` / `warn` / `error` | Log level |
| `message` | `claim.complete` | Event name |

The `ddtags` HTTP header is also sent with `env:<env>,branch:<branch>` for DD facet indexing.

### Log Events

#### Instance Creation Lifecycle

| Event | Level | When | Key fields |
|-------|-------|------|------------|
| `create.start` | info | Infra provisioning begins | `instanceId`, `name` |
| `create.complete` | info | Health check passes, instance promoted to idle | `instanceId`, `name`, `duration_ms`, `version` |
| `create.fail` | error | Top-level create failure (rollup) | `instanceId`, `name`, `error_class`, `error_message` |
| `create.provider_fail` | error | Tool provisioning failed (openrouter/agentmail/telnyx) | `instanceId`, `failed_step`, `error_class`, `provisioned` |
| `create.railway_env_fail` | error | Failed to resolve Railway environment | `instanceId`, `projectId`, `error_class` |
| `create.railway_service_fail` | error | Railway service creation failed | `instanceId`, `projectId`, `error_class` |
| `create.db_insert_fail` | error | DB insert after infra creation failed | `instanceId`, `projectId`, `error_class`, `provisioned` |
| `create.rollback_fail` | warn | Cleanup of a tool failed during rollback | `instanceId`, `tool`, `error_message` |
| `create.orphan_cleanup_fail` | warn | Orphan Railway project cleanup failed | `instanceId`, `projectId` |
| `create.orphan_db_cleanup_fail` | warn | Orphan DB row cleanup failed | `instanceId` |

#### Claim Lifecycle

| Event | Level | When | Key fields |
|-------|-------|------|------------|
| `claim.start` | info | Instance claimed, provisioning begins | `instanceId`, `agentName`, `hasJoinUrl`, `source` |
| `claim.complete` | info | Agent provisioned and conversation created/joined | `instanceId`, `agentName`, `conversationId`, `joined`, `duration_ms`, `source` |
| `claim.fail` | error | Claim or provision failed | `instanceId`, `agentName`, `stage`, `error_class`, `error_message`, `source` |
| `claim.no_idle` | warn | No idle instances available for claim | `agentName`, `hasJoinUrl`, `source` |

#### Source Values

The `source` field on claim logs identifies where the claim originated:

| Value | Origin |
|-------|--------|
| `admin` | Pool manager dashboard (`admin.html`) |
| `landing` | Public-facing dashboard (Next.js proxy) |
| `api` | Direct API call (default when no source specified) |

### Error Classification

Errors are classified automatically by `classifyError()` in `logger.ts`:

| `error_class` | Matches |
|----------------|---------|
| `timeout` | `AbortError`, `TimeoutError`, message contains "timeout" or "aborted" |
| `http_4xx` | HTTP status 400-499 |
| `http_5xx` | HTTP status 500+ |
| `network` | `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, fetch failures |
| `unknown` | Everything else |

Error messages are truncated to 1500 characters.

---

## Metrics

Metrics use the `datadog-metrics` library with prefix `convos.pool.` and default tag `env:<poolEnvironment>`.

### Counters (increment)

| Metric | Tags | Description |
|--------|------|-------------|
| `instance.create.start` | | Instance creation initiated |
| `instance.create.complete` | | Instance healthy and promoted to idle |
| `instance.create.fail` | `phase`, `error_class`, `provider` | Creation failed at a specific phase |
| `instance.claim.start` | | Claim attempt started |
| `instance.claim.complete` | | Claim + provision succeeded |
| `instance.claim.fail` | `reason`, `error_class`, `stage` | Claim failed |
| `provider.telnyx.provisioned` | | Telnyx phone provisioned |
| `provider.openrouter.provisioned` | | OpenRouter key created |
| `provider.agentmail.provisioned` | | AgentMail inbox created |
| `provider.railway.project.provisioned` | | Railway project created |
| `provider.rollback` | `failed_step` | Tool rollback triggered |
| `webhook.received` | `event` | Railway webhook received |
| `webhook.processed` | `event` | Webhook matched and processed |
| `webhook.error` | `event` | Webhook processing error |
| `webhook.state_change` | `from`, `to` | Instance status changed via webhook |
| `webhook.health_check_promoted` | `from`, `to` | Instance promoted after health check |

### Histograms (distribution)

| Metric | Tags | Description |
|--------|------|-------------|
| `instance.create.duration_ms` | | Time from creation to healthy (idle) |
| `instance.claim.duration_ms` | | Time from claim start to provision complete |
| `provider.telnyx.duration_ms` | `step` | Telnyx provisioning latency |
| `provider.openrouter.duration_ms` | `step` | OpenRouter key creation latency |
| `provider.agentmail.duration_ms` | `step` | AgentMail inbox creation latency |
| `provider.railway.project.duration_ms` | | Railway project creation latency |
| `provider.railway.service.duration_ms` | | Railway service creation latency |

### Gauges (polled every 15s)

Pool status counts by instance status (`idle`, `claimed`, `starting`, `crashed`, etc.) — emitted as `convos.pool.<status>`.

---

## Files

| File | Role |
|------|------|
| `src/logger.ts` | Structured log forwarding + error classification |
| `src/metrics.ts` | DD metrics client, gauge polling, counter/histogram helpers |
| `src/provision.ts` | Claim lifecycle logs + metrics |
| `src/pool.ts` | Create lifecycle logs + metrics, health check promotion |
| `src/services/infra.ts` | Granular create phase logs + metrics |
| `src/webhook.ts` | Webhook metrics + health check promotion logs |
