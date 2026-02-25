# Template Site Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `assistants.convos.org` as a standalone Next.js app. Milestone 1 achieves exact parity with the current user-facing homepage in `pool/src/index.js` — same pixels, same behavior, same animations. Milestone 2 adds template subpages, OG images, and QR codes for the viral loop.

**Architecture:** Next.js app deployed separately from Pool. Pool remains the API backend. The template site uses Pool's CSS verbatim (no Tailwind conversion until parity is verified via screenshot diffing). State machines are specified in this document and implemented exactly.

**Tech Stack:** Next.js 15 (App Router), TypeScript, raw CSS extracted from Pool (parity phase), Tailwind CSS (post-parity only), Playwright for screenshot diffing, `@vercel/og` + `qrcode` (Milestone 2).

---

# Migration Strategy

Three interlocking approaches guarantee that the Next.js app is indistinguishable from the original.

## A. CSS-First: Extract, Don't Rewrite

The original page has ~900 lines of precise CSS with pixel-specific values, complex keyframe animations, and interaction pseudo-states. **Do not translate these to Tailwind.** Instead:

1. **Task 1** extracts the complete user-facing CSS from `pool/src/index.js` into `dashboard/src/app/pool.css` verbatim. Every class name, every value, every keyframe — copied exactly.
2. React components render the **same HTML structure** with the **same class names** as the original.
3. Tailwind is available for new layout/structural styles (the page wrapper, component composition) but the visual styles come from `pool.css`.
4. After Milestone 1 parity is confirmed, Tailwind conversion is a separate optional effort protected by the screenshot tests.

**Why:** CSS-to-Tailwind translation is where visual bugs hide. A `tracking-tight` that should be `tracking-[-0.8px]`, a `rounded-xl` that should be `rounded-[14px]`, a missing `box-shadow`. Copying the CSS eliminates this entire class of errors.

## B. Screenshot-Diff Verification

Every task that changes visual output ends with an automated screenshot comparison.

**Setup (Task 0):** Install Playwright. Create a test that:
1. Starts Pool dev server on :3001
2. Starts Next.js dev server on :3000
3. For each state in the screenshot matrix below, captures both pages
4. Computes pixel-diff percentage
5. Fails if diff > 0.5% (allows anti-aliasing variance)

**Screenshot matrix** (captured at 1280×800 and 375×812):

| State | How to trigger |
|-------|----------------|
| `idle` | Default page load with `idle > 0` |
| `empty` | Mock `/api/pool/counts` to return `idle: 0` |
| `joining` | Paste a URL, capture during animation |
| `success` | Mock claim to return `{joined: true}`, capture at confetti peak |
| `post-success` | Capture after auto-dismiss (toast visible, step 2 highlighted) |
| `error` | Mock claim to fail, capture droop + "Try again" |
| `skill-browser-default` | Scroll to skill section, default 10 items |
| `skill-browser-expanded` | Click "Show all", capture full list |
| `skill-browser-filtered` | Select a category, capture filtered view |
| `skill-browser-search` | Type a search term, capture results |
| `prompt-modal` | Click View on a skill |
| `qr-modal` | Trigger QR modal (mock claim returning inviteUrl) |

Each task's "Verify" section specifies which states to capture and diff.

## C. State Machine Specification

Every piece of interactive behavior is specified below as a state machine with explicit states, transitions, side effects, and timer chains. The engineer implements these exactly — no improvising behavior from "studying the original."

## D. Mock Pool Server

### The Problem

The Next.js app talks to Pool in two ways:
1. **Server-side** (Node.js): `api.ts` functions fetch `POOL_API_URL/api/pool/templates`, `POOL_API_URL/api/pool/counts`, etc. during SSR/RSC. The Next.js API proxy routes (`/api/claim`, `/api/prompts/[pageId]`) also call Pool server-side.
2. **Client-side** (browser): The polling `useEffect` fetches `NEXT_PUBLIC_POOL_API_URL/api/pool/counts` directly from the browser every 15 seconds.

Playwright's `page.route()` can only intercept browser-initiated requests. It **cannot** intercept the server-side calls that happen inside the Next.js Node process. This means you can't use `page.route()` to mock an empty pool, a claim success, or a claim error — those calls flow through the Next.js API proxies which call Pool from the server.

### The Solution: A Lightweight Mock Pool Server

A tiny Express server (`dashboard/tests/mock-pool.ts`) that implements every Pool endpoint the template site uses. Both `POOL_API_URL` and `NEXT_PUBLIC_POOL_API_URL` point to it during tests. A control endpoint (`POST /_control/state`) lets Playwright tests switch between fixture states before each screenshot capture.

### Fixture States

| State name | `GET /api/pool/counts` | `POST /api/pool/claim` | `GET /api/prompts/:pageId` |
|---|---|---|---|
| `idle` | `{ idle: 3, starting: 0, claimed: 1, crashed: 0 }` | N/A (not triggered) | Returns mock prompt |
| `empty` | `{ idle: 0, starting: 0, claimed: 0, crashed: 0 }` | N/A (not triggered) | Returns mock prompt |
| `success` | `{ idle: 3, starting: 0, claimed: 1, crashed: 0 }` | `{ joined: true, instanceId: "mock-inst-1" }` | Returns mock prompt |
| `error` | `{ idle: 3, starting: 0, claimed: 1, crashed: 0 }` | 500 `{ error: "Connection failed" }` | Returns mock prompt |
| `qr-modal` | `{ idle: 3, starting: 0, claimed: 1, crashed: 0 }` | `{ joined: false, inviteUrl: "https://converse.xyz/dm/mock-invite", agentName: "Meal Planner" }` | Returns mock prompt |

All states return the same template catalog from `GET /api/pool/templates` (loaded from `agents-data.json` or a trimmed fixture copy). All states return the same mock prompt text from `GET /api/prompts/:pageId`.

### Mock Server Implementation

`dashboard/tests/mock-pool.ts`:

```typescript
import express from "express";
import { readFileSync } from "fs";
import { resolve } from "path";

const app = express();
app.use(express.json());

// --- Fixture data ---

const CATALOG = (() => {
  try {
    const raw = JSON.parse(readFileSync(resolve(__dirname, "fixtures/catalog.json"), "utf8"));
    return raw;
  } catch {
    return [];
  }
})();

const MOCK_PROMPT = {
  prompt: "You are a helpful AI assistant. You help users with meal planning, grocery lists, and recipe suggestions. Be friendly and concise.",
};

const COUNTS: Record<string, { idle: number; starting: number; claimed: number; crashed: number }> = {
  idle:      { idle: 3, starting: 0, claimed: 1, crashed: 0 },
  empty:     { idle: 0, starting: 0, claimed: 0, crashed: 0 },
  success:   { idle: 3, starting: 0, claimed: 1, crashed: 0 },
  error:     { idle: 3, starting: 0, claimed: 1, crashed: 0 },
  "qr-modal": { idle: 3, starting: 0, claimed: 1, crashed: 0 },
};

const CLAIM_RESPONSES: Record<string, { status: number; body: object }> = {
  idle:      { status: 200, body: { joined: true, instanceId: "mock-inst-1" } },
  empty:     { status: 503, body: { error: "No idle instances available. Try again in a few minutes." } },
  success:   { status: 200, body: { joined: true, instanceId: "mock-inst-1" } },
  error:     { status: 500, body: { error: "Connection failed" } },
  "qr-modal": { status: 200, body: { joined: false, inviteUrl: "https://converse.xyz/dm/mock-invite", agentName: "Meal Planner" } },
};

// --- Mutable state ---

let currentState = "idle";

// --- Control endpoint (test-only) ---

app.post("/_control/state", (req, res) => {
  const { state } = req.body;
  if (!COUNTS[state]) return res.status(400).json({ error: `Unknown state: ${state}`, valid: Object.keys(COUNTS) });
  currentState = state;
  res.json({ ok: true, state: currentState });
});

app.get("/_control/state", (_req, res) => {
  res.json({ state: currentState });
});

// --- Pool API endpoints ---

app.get("/api/pool/counts", (_req, res) => {
  res.json(COUNTS[currentState] || COUNTS.idle);
});

app.get("/api/pool/templates", (_req, res) => {
  res.json(CATALOG);
});

app.get("/api/pool/templates/:slug", (req, res) => {
  const t = CATALOG.find((a: any) => a.slug === req.params.slug);
  if (!t) return res.status(404).json({ error: "Template not found" });
  res.json(t);
});

app.post("/api/pool/claim", (_req, res) => {
  const response = CLAIM_RESPONSES[currentState] || CLAIM_RESPONSES.idle;
  res.status(response.status).json(response.body);
});

app.get("/api/prompts/:pageId", (req, res) => {
  if (!/^[a-f0-9]{32}$/.test(req.params.pageId)) {
    return res.status(400).json({ error: "Invalid page ID" });
  }
  res.json(MOCK_PROMPT);
});

// --- CORS (same as real Pool) ---

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});

const PORT = parseInt(process.env.MOCK_POOL_PORT || "3002", 10);
app.listen(PORT, () => console.log(`[mock-pool] listening on :${PORT}`));
export { app };
```

### Fixture Catalog

`dashboard/tests/fixtures/catalog.json`: A trimmed copy of `agents-data.json` processed through the same slugify/category-rename logic as the real Pool. Include at least 15 agents spanning all categories so the skill browser filter, search, and "Show all" states exercise real paths. Generate this once from Pool:

```bash
curl http://localhost:3001/api/pool/templates | python3 -m json.tool > dashboard/tests/fixtures/catalog.json
```

### Environment Variable Strategy

Next.js loads env files in this precedence order: `process.env` > `.env.local` > `.env`. The key insight: **`process.env` values set before Next.js boots win over everything**, including `.env.local`. Playwright's `webServer.env` sets vars on the spawned child process, so they land in `process.env` before Next.js starts.

**However**, Playwright's `env` option **replaces** the child's entire environment (it doesn't merge). You must spread `process.env` to keep `PATH`, `HOME`, etc.

**Two env files, no conflicts:**

| File | Purpose | `POOL_API_URL` | `NEXT_PUBLIC_POOL_API_URL` |
|------|---------|----------------|---------------------------|
| `.env.local` | Local dev against real Pool (gitignored) | `http://localhost:3001` | `http://localhost:3001` |
| `.env.example` | Template for new developers (committed) | `http://localhost:3001` | `http://localhost:3001` |

Test values live exclusively in `playwright.config.ts` — no `.env.test` file needed. The Playwright config explicitly overrides the Pool URL to point at the mock server via `process.env` on the spawned Next.js process. Because `process.env` beats `.env.local`, the developer's `.env.local` pointing at real Pool on :3001 is harmlessly ignored during test runs.

### Playwright Integration

The Playwright config starts the mock Pool server before the test suite and the Next.js dev server pointed at it:

```typescript
// dashboard/playwright.config.ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: [
    {
      command: "npx tsx tests/mock-pool.ts",
      port: 3002,
      reuseExistingServer: !process.env.CI,
      env: { ...process.env, MOCK_POOL_PORT: "3002" },
    },
    {
      command: "pnpm dev",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      // process.env is spread first so PATH, HOME, etc. are preserved.
      // The POOL overrides land in process.env BEFORE Next.js boots,
      // so they take precedence over .env.local values.
      env: {
        ...process.env,
        POOL_API_URL: "http://localhost:3002",
        NEXT_PUBLIC_POOL_API_URL: "http://localhost:3002",
        POOL_API_KEY: "mock-key",
      },
    },
  ],
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
});
```

### Test Helper

```typescript
// dashboard/tests/helpers.ts
const MOCK_POOL_URL = "http://localhost:3002";

export async function setMockState(state: string): Promise<void> {
  const res = await fetch(`${MOCK_POOL_URL}/_control/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new Error(`Failed to set mock state: ${await res.text()}`);
}
```

Each Playwright test calls `setMockState("empty")` (or whatever state) before navigating. The mock server responds accordingly for **both** the Next.js server-side calls and the browser's direct polling.

### Why Not MSW?

MSW (Mock Service Worker) intercepts at the network layer inside the same Node process. But Next.js server components run in the Next.js server process, not in the Playwright process. MSW would need to be wired into the Next.js server startup, which requires modifying the app code for tests. A separate mock server is simpler — no test-only code in production paths, no build-time conditional imports, and it naturally handles both server-side and client-side requests because they all go to the same URL.

---

# State Machine: Join Flow

This is the primary interaction on the page. It controls the paste input area, joining animation, success flow, and step highlights.

```
                                    ┌─────────────┐
                              ┌─────│ unavailable  │◄──── refreshStatus: idle===0 && !launching
                              │     └─────────────┘
                              │            │
                              │     refreshStatus: idle>0
                              │            ▼
                              │     ┌─────────────┐
                              └────►│    idle      │◄──── hideJoiningOverlay() / "Try again" click
                                    └──────┬──────┘
                                           │
                                    paste/Enter valid URL
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │   joining    │
                                    └──┬───┬───┬──┘
                                       │   │   │
                          claim ok,    │   │   │  claim error
                          joined:true  │   │   │
                              ┌────────┘   │   └────────┐
                              ▼            │            ▼
                       ┌──────────┐        │     ┌──────────┐
                       │ success  │        │     │  error    │
                       └────┬─────┘        │     └──────────┘
                            │              │
                     1500ms timeout        │ claim ok, joined:false
                            │              │
                            ▼              ▼
                    ┌──────────────┐  ┌──────────┐
                    │ post-success │  │ qr-modal  │
                    └──────────────┘  └──────────┘
```

### State: `unavailable`

**Visible:** Empty state balloon (drooping animation, "Hang in there", "No assistants available right now").
**Hidden:** Paste input, steps, joining animation.
**Entry condition:** `refreshStatus()` returns `idle === 0` AND `launching === false`.
**DOM:**
- `emptyState.style.display = 'block'`
- `pasteView.style.display = 'none'`

### State: `idle`

**Visible:** Paste input (enabled, empty), steps (step 1 highlighted), all content below.
**Hidden:** Empty state, joining animation.
**Entry condition:** `refreshStatus()` returns `idle > 0` AND `launching === false`. Also entered via `hideJoiningOverlay()`.
**DOM:**
- `emptyState.style.display = 'none'`
- `pasteView.style.display = ''`
- `pasteInputWrap.style.display = ''`
- `joiningSteps.style.display = ''`
- `joiningInline.className = 'joining-inline'` (hidden)
- `pasteInput.value = ''`, `pasteInput.disabled = false`
- Step 1 has class `highlight`, steps 2 and 3 do not

### State: `joining`

**Trigger:** `handlePasteUrl(url)` called with valid URL.
**Pre-transition side effects:**
1. `launching = true`
2. `pasteInput.disabled = true`
3. `pasteInput.value = ''`
4. Clear any previous error/success banners

**DOM changes (via `showJoiningOverlay('joining', ...)`):
- `pasteInputWrap.style.display = 'none'`
- `joiningSteps.style.display = 'none'`
- `joiningInline.className = 'joining-inline active joining'`
- `joiningText.textContent = 'Your assistant is on the way'`
- `joiningSub.textContent = 'Setting up a secure connection'`
- `joiningDismiss.style.display = 'none'`

**API call:** `POST /api/pool/claim` with `{joinUrl: url}` and auth headers.

**CSS animations active:**
- `.joining-inline.joining .joining-balloon-group`: `joining-inflate` 1.5s, then `joining-float` 3s infinite
- `.joining-inline.joining .joining-particle`: `joining-particle-float` 3s infinite (6 particles, staggered delays 0–1.5s)

### State: `success`

**Trigger:** Claim returns `{joined: true}`.
**DOM changes (via `showJoiningOverlay('success', ...)`):
- `joiningInline.className = 'joining-inline active success'`
- `joiningText.textContent = 'Your assistant has arrived!'`
- `joiningSub.textContent = 'They're now in your conversation'`
- `joiningDismiss.style.display = 'none'`
- Generate 20 confetti pieces dynamically:
  - Colors cycle: `['#FC4F37', '#FBBF24', '#34D399', '#60A5FA', '#E54D00']`
  - Each piece: `left: (10 + random*80)%`, `background: color`, `animationDelay: (random*0.3)s`, `width: (4 + random*4)px`, `height: (4 + random*4)px`, `borderRadius: random>0.5 ? '50%' : '2px'`

**CSS animations active:**
- `.joining-inline.success .joining-balloon-group`: `joining-success-bounce` 0.6s, then `joining-float` 3s infinite
- `.joining-inline.success .joining-confetti-piece`: `joining-confetti-rain` 1.5s forwards
- Particles hidden (`opacity: 0`)

**Timer:** `joiningAutoHideTimer = setTimeout(→ post-success, 1500)`

**Note:** `launching` stays `true` during this state. A separate `setTimeout(→ launching=false; refreshStatus(), 1800)` runs, so the 1800ms > 1500ms means `launching` clears 300ms after the overlay dismisses. This prevents `refreshStatus` from flashing the empty state during the transition.

### State: `post-success`

**Trigger:** 1500ms after entering `success`.
**Transition sequence (all times relative to entering post-success at T=0):**

| T (ms) | Action |
|---------|--------|
| 0 | `hideJoiningOverlay(true)` — restores paste input + steps, but `skipFocus=true` so input doesn't steal focus |
| 0 | `successToast.classList.add('visible')` — green toast appears (fixed top center) |
| 0 | Remove `highlight` from step 1, add `highlight` to step 2 |
| 300 | `promptStore.scrollIntoView({behavior:'smooth', block:'start'})` |
| 300 | `promptStore.classList.add('highlighted')` — orange flash animation |
| 300 | All `.ps-agent-row` elements get class `pulsing` — 3-cycle border pulse |
| 3000 | `successToast.classList.remove('visible')` — toast disappears |
| 5000 | All `.ps-agent-row` elements lose class `pulsing` |

**Note:** `hideJoiningOverlay(true)` normally resets steps to highlight step 1. But the post-success code immediately overrides this by removing step 1's highlight and adding step 2's. The net effect: step 2 is highlighted after this sequence.

### State: `error`

**Trigger:** Claim API returns non-ok, or fetch throws.
**DOM changes (via `showJoiningOverlay('error', ...)`):
- `joiningInline.className = 'joining-inline active error'`
- `joiningText.textContent = 'Couldn't reach your conversation'`
- `joiningSub.textContent = err.message || 'Check the link and try again'`
- `joiningDismiss.style.display = ''`
- `joiningDismiss.textContent = 'Try again'`
- `launching = false`

**CSS animations active:**
- `.joining-inline.error .joining-balloon-group`: `joining-error-droop` 1.2s forwards
- Balloon shadow changes to red tint
- Particles hidden
- Dismiss button: `joining-btn-in` 0.3s at 0.6s delay (slide up + fade in)

**Exit:** Click "Try again" → `hideJoiningOverlay()` → state `idle`

### State: `qr-modal`

**Trigger:** Claim returns `{joined: false, inviteUrl, agentName}` (non-join flow — instance launched, not joined to existing conversation).
**Transition:** `hideJoiningOverlay()` (→ idle), then immediately `showQr(agentName, inviteUrl)`.
- `launching = false`
- QR modal overlay becomes visible with agent name, QR image, invite URL

---

# State Machine: Pool Availability

```
refreshStatus() runs every 15000ms + on page load

if (launching) → skip visibility changes (prevent flash during join flow)

if (!launching && idle > 0):
  emptyState hidden, pasteView visible

if (!launching && idle === 0):
  emptyState visible, pasteView hidden
```

The `launching` flag is the critical guard. It's set to `true` when `handlePasteUrl` fires, and cleared:
- On success: 1800ms after entering `success` state (via separate setTimeout)
- On error: immediately
- On QR modal: immediately after `hideJoiningOverlay`

---

# State Machine: Step Highlights

```
States: step 1 highlighted | step 2 highlighted | step 3 highlighted

Transitions:
  Page load         → step 1
  hideJoiningOverlay → step 1 (always resets)
  post-success      → step 2 (overrides the reset from hideJoiningOverlay)
  copyToClipboard   → step 3 (only if step 2 is currently highlighted)
```

Steps are `.step` elements. The `highlight` class on a step:
- `.step.highlight .step-num`: background `#E54D00`, color `#fff`
- `.step.highlight .step-text`: color `#333`, font-weight `500`

---

# State Machine: Skill Browser

```
State: { category: string, search: string, expanded: boolean }
Defaults: { category: 'All', search: '', expanded: false }

Derived: filteredList = CATALOG
  .filter(a => category === 'All' || a.category === category)
  .filter(a => !search || a.name.includes(search) || a.description.includes(search))

Derived: shownList =
  if (search || category !== 'All' || expanded) → filteredList
  else → filteredList.slice(0, 10)

Derived: showMoreVisible =
  if (search || category !== 'All') → false
  if (!expanded && filteredList.length > 10) → true ("Show all N assistants")
  if (expanded) → true ("Show less")
  else → false

Events:
  search input change → search = value; re-render
  category pill click → category = pill.dataset.cat; re-render
  show more click → expanded = !expanded; re-render
  row click → open prompt modal
  View button click → open prompt modal
  Copy button click → fetch prompt, copy to clipboard
```

---

# State Machine: Prompt Modal

```
States: closed | loading | loaded | error | copy-feedback

Transitions:
  row click / View click → loading
    - modal overlay visible, body scroll locked
    - title = agent name
    - body = "Loading..."
    - copy button = "Copy full prompt"
    - fetch /api/prompts/:pageId

  fetch success → loaded
    - body = prompt text (pre-wrap)
    - copy button enabled

  fetch error → error
    - body = "Failed to load prompt. Try again later."
    - copy button disabled

  copy button click → copy-feedback
    - navigator.clipboard.writeText(prompt)
    - button text = "Copied!", class = "copied"
    - setTimeout 1500ms → button text = "Copy full prompt", class removed
    - step highlight: if step 2 active → advance to step 3

  ×/backdrop/Escape → closed
    - modal overlay hidden, body scroll unlocked
```

---

# State Machine: QR Modal

```
States: closed | open | copy-feedback

Transitions:
  showQr(name, url) → open
    - overlay visible
    - title = name
    - QR image src = api.qrserver.com/?size=240x240&data=url
    - QR link href = url
    - invite URL text = url

  invite row click → copy-feedback
    - navigator.clipboard.writeText(url)
    - row class = "copied", background = #D4EDDA
    - text = "Copied!", icon = checkmark
    - setTimeout 1500ms → reset to url text, copy icon, remove "copied" class

  backdrop click → closed
    - overlay hidden
```

---

# Milestone 1: Homepage Parity

## Task 0: Scaffold Next.js + Playwright screenshot tests

**Files:**
- Delete: `dashboard/src/` (empty dirs), `dashboard/node_modules/`
- Create: `dashboard/package.json`, `dashboard/tsconfig.json`, `dashboard/next.config.ts`, `dashboard/.gitignore`, `dashboard/.env.example`, `dashboard/.env.local`
- Create: `dashboard/src/app/layout.tsx`, `dashboard/src/app/globals.css`, `dashboard/src/app/page.tsx`
- Create: `dashboard/playwright.config.ts`, `dashboard/tests/parity.spec.ts`
- Create: `dashboard/tests/mock-pool.ts`, `dashboard/tests/helpers.ts`, `dashboard/tests/fixtures/catalog.json`

**Step 1: Remove old scaffolding**

```bash
rm -rf dashboard/src dashboard/node_modules
```

**Step 2: Install dependencies**

```bash
cd dashboard
pnpm init
pnpm add next@latest react@latest react-dom@latest
pnpm add -D typescript @types/react @types/react-dom @types/node @playwright/test
npx playwright install chromium
```

**Step 3: Create config files**

`dashboard/package.json` scripts:
```json
{
  "name": "convos-template-site",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test:parity": "playwright test"
  }
}
```

`dashboard/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

`dashboard/next.config.ts`:
```typescript
import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone" };
export default nextConfig;
```

`dashboard/.gitignore`:
```
node_modules/
.next/
out/
.env.local
test-results/
playwright-report/
screenshots/
```

`dashboard/.env.example` (template for new developers):
```bash
POOL_API_URL=http://localhost:3001
NEXT_PUBLIC_POOL_API_URL=http://localhost:3001
NEXT_PUBLIC_POOL_ENVIRONMENT=staging
POOL_API_KEY=<your-pool-api-key>
```

`dashboard/.env.local` (local dev against real Pool — gitignored):
```bash
POOL_API_URL=http://localhost:3001
NEXT_PUBLIC_POOL_API_URL=http://localhost:3001
NEXT_PUBLIC_POOL_ENVIRONMENT=staging
POOL_API_KEY=<your-pool-api-key>
```

**Note on test runs:** You do NOT need a separate `.env.test` file. The Playwright config overrides `POOL_API_URL` and `NEXT_PUBLIC_POOL_API_URL` via `process.env` before Next.js boots, which takes precedence over `.env.local`. Your `.env.local` pointing at real Pool on :3001 is harmlessly ignored during `pnpm test:parity`. See Migration Strategy section D for details.

**Step 4: Create Playwright config (with mock Pool server)**

`dashboard/playwright.config.ts` — starts mock-pool on :3002, then Next.js on :3000 pointed at the mock. See Migration Strategy section D for the full explanation of the env var override strategy.

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: [
    {
      command: "npx tsx tests/mock-pool.ts",
      port: 3002,
      reuseExistingServer: !process.env.CI,
      env: { ...process.env, MOCK_POOL_PORT: "3002" },
    },
    {
      command: "pnpm dev",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      // Spread process.env to keep PATH, HOME, etc.
      // POOL overrides land in process.env before Next.js boots,
      // taking precedence over any .env.local values.
      env: {
        ...process.env,
        POOL_API_URL: "http://localhost:3002",
        NEXT_PUBLIC_POOL_API_URL: "http://localhost:3002",
        POOL_API_KEY: "mock-key",
      },
    },
  ],
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } } },
    { name: "mobile", use: { viewport: { width: 375, height: 812 } } },
  ],
});
```

**Step 5: Create mock Pool server + test helper + fixtures**

Create `dashboard/tests/mock-pool.ts` with the implementation from section D of the Migration Strategy.

Create `dashboard/tests/helpers.ts`:
```typescript
const MOCK_POOL_URL = "http://localhost:3002";

export async function setMockState(state: string): Promise<void> {
  const res = await fetch(`${MOCK_POOL_URL}/_control/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) throw new Error(`Failed to set mock state: ${await res.text()}`);
}
```

Generate `dashboard/tests/fixtures/catalog.json` from a running Pool instance:
```bash
pnpm pool:dev &
sleep 3
curl http://localhost:3001/api/pool/templates | python3 -m json.tool > dashboard/tests/fixtures/catalog.json
kill %1
```

If Pool isn't available, manually transform `pool/src/agents-data.json` through the same slugify + category-rename logic. Include at least 15 agents spanning all categories.

**Step 6: Create parity test skeleton**

`dashboard/tests/parity.spec.ts`:
```typescript
import { test, expect } from "@playwright/test";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { setMockState } from "./helpers";

const POOL_URL = "http://localhost:3001";
const NEXT_URL = "http://localhost:3000";

// Screenshot states and the mock state each needs
const STATES = [
  { name: "idle", mockState: "idle", setup: async () => {} },
  { name: "empty", mockState: "empty", setup: async () => {} },
  // More states added as tasks progress — joining, success, post-success, error
  // require Playwright page interactions after setMockState
] as const;

test.describe("Visual parity", () => {
  test.beforeEach(async () => {
    // Reset to idle before each test
    await setMockState("idle");
  });

  test("idle state loads", async ({ page }) => {
    await setMockState("idle");
    await page.goto(NEXT_URL, { waitUntil: "networkidle" });
    // Verify paste input is visible (pool has idle instances)
    await expect(page.locator(".paste-input")).toBeVisible();
  });

  test("empty state shows balloon", async ({ page }) => {
    await setMockState("empty");
    await page.goto(NEXT_URL, { waitUntil: "networkidle" });
    // Verify empty state balloon is visible
    await expect(page.locator(".empty-state")).toBeVisible();
  });
});
```

Install test dependencies:
```bash
cd dashboard && pnpm add -D pngjs pixelmatch @types/pngjs tsx express @types/express
```

**Step 7: Create app shell**

`dashboard/src/app/globals.css`:
```css
/* Pool's CSS will be imported here in Task 1 */
```

`dashboard/src/app/layout.tsx`:
```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Convos Assistants",
  description: "AI assistants for your group chats",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
```

`dashboard/src/app/page.tsx` (placeholder):
```tsx
export default function Home() {
  return <main>placeholder</main>;
}
```

**Step 8: Verify**

```bash
cd dashboard && pnpm dev
```

Next.js starts at localhost:3000. Then verify the mock server works:

```bash
npx tsx dashboard/tests/mock-pool.ts &
sleep 1
curl http://localhost:3002/api/pool/counts                # { idle: 3, ... }
curl -X POST http://localhost:3002/_control/state \
  -H 'Content-Type: application/json' -d '{"state":"empty"}'
curl http://localhost:3002/api/pool/counts                # { idle: 0, ... }
kill %1
```

**Step 9: Commit**

```bash
git add dashboard/
git commit -m "scaffold: Next.js app with Playwright screenshot testing and mock Pool server"
```

---

## Task 1: Extract CSS + API client + Pool endpoints

**Why:** Extract the exact CSS from `pool/src/index.js` into a standalone file. Build the API client. Add Pool endpoints for the template catalog.

**Files:**
- Create: `dashboard/src/app/pool.css` — extracted verbatim from Pool's inline CSS
- Create: `dashboard/src/lib/types.ts`
- Create: `dashboard/src/lib/api.ts`
- Modify: `pool/src/index.js` — add template endpoints + CORS

**Step 1: Extract CSS**

Open `pool/src/index.js`. The CSS lives inside the template literal between `<style>` and `</style>` tags (lines ~127–1575). Extract **every line** of CSS between those tags into `dashboard/src/app/pool.css`. Do not modify any values. Do not rename any classes.

**Important exclusions:** Skip CSS that's only used by dev-dashboard elements (classes prefixed with `.dev-bar`, `.agents-dropdown`, `.dropdown-*`, `.agent-card`, `.agent-btn`, `.agent-name`, `.agent-meta`, `.agent-uptime`, `.agent-status-badge`, `.agent-actions`, `.agent-top`, `.field-group`, `.field-label`, `.field-input`, `.field-hint`, `.field-error`, `.template-row`, `.template-pill`, `.template-soon`, `.btn-launch`, `.footer-note`). These are dev-overlay-only styles.

**Include everything else:** `*` reset, `body`, `.form-wrapper`, `.form-center`, `.brand`, `.brand-icon`, `.brand-name`, `.page-title`, `.page-subtitle`, `.paste-input-wrap`, `.paste-input`, `.paste-input-label`, `.paste-error`, `.paste-hint`, `.steps`, `.step`, `.step-num`, `.step-text`, `.stories`, `.story-label`, `.story-text`, `.get-convos`, `.get-convos-*`, `.empty-state`, `.empty-scene`, `.empty-balloon-*`, `.balloon-string-*`, all `@keyframes` for balloons/strings, `.joining-inline`, `.joining-scene`, `.joining-balloon-*`, `.joining-string-*`, `.joining-particle`, all `@keyframes joining-*`, `.joining-confetti`, `.joining-confetti-piece`, `.joining-status-text`, `.joining-status-sub`, `.joining-dismiss-btn`, `.success-toast`, `.step.highlight`, `.ps-agent-row.pulsing`, `.prompt-store.highlighted`, all `@media (prefers-reduced-motion)` rules, `.error-message`, `.success-banner`, `.modal-overlay`, `.modal`, `.qr-wrap`, `.invite-row`, `.invite-url`, `.copy-icon`, `.prompt-store`, `.ps-*` (all prompt store classes), responsive `@media` rules for these classes.

Then import it in `dashboard/src/app/globals.css`:
```css
@import "./pool.css";
```

**Step 2: Create types**

`dashboard/src/lib/types.ts`:
```typescript
export interface AgentSkill {
  slug: string;
  name: string;
  description: string;
  category: string;
  emoji: string;
  skills: string[];
  status: string;
  notionPageId: string | null;
}

export interface PoolCounts {
  idle: number;
  starting: number;
  claimed: number;
  crashed: number;
}

export interface PromptData {
  prompt: string;
}

export interface ClaimResponse {
  joined?: boolean;
  inviteUrl?: string;
  agentName?: string;
  instanceId?: string;
  error?: string;
}
```

**Step 3: Create API client**

`dashboard/src/lib/api.ts`:
```typescript
import type { AgentSkill, PoolCounts, PromptData } from "./types";

const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

export async function getSkills(): Promise<AgentSkill[]> {
  const res = await fetch(`${POOL_API_URL}/api/pool/templates`, {
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Failed to fetch templates: ${res.status}`);
  return res.json();
}

export async function getSkill(slug: string): Promise<AgentSkill | null> {
  const res = await fetch(`${POOL_API_URL}/api/pool/templates/${encodeURIComponent(slug)}`, {
    next: { revalidate: 60 },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to fetch template: ${res.status}`);
  return res.json();
}

export async function getPoolCounts(): Promise<PoolCounts> {
  const res = await fetch(`${POOL_API_URL}/api/pool/counts`, {
    next: { revalidate: 10 },
  });
  if (!res.ok) throw new Error(`Failed to fetch counts: ${res.status}`);
  return res.json();
}

export async function getPrompt(pageId: string): Promise<PromptData> {
  const res = await fetch(`${POOL_API_URL}/api/prompts/${pageId}`, {
    next: { revalidate: 300 },
  });
  if (!res.ok) throw new Error(`Failed to fetch prompt: ${res.status}`);
  return res.json();
}
```

**Step 4: Add Pool endpoints + CORS**

Add to `pool/src/index.js` — slugify helper, AGENT_CATALOG, template endpoints, and CORS middleware. See the state machine section's "Data sources" for the exact endpoint contracts. The implementation is:

After `AGENT_CATALOG_JSON` (line ~48):
```javascript
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const AGENT_CATALOG = (() => {
  try {
    const catalogPath = resolve(__dirname, "agents-data.json");
    const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
    return raw.filter((a) => a.name).map((a) => {
      const url = a.subPageUrl || "";
      const m = url.match(/([a-f0-9]{32})/);
      const catParts = (a.category || "").split(" — ");
      const emoji = catParts[0].trim().split(" ")[0];
      let catName = catParts[0].trim().replace(/^\S+\s/, "").replace(/\s*&\s*.+$/, "");
      if (catName === "Superpower Agents") catName = "Superpowers";
      if (catName === "Neighborhood") catName = "Local";
      if (catName === "Professional") catName = "Work";
      return {
        slug: slugify(a.name), name: a.name, description: a.description,
        category: catName, emoji, skills: a.skills || [], status: a.status,
        notionPageId: m ? m[1] : null,
      };
    });
  } catch (e) {
    console.warn("[pool] Could not load agents catalog:", e.message);
    return [];
  }
})();
```

After `app.use(express.json())`:
```javascript
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allowed = (process.env.TEMPLATE_SITE_ORIGINS || "http://localhost:3000").split(",").map((u) => u.trim());
  if (allowed.some((u) => origin.startsWith(u))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
```

After `/api/pool/agents`:
```javascript
app.get("/api/pool/templates", (_req, res) => { res.json(AGENT_CATALOG); });
app.get("/api/pool/templates/:slug", (req, res) => {
  const t = AGENT_CATALOG.find((a) => a.slug === req.params.slug);
  if (!t) return res.status(404).json({ error: "Template not found" });
  res.json(t);
});
```

**Step 5: Create Next.js API proxies**

`dashboard/src/app/api/claim/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";
const POOL_API_KEY = process.env.POOL_API_KEY || "";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const res = await fetch(`${POOL_API_URL}/api/pool/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${POOL_API_KEY}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

`dashboard/src/app/api/prompts/[pageId]/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
const POOL_API_URL = process.env.POOL_API_URL || "http://localhost:3001";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ pageId: string }> }) {
  const { pageId } = await params;
  if (!/^[a-f0-9]{32}$/.test(pageId)) return NextResponse.json({ error: "Invalid page ID" }, { status: 400 });
  const res = await fetch(`${POOL_API_URL}/api/prompts/${pageId}`);
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
```

**Step 6: Verify**

```bash
pnpm pool:dev
curl http://localhost:3001/api/pool/templates | python3 -m json.tool | head -20
curl http://localhost:3001/api/pool/templates/the-racket-club-manager
```

**Step 7: Commit**

```bash
git add dashboard/src/ pool/src/index.js
git commit -m "feat: extract Pool CSS, add API client, template endpoints, CORS"
```

---

## Task 2: Static layout (same HTML structure as original)

**Why:** Build the page frame using the **exact same HTML structure and class names** as the original so that `pool.css` applies correctly.

**Files:**
- Modify: `dashboard/src/app/page.tsx`
- Create: `dashboard/src/components/convos-logo.tsx`

**Implementation:** The React component tree must produce HTML that, when rendered, has the same DOM structure and class names as the original. Study `pool/src/index.js:1619-1758` for the exact HTML.

The page component renders:
```html
<div class="form-wrapper">
  <div class="form-center">
    <div class="brand">...</div>
    <h1 class="page-title">...</h1>
    <p class="page-subtitle">...</p>
    <!-- empty-state div (Task 3) -->
    <!-- paste-view div (Task 3) -->
    <div class="get-convos">...</div>
    <div class="stories">...</div>
    <!-- prompt-store div (Task 4) -->
    <!-- modals (Task 5) -->
  </div>
</div>
```

Every class name must match `pool.css`. Use `className="form-wrapper"`, not Tailwind utilities.

The Convos logo SVG is used in multiple places — extract it to `convos-logo.tsx` with a `size` prop.

**Step 1:** Build the server component with brand, hero, steps, Get Convos strip, and stories using the exact class names from the original HTML (lines 1619–1758). Leave placeholder `<div>` elements for the interactive sections (paste-view, prompt-store, modals).

**Step 2:** Add the steps section (lines 1723–1736) with the same `.step`, `.step-num`, `.step-text` classes. First step gets `className="step highlight"`.

**Verify — screenshot diff:** Capture `idle` state (just the static content). Compare layout, typography, spacing against the original. At this stage, paste input and skill browser are missing, so diff will be partial. Visual check: brand, title, subtitle, steps, Get Convos, stories should match pixel-for-pixel.

**Commit:**

```bash
git add dashboard/src/
git commit -m "feat: static page layout matching original HTML structure"
```

---

## Task 3: Paste input + empty state + joining animation

**Why:** The core interaction. Implement the Join Flow state machine exactly as specified above.

**Files:**
- Create: `dashboard/src/components/join-flow.tsx` — the orchestrating client component
- Create: `dashboard/src/components/balloon-scene.tsx` — shared balloon SVG + strings
- Modify: `dashboard/src/app/page.tsx` — wire it in

**Implementation:**

This is one client component (`"use client"`) that manages the entire Join Flow state machine. It renders:

```html
<div id="paste-view">
  <div class="success-toast" id="success-toast" aria-live="polite">...</div>
  <div class="paste-input-wrap" id="paste-input-wrap">
    <input class="paste-input" id="paste-input" ... />
    <span class="paste-input-label">...</span>
    <div class="paste-error" id="paste-error">...</div>
    <div class="paste-hint">...</div>
  </div>
  <div class="joining-inline" id="joining-inline" aria-live="polite">
    <div class="joining-scene">
      <!-- 6 particles -->
      <div class="joining-balloon-group">
        <!-- balloon SVG 72x92 -->
        <!-- upper string -->
        <!-- lower string -->
      </div>
      <div class="joining-confetti" id="joining-confetti">
        <!-- 8 static pieces + 20 dynamic on success -->
      </div>
    </div>
    <div class="joining-status-text" id="joining-text">...</div>
    <div class="joining-status-sub" id="joining-sub">...</div>
    <button class="joining-dismiss-btn" id="joining-dismiss">...</button>
  </div>
  <div class="steps" id="joining-steps">
    <div class="step highlight">...</div>
    <div class="step">...</div>
    <div class="step">...</div>
  </div>
</div>
```

And separately, the empty state:

```html
<div class="empty-state" id="empty-state">
  <div class="empty-scene">
    <div class="empty-balloon-group">
      <!-- balloon SVG 64x82 -->
      <!-- upper string + lower string -->
    </div>
  </div>
  <div class="empty-text">Hang in there</div>
  <div class="empty-sub">No assistants available right now.<br>Check back a little later.</div>
</div>
```

**React state mapping:**

```typescript
type JoinState = "idle" | "joining" | "success" | "post-success" | "error";

const [joinState, setJoinState] = useState<JoinState>("idle");
const [available, setAvailable] = useState(true); // idle > 0
const [launching, setLaunching] = useState(false);
const [errorMsg, setErrorMsg] = useState("");
const [inputValue, setInputValue] = useState("");
const [inputError, setInputError] = useState<string | null>(null);
const [toastVisible, setToastVisible] = useState(false);
const [activeStep, setActiveStep] = useState(1); // 1, 2, or 3
const [confettiPieces, setConfettiPieces] = useState<ConfettiPiece[]>([]);

const joiningAutoHideTimer = useRef<NodeJS.Timeout | null>(null);
```

**Transition implementations** (follow the state machine spec exactly):

`handlePasteUrl(url)`:
1. Validate URL (same regex as original: `popup.convos.org/v2?`, `dev.convos.org/v2?`, `convos.app/join/`, `convos://join/`, bare slugs >20 chars). Env-aware check (prod URLs on dev = error, dev URLs on prod = error, using `NEXT_PUBLIC_POOL_ENVIRONMENT`).
2. If invalid: set `inputError`, add `invalid` class to input. Return.
3. Set `launching = true`, `joinState = 'joining'`, `inputValue = ''`.
4. Fetch `POST /api/claim` (the Next.js proxy, not Pool directly).
5. On success with `joined: true`: set `joinState = 'success'`, generate confetti pieces, start 1500ms timer.
6. On success with `joined: false`: call `hideJoiningOverlay()`, open QR modal with `agentName` and `inviteUrl`.
7. On error: set `joinState = 'error'`, `errorMsg = message`.

Post-success timer chain (follow the exact millisecond spec from the state machine):
```typescript
// T=0: dismiss overlay, show toast, highlight step 2
setJoinState("idle");
setToastVisible(true);
setActiveStep(2);

// T=300: scroll to skills, flash + pulse
setTimeout(() => {
  skillBrowserRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  skillBrowserRef.current?.classList.add("highlighted");
  skillBrowserRef.current?.querySelectorAll(".ps-agent-row").forEach(r => r.classList.add("pulsing"));
}, 300);

// T=3000: hide toast
setTimeout(() => setToastVisible(false), 3000);

// T=5000: remove pulses
setTimeout(() => {
  skillBrowserRef.current?.querySelectorAll(".ps-agent-row.pulsing").forEach(r => r.classList.remove("pulsing"));
}, 5000);
```

**Note on the `launching` guard:** Set a separate 1800ms timer on success: `setTimeout(() => { setLaunching(false) }, 1800)`. The pool counts polling (useEffect with 15s interval) checks `launching` before toggling availability.

**Pool availability polling:**

```typescript
useEffect(() => {
  const poll = async () => {
    try {
      const res = await fetch(`${poolApiUrl}/api/pool/counts`);
      const counts = await res.json();
      if (!launching) setAvailable(counts.idle > 0);
    } catch {}
  };
  poll();
  const interval = setInterval(poll, 15000);
  return () => clearInterval(interval);
}, [launching, poolApiUrl]);
```

**Visibility logic** (maps `available` and `joinState` to DOM display):
- `empty-state`: `style={{ display: !available && joinState === 'idle' ? 'block' : 'none' }}`
- `paste-view`: `style={{ display: available || joinState !== 'idle' ? '' : 'none' }}`
- `paste-input-wrap`: `style={{ display: joinState === 'idle' ? '' : 'none' }}`
- `joining-steps`: `style={{ display: joinState === 'idle' ? '' : 'none' }}`
- `joining-inline`: `className={joinState !== 'idle' ? 'joining-inline active ' + joinState : 'joining-inline'}`

**Step highlighting** — the steps render with:
```tsx
<div className={`step${activeStep === i + 1 ? " highlight" : ""}`}>
```

**The `activeStep` prop/callback must be accessible from the skill browser** (Task 4) so that copy-to-clipboard can advance from 2→3. Pass it via React context or a callback prop.

**Verify — screenshot diff:**
- `idle`: paste input visible, step 1 highlighted
- `empty`: sad balloon with "Hang in there"
- `joining`: balloon inflating (capture at ~1s after trigger)
- `success`: confetti rain (capture at ~0.5s after success)
- `error`: drooped balloon, "Try again" visible
- `post-success`: toast visible, step 2 highlighted

**Commit:**

```bash
git add dashboard/src/
git commit -m "feat: join flow with paste input, balloon animation, empty state, success toast"
```

---

## Task 4: Skill browser

**Why:** The searchable, filterable catalog with category pills, show more/less, and copy-to-clipboard. Implement the Skill Browser state machine exactly.

**Files:**
- Create: `dashboard/src/components/skill-browser.tsx`
- Modify: `dashboard/src/app/page.tsx` — add it below stories

**Implementation:**

Client component rendering with the exact same HTML structure and class names as the original (study `pool/src/index.js:1760-1773` for the HTML and `pool/src/index.js:2383-2575` for the JS).

```html
<div class="prompt-store" id="prompt-store">
  <div class="ps-header"><span class="ps-title">Try out assistant skills</span></div>
  <p class="ps-intro">Copy any of our 89 favorite skills...</p>
  <div class="ps-search-wrap">
    <span class="ps-search-icon"><!-- search SVG --></span>
    <input class="ps-search" placeholder="Search assistants..." />
  </div>
  <div class="ps-filters" id="ps-filters">
    <button class="ps-filter-pill active" data-cat="All">All</button>
    <button class="ps-filter-pill" data-cat="Sports">🎾 Sports</button>
    ...
  </div>
  <div class="ps-no-results" style="display:none">No assistants match your search</div>
  <div class="ps-list" id="ps-list">
    <div class="ps-cat-header">🎾 Sports</div>
    <div class="ps-agent-row" data-pid="..." data-name="...">
      <div class="ps-agent-info">
        <div class="ps-agent-name">The Racket Club Manager</div>
        <div class="ps-agent-desc">Coordinates padel/tennis/pickleball...</div>
      </div>
      <div class="ps-agent-actions">
        <button class="ps-btn ps-view-btn">View</button>
        <button class="ps-btn primary ps-copy-btn">Copy</button>
      </div>
    </div>
    ...
  </div>
  <button class="ps-show-more">Show all 89 assistants</button>
</div>
```

**Props:** `skills: AgentSkill[]`, `onOpenModal: (pageId, name) => void`, `activeStep: number`, `setActiveStep: (n: number) => void`, and a forwarded ref for scroll-to and pulse.

**Copy button behavior:**
1. Set button text to `...`, add `loading` class.
2. Fetch `/api/prompts/${pageId}` (the Next.js proxy).
3. On success: `navigator.clipboard.writeText(prompt)`, button text = `Copied!`, add `copied` class.
4. After 1500ms: reset button text to `Copy`, remove `copied` class.
5. If `activeStep === 2`: set `activeStep(3)`.
6. On error: button text = `Error`, reset after 1500ms.

**Only show agents with a `notionPageId`** (they have viewable/copyable prompts). This matches the original which only renders View/Copy buttons when `a.p` is truthy.

**Verify — screenshot diff:**
- `skill-browser-default`: 10 items shown, "Show all" button visible
- `skill-browser-expanded`: all items shown, "Show less" button visible
- `skill-browser-filtered`: select "Sports" category, only sports agents shown
- `skill-browser-search`: type "golf", only matching agents shown

**Commit:**

```bash
git add dashboard/src/
git commit -m "feat: skill browser with search, filters, show more, copy"
```

---

## Task 5: Prompt modal + QR modal

**Why:** Two modals. Implement the Prompt Modal and QR Modal state machines exactly.

**Files:**
- Create: `dashboard/src/components/prompt-modal.tsx`
- Create: `dashboard/src/components/qr-modal.tsx`
- Modify: `dashboard/src/app/page.tsx` — add modals and wire callbacks

**Implementation:**

Both modals use the exact class names from `pool.css`.

Prompt modal HTML structure:
```html
<div class="ps-modal-overlay [open]" id="ps-modal">
  <div class="ps-modal">
    <div class="ps-modal-head">
      <span class="ps-modal-title">Agent Name</span>
      <button class="ps-modal-close">&times;</button>
    </div>
    <div class="ps-modal-body">
      <div class="ps-modal-text">Loading...</div>
    </div>
    <div class="ps-modal-footer">
      <button class="ps-modal-copy">Copy full prompt</button>
    </div>
  </div>
</div>
```

QR modal HTML structure:
```html
<div class="modal-overlay [active]" id="qr-modal">
  <div class="modal">
    <h3>Agent Name</h3>
    <a class="qr-wrap" href="..." target="_blank">
      <img alt="Scan to connect" />
      <div class="icon-center"><!-- Convos logo SVG --></div>
    </a>
    <div class="invite-row" title="Click to copy">
      <span class="invite-url">https://...</span>
      <span class="copy-icon"><!-- copy SVG --></span>
    </div>
  </div>
</div>
```

Follow each state machine transition exactly. Prompt modal: `document.body.style.overflow = 'hidden'` when open, `''` when closed. Close on Escape (document keydown listener).

**Verify — screenshot diff:**
- `prompt-modal`: open with a specific agent, loading state + loaded state
- `qr-modal`: open with a mock invite URL

**Commit:**

```bash
git add dashboard/src/
git commit -m "feat: prompt modal and QR modal"
```

---

## Task 6: Responsive + reduced motion

**Why:** The original has specific `@media` breakpoints and `prefers-reduced-motion` overrides. These are already in `pool.css` from the extraction in Task 1, but verify they apply correctly to the React components.

**Files:**
- Modify: `dashboard/src/app/pool.css` — verify all responsive/motion rules are present
- Modify: components as needed for any missing responsive behavior

**Verify — screenshot diff at both viewports (1280×800 and 375×812):**
- All 12 states from the screenshot matrix
- Mobile: stories stacked, filter pills scrollable, modal full-width
- Reduced motion (via Playwright `page.emulateMedia({ reducedMotion: 'reduce' })`): no animations, static states

**Commit:**

```bash
git add dashboard/src/
git commit -m "feat: responsive layout and reduced-motion parity"
```

---

## Task 7: Full parity verification + Pool cleanup

**Why:** Run the complete screenshot diff suite. Fix any remaining discrepancies. Strip user-facing HTML from Pool.

**Files:**
- Modify: `dashboard/tests/parity.spec.ts` — implement all 12 states
- Modify: `pool/src/index.js` — move homepage to `/dashboard`, redirect `/`
- Modify: root `package.json` — add dashboard scripts

**Step 1: Implement the full screenshot test suite**

For each of the 12 states in the screenshot matrix, the test:
1. Calls `setMockState(state)` to configure the mock Pool server for that state
2. Navigates to the Next.js URL, triggers any required user interactions (paste, click, wait for animation)
3. Captures screenshot
4. Navigates to the real Pool URL (running on :3001), triggers the same interactions
5. Captures screenshot
6. Diffs. Fails if > 0.5%.

**How each state is triggered:**

| State | Mock state | Playwright interaction after page load |
|-------|-----------|----------------------------------------|
| `idle` | `idle` | None — capture immediately after `networkidle` |
| `empty` | `empty` | None — capture immediately (balloon visible) |
| `joining` | `success` | Paste URL into `.paste-input`, press Enter, capture during animation (wait 500ms) |
| `success` | `success` | Paste URL, wait 1000ms (confetti visible) |
| `post-success` | `success` | Paste URL, wait 2500ms (toast visible, skills scrolled) |
| `error` | `error` | Paste URL, wait 1500ms (droop + "Try again" visible) |
| `skill-browser-default` | `idle` | Scroll to `.prompt-store` |
| `skill-browser-expanded` | `idle` | Click "Show all", wait for render |
| `skill-browser-filtered` | `idle` | Click a category pill |
| `skill-browser-search` | `idle` | Type into search input |
| `prompt-modal` | `idle` | Click "View" on a skill row |
| `qr-modal` | `qr-modal` | Paste URL, wait 2000ms (QR modal opens) |

**Important:** For the Pool-side screenshots (comparison baseline), Pool runs on :3001 as the real server — no mocking needed since it's the source of truth. The mock server is only used by the Next.js side. For states like `empty` and `error` on the Pool side, use `page.route()` to intercept the Pool page's own client-side fetches (this works because those are browser-initiated requests from the Pool HTML page, not server-side calls).

**Step 2: Run tests, fix discrepancies**

```bash
cd dashboard && pnpm test:parity
```

Iterate until all states pass at both viewports.

**Step 3: Move Pool homepage to `/dashboard`**

Change `app.get("/", ...)` to `app.get("/dashboard", ...)` in `pool/src/index.js`.

Add new root:
```javascript
app.get("/", (_req, res) => {
  res.redirect(302, process.env.TEMPLATE_SITE_URL || "https://assistants.convos.org");
});
```

**Step 4: Add root scripts**

```json
{
  "scripts": {
    "pool": "node pool/src/index.js",
    "pool:dev": "node --env-file=pool/.env --watch pool/src/index.js",
    "pool:test": "node --env-file=pool/.env --test pool/src/**/*.test.js",
    "pool:db:migrate": "node --env-file=pool/.env pool/src/db/migrate.js",
    "dashboard:dev": "cd dashboard && pnpm dev",
    "dashboard:build": "cd dashboard && pnpm build",
    "dashboard:test:parity": "cd dashboard && pnpm test:parity"
  }
}
```

**Step 5: Verify Pool still works**

```bash
pnpm pool:dev
curl -I http://localhost:3001/       # 302 redirect
curl http://localhost:3001/dashboard  # dev dashboard HTML
curl http://localhost:3001/api/pool/counts  # JSON
```

**Step 6: Commit**

```bash
git add dashboard/ pool/src/index.js package.json
git commit -m "milestone: homepage parity verified, Pool root redirects to template site"
```

---

# Milestone 2: Template Pages + Viral Loop

> After Milestone 1, parity is proven. Now add the new pages.

---

## Task 8: `/a/:slug` template page with SSR + OG tags

Create `dashboard/src/app/a/[slug]/page.tsx`. SSR page with `generateMetadata` returning `og:title`, `og:description`, `og:image`. Page content: emoji, agent name, description, skills, "Add to group chat" button, "Copy prompt" button, QR code, category. `notFound()` for bad slugs. These pages use Tailwind (not `pool.css`) since they're new UI with no parity requirement.

**Commit:** `feat: add template page with SSR and OG meta tags`

---

## Task 9: `/og/:slug` OG image generation

```bash
cd dashboard && pnpm add @vercel/og
```

Create `dashboard/src/app/og/[slug]/route.tsx`. Uses `ImageResponse` from `@vercel/og` (Satori). 1200×630 PNG. Layout: Convos branding, emoji, agent name, truncated description, "Add to your group chat" CTA, QR code from external API, "No sign up required."

**Commit:** `feat: add dynamic OG image generation`

---

## Task 10: `/qr/:slug` QR code generation

```bash
cd dashboard && pnpm add qrcode && pnpm add -D @types/qrcode
```

Create `dashboard/src/app/qr/[slug]/route.ts`. Generates 400px PNG QR code encoding the template page URL. Returns with 24h cache headers.

**Commit:** `feat: add QR code generation route`

---

## Task 11: Deployment configuration

Create `dashboard/vercel.json` and `dashboard/Dockerfile` (for Railway alternative). Both configs documented in the original plan revision. Verify `pnpm dashboard:build` succeeds.

**Commit:** `feat: add deployment config for template site`

---

## What's NOT in this plan

- **Tweet-to-agent flow** — the viral loop entry point is a separate system
- **Claim flow on template pages** — "Add to group chat" on `/a/:slug` needs auth decisions for unauthenticated users
- **Phase 6 integration** — when `agent_templates` DB table lands, Pool endpoints switch from JSON to DB; template site doesn't change
- **Tailwind conversion** — converting `pool.css` to Tailwind utility classes is optional post-parity work, protected by screenshot tests
- **Homepage redesign** — post-parity, the homepage can evolve independently
