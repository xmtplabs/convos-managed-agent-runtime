# Convos invite URL formats

Reference for detecting and parsing Convos invite URLs (e.g. for clipboard detection in the Convos client app).

## Recognized formats

| Format | Example |
|--------|---------|
| Full URL | `https://convos.app/join/SLUG` or `http://convos.app/join/SLUG` |
| Deeplink | `convos://join/SLUG` |
| V2 URL | `https://convos.app/...?i=PAYLOAD` or `https://*.convos.org/...?i=PAYLOAD` |
| Raw slug | Base64-like string (optionally with asterisks for iMessage); no URL wrapper |

## Regex patterns (JavaScript/TypeScript)

Use these to match and extract the invite slug/payload from a string (e.g. clipboard):

```js
const INVITE_URL_PATTERNS = [
  /^https?:\/\/convos\.app\/join\/(.+)$/i,
  /^convos:\/\/join\/(.+)$/i,
  /^https?:\/\/(?:[a-z0-9-]+\.)*convos\.(?:app|org)\/.*[?&]i=(.+)$/i,
];

function extractInviteSlug(input) {
  const trimmed = input.trim();
  for (const pattern of INVITE_URL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      let slug = match[1];
      // ?i= pattern may capture trailing query params; strip after first &
      const end = slug.indexOf("&");
      return end === -1 ? slug : slug.slice(0, end);
    }
  }
  // Assume it's a raw slug
  return trimmed;
}
```

## Usage (e.g. clipboard detection)

1. On app launch or foreground, read the system clipboard string.
2. If `extractInviteSlug(clipboardString)` returns a non-empty string, the clipboard contains a Convos invite.
3. Show UX: "Join conversation from clipboard?" → Join uses the extracted slug with your existing join flow; Dismiss ignores.
4. Read clipboard only when the app is opened or brought to foreground (not in background).

Source: `extensions/convos-sdk/src/onboarding.ts` (INVITE_URL_PATTERNS, extractInviteSlug).
