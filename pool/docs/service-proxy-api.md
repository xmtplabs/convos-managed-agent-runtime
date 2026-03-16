# Service Proxy API

The pool manager proxies email and SMS service calls on behalf of instances. Instances no longer hold API keys directly — the pool injects real credentials and forwards to upstream providers.

## Authentication

Two auth modes are supported on provision endpoints:

| Mode | Header | instanceId source |
|------|--------|-------------------|
| Admin | `Authorization: Bearer <POOL_API_KEY>` | `instanceId` in request body |
| Instance | `Authorization: Bearer <instanceId>:<gatewayToken>` | Extracted from token |

The status endpoint accepts admin auth only.

---

## Provision Email

```
POST /api/proxy/email/provision
```

**Body (admin auth):**
```json
{ "instanceId": "<id>" }
```

**Response:**
```json
{ "email": "<inbox-id>", "provisioned": true }
```

Idempotent — if already provisioned, returns `provisioned: false` with the existing inbox ID.

| Status | Meaning |
|--------|---------|
| 200 | Success or already provisioned |
| 503 | Email service not configured on pool |
| 502 | Upstream provisioning failed |

---

## Provision SMS

```
POST /api/proxy/sms/provision
```

**Body (admin auth):**
```json
{ "instanceId": "<id>" }
```

**Response:**
```json
{ "phone": "+1...", "provisioned": true }
```

Idempotent — if already provisioned, returns `provisioned: false` with the existing phone number.

| Status | Meaning |
|--------|---------|
| 200 | Success or already provisioned |
| 503 | SMS service not configured on pool |
| 502 | Upstream provisioning failed |

---

## Service Status

Read-only check for provisioned services. Does not trigger provisioning.

```
GET /api/proxy/services/status?instanceId=<id>
Auth: Authorization: Bearer <POOL_API_KEY>
```

**Response:**
```json
{
  "instanceId": "...",
  "email": "inbox@..." | null,
  "phone": "+1..." | null
}
```

Returns `null` for non-provisioned services.
