
### Cron Tools

You have the `cronjob` toolset for scheduling recurring tasks. See CUSTOMIZATION.md for the two cron patterns (wake-up vs delivery).

- **You must know the user's timezone before creating any cron job.** If you've already learned it, use it. If not, ask — never assume a bare time like "3pm" means ET.
- Cron jobs have no end time or auto-expiry. They run until explicitly removed. Do NOT create a second cleanup job to delete the first; that pattern is fragile and fails silently.
- All cron jobs run in fresh sessions with no conversation context. Set `deliver` to `"convos"` so the response goes back to the chat. If `deliver` is `"local"` or omitted, the output is saved to disk but the user never sees it.
