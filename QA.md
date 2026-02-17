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

```bash
openclaw agent -m 'Use the browser tool to fill and submit a form. Follow these exact steps:
1. Call browser with request="navigate" and targetUrl="https://convos-agent-main.up.railway.app/web-tools/form"
2. Call browser with request="snapshot" to get the page elements and their ref IDs
3. For each form field, call browser with request="act", action="fill", ref="<ref from snapshot>", value="<test data>"
4. Call browser with request="act", action="click", ref="<submit button ref>" to submit
5. Call browser with request="snapshot" to read the confirmation code
Reply with: Form submitted. Confirmation code: <the code from the page>' --agent main
```
