# web-tools

Single-page mini-app served by both runtimes at `/web-tools/`. Tabs: Services, Skills, Context, Tasks, Logs, Notes.

## Files

```
web-tools/
  index.html    — mini-app (all tabs)
  app.css       — styles
```

## Routes

All tab URLs (`/web-tools/`, `/web-tools/services`, `/web-tools/skills`, `/web-tools/context`, `/web-tools/tasks`, `/web-tools/logs`, `/web-tools/notes`) serve the same `index.html` — JS auto-selects the tab from the URL path.

### API endpoints

| Route | Method | Description |
|-------|--------|-------------|
| `/web-tools/api/services` | GET | Instance identity + credits |
| `/web-tools/api/topup` | POST | Proxy credit top-up to pool |
| `/web-tools/api/redeem-coupon` | POST | Proxy coupon redemption to pool |
| `/web-tools/api/context` | GET | Workspace .md files |
| `/web-tools/api/tasks` | GET | Cron jobs |
| `/web-tools/api/logs-status` | GET | Log sharing status |
| `/web-tools/api/logs-toggle` | POST | Toggle log sharing |
| `/web-tools/skills/api` | GET | All skills |
| `/web-tools/skills/api/:slug` | GET | Single skill |
| `/web-tools/logs/api` | GET | Trajectory entries |
| `/web-tools/logs/download` | GET | Trajectories zip |

## Implementations

| Runtime | Entry point |
|---------|-------------|
| OpenClaw | `openclaw/src/web-tools/index.ts` |
| Hermes | `hermes/src/web_tools/web_tools.py` |
