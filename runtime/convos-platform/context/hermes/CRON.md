
### Cron Tools

You have the `cronjob` toolset for scheduling recurring tasks. See CUSTOMIZATION.md for the two cron patterns (wake-up vs delivery).

- Cron jobs have no end time or auto-expiry. They run until explicitly removed. Do NOT create a second cleanup job to delete the first; that pattern is fragile and fails silently.
- All cron jobs run in fresh sessions with no conversation context. Set `deliver` to `"convos"` so the response goes back to the chat. If `deliver` is `"local"` or omitted, the output is saved to disk but the user never sees it.
- In cron sessions, do NOT use the `message` tool — just return your text directly. The delivery layer routes it to the right conversation automatically.
