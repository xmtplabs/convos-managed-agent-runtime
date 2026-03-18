# Hermes Web Tools — Services & Landing Pages

## Problem

Hermes agents link users to `/web-tools/services` but nothing serves that page. OpenClaw serves it via its plugin system, which Hermes can't use.

## Design

### Shared static assets

Move the HTML/CSS/static files out of the OpenClaw extension into a shared location both runtimes can access:

```
runtime/shared/web-tools/
  services/services.html
  services/services.css
  convos/landing.html
  convos/landing-manifest.json
  convos/sw.js
  convos/icon.svg
```

The OpenClaw plugin wiring stays in place:
```
runtime/openclaw/extensions/web-tools/
  index.ts              → updated to read from /app/web-tools/
  openclaw.plugin.json  → unchanged
  package.json          → unchanged
```

### Dockerfile changes

Both Dockerfiles add:
```dockerfile
COPY runtime/shared/web-tools /app/web-tools
```

### Hermes FastAPI routes

New module `runtime/hermes/src/web_tools.py` mounted on the existing FastAPI app. Routes:

| Method | Path | Behavior |
|--------|------|----------|
| GET | `/web-tools/services` | Serve `services.html` with `window.__POOL_TOKEN` injected |
| GET | `/web-tools/services/` | Same (trailing slash) |
| GET | `/web-tools/services/api` | JSON: email, phone, credits, instance info (fetched from pool) |
| GET | `/web-tools/services/services.css` | Serve CSS |
| POST | `/web-tools/services/topup` | Proxy to pool manager `credits-topup` |
| POST | `/web-tools/services/redeem-coupon` | Proxy to pool manager `redeem-coupon` |
| GET | `/web-tools/convos` | Serve `landing.html` with `window.__POOL_TOKEN` injected |
| GET | `/web-tools/convos/` | Same (trailing slash) |
| GET | `/web-tools/convos/manifest.json` | Serve static JSON |
| GET | `/web-tools/convos/sw.js` | Serve static JS |
| GET | `/web-tools/convos/icon.svg` | Serve static SVG |

The `/services/api` endpoint replicates `getServicesData()` from the OpenClaw extension:
1. Fetch identity (email, phone) from `POOL_URL/api/proxy/info`
2. Fetch runtime version from `POOL_URL/api/pool/self-info`
3. Fetch credits from `POOL_URL/api/pool/credits-check`
4. Return combined JSON

Auth uses gateway token from config, same as existing Hermes endpoints.

### OpenClaw extension update

Update `index.ts` path resolution:
- Docker: read from `/app/web-tools/` (copied by Dockerfile)
- Local dev: fall back to `__dirname` relative paths (for backward compat)

### What doesn't change

- The HTML/CSS files — identical content, just moved
- Client-side JS — still calls relative URLs
- Hermes info handler — already generates the correct `/web-tools/services` URL
- OpenClaw plugin registration — same routes, just different file paths
