# QA commands

Gateway must be running (`pnpm gateway`). Use `--session-id "qa-<suite>-$(date +%s)"` for isolated runs, or omit for default session.

## Email

```bash
openclaw agent -m "Send a random short email to fabri@xmtp.com. Reply: Email sent." --agent main
```

## SMS

```bash
openclaw agent -m "Send a random short SMS to +16154376139. Reply: SMS sent." --agent main
```

## Bankr

```bash
openclaw agent -m "Check my USDC balance. Reply: USDC: <balance>." --agent main
```

## Search

```bash
openclaw agent -m 'Search the current BTC price. Reply: BTC: $X.' --agent main
```

## Browser

Gateway must be running and the browser control service starts with it. Ensure `browser.enabled` is true in config. See [docs/browser.md](browser.md) for troubleshooting.

```bash
openclaw agent -m 'go fill the form https://convos-managed-dev.up.railway.app/web-tools/form and submit it, give me the confirmation code' --agent main
```