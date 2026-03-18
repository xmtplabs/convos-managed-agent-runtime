# Hermes Eval Production Fidelity

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Hermes eval suite test the production agent code path — same CLI, same skills, same toolsets, same platform prompt — by removing the `eval-chat.py` custom entrypoint, fixing the broken env setup, and extracting the Convos platform prompt to a shared file.

**Architecture:** Add PATH and `HERMES_EVAL_LOCAL_SERVICES` to `env.sh`'s hermes block (two lines — no sourcing of `eval-env.sh` from the parent process). The `bin/hermes` wrapper continues to source `eval-env.sh` at exec time for isolation (HOME override, workspace copy). Remove the wrapper's interception of `-q` mode so the standard hermes CLI handles eval queries. Delete `eval-chat.py` and `run-evals.sh`. The `hermes.mjs` adapter computes its own `HERMES_HOME` default for memory operations. Extract `CONVOS_EPHEMERAL_PROMPT` from `agent_runner.py` to `workspace/CONVOS_PROMPT.md` so both the production server and the eval CLI read the same file. Move `HERMES_EPHEMERAL_SYSTEM_PROMPT` out of `eval-env.sh` into the `async.yaml` suite — the only suite that needs it.

**Tech Stack:** Shell (env.sh, eval-env.sh, bin/hermes), Node.js (hermes.mjs adapter), Python (agent_runner.py, standard hermes CLI)

---

## File Map

- Modify: `runtime/evals/runtimes/env.sh` — add PATH and HERMES_EVAL_LOCAL_SERVICES to hermes block
- Modify: `runtime/hermes/scripts/eval-env.sh` — remove `set -e`, add AGENTS.md copy, fix REPO_ROOT, remove HERMES_EPHEMERAL_SYSTEM_PROMPT
- Modify: `runtime/hermes/bin/hermes` — remove eval-chat.py interception, use standard CLI
- Modify: `runtime/evals/runtimes/hermes.mjs` — compute HERMES_HOME default, extend filterLines
- Create: `runtime/hermes/workspace/CONVOS_PROMPT.md` — Convos platform prompt (extracted from agent_runner.py)
- Modify: `runtime/hermes/src/agent_runner.py` — read CONVOS_PROMPT.md from disk instead of hardcoded constant
- No change: `runtime/evals/suites/async.yaml` — no bail-out prompt; Hermes should delegate natively like OpenClaw does
- Delete: `runtime/hermes/scripts/eval-chat.py`
- Delete: `runtime/hermes/scripts/run-evals.sh`

---

## Chunk 1: Fix eval-env.sh and env.sh

### Task 1: Harden eval-env.sh for sourcing

**Files:**
- Modify: `runtime/hermes/scripts/eval-env.sh`

`eval-env.sh` is sourced by `bin/hermes` before exec-ing into the agent. It currently has issues that need fixing before we rely on it as the sole setup path.

- [ ] **Step 1: Remove `set -e` from eval-env.sh**

`set -e` is dangerous in a sourced script — it propagates to the caller and can abort on any non-zero exit in compound `&&`/`||` chains. Remove line 2 (`set -e`).

- [ ] **Step 2: Fix REPO_ROOT computation**

Line 13 computes `REPO_ROOT` as `$RUNTIME_DIR/..` which gives `runtime/` (one level short). Change to:

```sh
REPO_ROOT="$(cd "$RUNTIME_DIR/../.." && pwd)"
```

Path trace after fix:
- `SCRIPT_DIR` = `runtime/hermes/scripts`
- `RUNTIME_DIR` = `runtime/hermes`
- `REPO_ROOT` = repo root (parent of `runtime/`)
- `$REPO_ROOT/runtime/.env` → correctly sources `runtime/.env`

- [ ] **Step 3: Add AGENTS.md copy**

The standard hermes CLI loads `AGENTS.md` from the working directory. `eval-env.sh` sets `HOME` to the eval-home but never copies `AGENTS.md` there. `eval-chat.py` was injecting AGENTS.md content via the ephemeral prompt — once we delete it, AGENTS.md must be present on disk.

Add after the skill-copy loop (after line 30):

```sh
# Copy AGENTS.md to eval HOME root (hermes loads it from cwd)
[ -f "$RUNTIME_DIR/workspace/AGENTS.md" ] && cp "$RUNTIME_DIR/workspace/AGENTS.md" "$HOME/AGENTS.md"
```

Note: The standard CLI loads AGENTS.md from cwd. The `bin/hermes` wrapper doesn't `cd` anywhere, so cwd is whatever promptfoo's `execFileSync` inherits (typically `runtime/`). To guarantee AGENTS.md is found, we copy it to `$HOME` and will set cwd in the adapter (Task 4). Alternatively, `eval-env.sh` could copy it to the cwd, but the cwd isn't guaranteed. The safest option is to copy it to `$HOME` and have the adapter `cd` to `$HOME` before invoking hermes.

- [ ] **Step 4: Verify eval-env.sh works standalone**

```bash
cd runtime/hermes/scripts && sh -c '. ./eval-env.sh && echo "OK: HERMES_HOME=$HERMES_HOME" && echo "REPO_ROOT=$REPO_ROOT" && ls "$REPO_ROOT/runtime/.env" 2>/dev/null && echo "runtime/.env found" && ls "$HOME/AGENTS.md" 2>/dev/null && echo "AGENTS.md found"'
```

Expected: HERMES_HOME points to eval-home, REPO_ROOT is the actual repo root, both files found.

- [ ] **Step 5: Remove HERMES_EPHEMERAL_SYSTEM_PROMPT from eval-env.sh**

The async delegation prompt (`"For long multi-step research... reply with one short sentence..."`) is currently set as a default for ALL suites via eval-env.sh. This is eval-specific behavior that only the `async` suite needs. Remove lines 33-34:

```sh
# DELETE these lines:
: "${HERMES_EPHEMERAL_SYSTEM_PROMPT:=For long multi-step research...}"
export HERMES_EPHEMERAL_SYSTEM_PROMPT
```

This will be moved to `async.yaml` in Task 7 so it only applies where needed. All other suites run without an ephemeral prompt — matching production.

- [ ] **Step 6: Verify eval-env.sh works standalone**

```bash
cd runtime/hermes/scripts && sh -c '. ./eval-env.sh && echo "OK: HERMES_HOME=$HERMES_HOME" && echo "REPO_ROOT=$REPO_ROOT" && ls "$REPO_ROOT/runtime/.env" 2>/dev/null && echo "runtime/.env found" && ls "$HOME/AGENTS.md" 2>/dev/null && echo "AGENTS.md found" && echo "EPHEMERAL=${HERMES_EPHEMERAL_SYSTEM_PROMPT:-unset}"'
```

Expected: HERMES_HOME points to eval-home, REPO_ROOT is the actual repo root, both files found, EPHEMERAL=unset.

- [ ] **Step 7: Commit**

```bash
git add runtime/hermes/scripts/eval-env.sh
git commit -m "fix(eval-env): remove set -e, fix REPO_ROOT, copy AGENTS.md, remove ephemeral prompt

- Remove set -e: dangerous when sourced, propagates to caller
- Fix REPO_ROOT: was one level short (runtime/ not repo root),
  causing runtime/.env to be silently skipped
- Copy AGENTS.md to eval HOME: the standard CLI loads it from cwd,
  and eval-chat.py was injecting it via ephemeral prompt. Without
  eval-chat.py, it must be present on disk.
- Remove HERMES_EPHEMERAL_SYSTEM_PROMPT: moved to async.yaml
  so it only applies to the async suite, not all suites."
```

### Task 2: Add PATH and local services to env.sh hermes block

**Files:**
- Modify: `runtime/evals/runtimes/env.sh:20-29`

The hermes block currently only loads `.env` files and checks `OPENCLAW_GATEWAY_TOKEN`. It needs two additions so the project hermes wrapper takes priority over the system binary and local services are enabled.

**Why NOT source eval-env.sh here:** `eval-env.sh` overrides `HOME`, runs `set -e` (now removed but still), uses `$0` for path resolution (breaks under dash when sourced from a different script), and does filesystem operations (mkdir, cp). These side effects are safe inside `bin/hermes` (which immediately exec's) but unsafe in the parent promptfoo process. Keep env.sh minimal.

- [ ] **Step 1: Add PATH and HERMES_EVAL_LOCAL_SERVICES to the hermes block**

Add two lines after the `.env` sourcing, before the `OPENCLAW_GATEWAY_TOKEN` check:

```sh
  hermes)
    _ENV_HERMES_DIR="$_ENV_REPO_ROOT/runtime/hermes"
    [ -f "$_ENV_HERMES_DIR/.env" ] && set -a && . "$_ENV_HERMES_DIR/.env" 2>/dev/null || true && set +a
    [ -f "$_ENV_RUNTIME_DIR/.env" ] && set -a && . "$_ENV_RUNTIME_DIR/.env" 2>/dev/null || true && set +a
    export PATH="$_ENV_HERMES_DIR/bin:$PATH"
    export HERMES_EVAL_LOCAL_SERVICES="${HERMES_EVAL_LOCAL_SERVICES:-1}"
    if [ -z "$OPENCLAW_GATEWAY_TOKEN" ]; then
      echo "Error: OPENCLAW_GATEWAY_TOKEN must be set in runtime/hermes/.env" >&2
      exit 1
    fi
    ;;
```

What this does:
- `PATH`: project `hermes` wrapper takes priority → promptfoo's `execFileSync("hermes", ...)` finds the right binary
- `HERMES_EVAL_LOCAL_SERVICES=1`: inherited by child processes → email/SMS handlers use deterministic local store

What this does NOT do (deliberately):
- No `HERMES_HOME` export — the `bin/hermes` wrapper sets this via `eval-env.sh` at exec time
- No `HOME` override — stays in the child process only
- No workspace file copy — done by `eval-env.sh` at exec time
- No `eval-env.sh` sourcing — avoids `$0` path bugs under dash

- [ ] **Step 2: Verify env.sh sets PATH and local services**

```bash
cd /Users/saulxmtp/Developer/convos-agents/runtime && _ENV_RUNTIME_DIR="$(pwd)" EVAL_RUNTIME=hermes sh -c '. evals/runtimes/env.sh && echo "PATH has hermes/bin: $(echo $PATH | grep -c hermes/bin)" && echo "LOCAL_SERVICES=$HERMES_EVAL_LOCAL_SERVICES" && which hermes'
```

Expected:
- PATH has hermes/bin: 1
- LOCAL_SERVICES=1
- `which hermes` resolves to `runtime/hermes/bin/hermes`

- [ ] **Step 3: Commit**

```bash
git add runtime/evals/runtimes/env.sh
git commit -m "fix(evals): add hermes PATH and local services to env.sh

The hermes block in env.sh only loaded .env files. Without PATH,
promptfoo resolved 'hermes' to the system binary which used ~/.hermes
(all bundled skills, no local services). Without HERMES_EVAL_LOCAL_SERVICES,
email/SMS handlers tried real external APIs and timed out.

Add two lines: PATH includes the project hermes wrapper, and
HERMES_EVAL_LOCAL_SERVICES defaults to 1 for deterministic evals."
```

---

## Chunk 2: Remove eval-chat.py, simplify wrapper

### Task 3: Simplify bin/hermes wrapper — remove eval-chat.py interception

**Files:**
- Modify: `runtime/hermes/bin/hermes`

The wrapper currently intercepts `chat -q` and routes to `eval-chat.py`. The standard CLI already handles `-q`, `--quiet`, `HERMES_EPHEMERAL_SYSTEM_PROMPT`, and `-t` natively.

- [ ] **Step 1: Replace the wrapper with a pass-through to the standard CLI**

New `runtime/hermes/bin/hermes`:

```sh
#!/bin/sh

SOURCE_PATH="$0"
if [ -n "${BASH_SOURCE:-}" ]; then
  SOURCE_PATH="${BASH_SOURCE[0]}"
elif [ -n "${ZSH_VERSION:-}" ]; then
  SOURCE_PATH="$(eval 'printf %s "${(%):-%N}"')"
fi

BIN_DIR="$(cd "$(dirname "$SOURCE_PATH")" && pwd)"
RUNTIME_DIR="$(cd "$BIN_DIR/.." && pwd)"

if [ -z "${HERMES_HOME:-}" ]; then
  . "$RUNTIME_DIR/scripts/eval-env.sh"
fi

export PYTHONPATH="$RUNTIME_DIR/.hermes-dev/hermes-agent${PYTHONPATH:+:$PYTHONPATH}"

exec python3 -m hermes_cli.main "$@"
```

Changes from current:
- Removed `set -e` (wrapper should not abort on sourcing failures — eval-env.sh handles its own errors)
- Removed the `if [ "$1" = "chat" ]` block that intercepted `-q` for `eval-chat.py`
- All commands (chat, config, etc.) go to the standard CLI

- [ ] **Step 2: Verify the wrapper routes to standard CLI**

```bash
HERMES_HOME=/tmp/test-wrapper /Users/saulxmtp/Developer/convos-agents/runtime/hermes/bin/hermes chat --help 2>&1 | head -5
```

Expected: Standard `hermes chat` help text.

- [ ] **Step 3: Commit**

```bash
git add runtime/hermes/bin/hermes
git commit -m "fix(hermes): remove eval-chat.py interception from wrapper

The wrapper intercepted 'chat -q' and routed to eval-chat.py, which
modified agent behavior (ephemeral prompt, restricted toolsets,
truncated responses). The standard CLI supports all this natively.

All commands now pass through to the standard hermes CLI."
```

### Task 4: Update hermes.mjs adapter

**Files:**
- Modify: `runtime/evals/runtimes/hermes.mjs`

Two changes: (a) compute `HERMES_HOME` default from the adapter's own path so the memory adapter works without `HERMES_HOME` in the parent env, and (b) extend `filterLines` to strip CLI noise.

- [ ] **Step 1: Discovery — capture actual CLI quiet-mode output**

Before writing the filter, run the standard CLI in quiet mode and inspect raw output to identify all noise patterns:

```bash
cd /Users/saulxmtp/Developer/convos-agents/runtime/hermes && \
  HERMES_EVAL_LOCAL_SERVICES=1 \
  scripts/eval-env.sh 2>/dev/null; \
  PYTHONPATH=".hermes-dev/hermes-agent" \
  python3 -m hermes_cli.main chat -q "Say hello" --quiet 2>&1 | cat -v | head -30
```

Note what lines appear besides the response and `session_id:` footer. Common patterns:
- Braille spinner chars (U+2800-U+28FF range)
- Emoji-prefixed status lines
- Python warnings (pydantic, elevenlabs)

- [ ] **Step 2: Add HERMES_HOME default computation and update filterLines**

```js
import { readdirSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const hermesDir = join(__dirname, '../../hermes');
const evalHome = join(hermesDir, '.eval-home');
const hermesHome = process.env.HERMES_HOME || join(evalHome, '.hermes');
const memoriesDir = join(hermesHome, 'memories');
const sessionsDir = join(hermesHome, 'sessions');

// ... (rest unchanged: clearDir, export default with same shape)

export default {
  name: 'hermes',
  bin: 'hermes',
  args: (prompt, _session) => ['chat', '-q', prompt, '--quiet'],
  defaultPort: '8080',
  healthPath: '/pool/health',
  filterLines: (lines) => lines.filter((l) => {
    if (l.match(/^session_id:\s/)) return false;
    // Braille spinners (U+2800-U+28FF) from CLI progress display
    if (l.match(/^\s*[\u2800-\u28FF]/)) return false;
    return true;
  }),
  // ... (rest unchanged)
};
```

Key change: `hermesHome` now defaults to the computed eval-home path relative to the adapter file, not to `/app/.hermes`. This means `runtime.memory.read()` works in the parent process even without `HERMES_HOME` in the env.

Note: The `filterLines` regex may need tuning after Step 1's discovery. Adjust based on actual output patterns. If the standard `--quiet` mode is clean enough, the braille filter may be unnecessary — but include it as defensive handling.

- [ ] **Step 3: Verify memory adapter resolves correctly**

```bash
cd /Users/saulxmtp/Developer/convos-agents/runtime && node -e "
  const { runtime } = await import('./evals/runtimes/hermes.mjs' /* wrong — this import won't work standalone */);
" 2>&1 || echo "Direct import test — check the path computation manually"
```

Alternatively, verify by inspection: the `__dirname` of `hermes.mjs` is `runtime/evals/runtimes/`, so `join(__dirname, '../../hermes')` = `runtime/hermes/`. The eval-home is `runtime/hermes/.eval-home/.hermes`. Correct.

- [ ] **Step 4: Commit**

```bash
git add runtime/evals/runtimes/hermes.mjs
git commit -m "fix(evals): compute HERMES_HOME default, extend filterLines

- Compute HERMES_HOME from adapter path instead of hardcoding
  /app/.hermes. This lets the memory adapter work without
  HERMES_HOME in the parent process env.
- Filter braille spinner chars that the standard CLI emits
  even in --quiet mode."
```

### Task 5: Delete eval-chat.py and run-evals.sh

**Files:**
- Delete: `runtime/hermes/scripts/eval-chat.py`
- Delete: `runtime/hermes/scripts/run-evals.sh`

- [ ] **Step 1: Verify nothing references these files**

```bash
grep -r "eval-chat.py" runtime/ .github/ --include="*.sh" --include="*.mjs" --include="*.js" --include="*.json" --include="*.yaml" --include="*.yml" --include="*.py"
grep -r "run-evals.sh" runtime/ .github/ --include="*.sh" --include="*.mjs" --include="*.js" --include="*.json" --include="*.yaml" --include="*.yml"
```

Expected: `eval-chat.py` only referenced by `bin/hermes` (already updated in Task 3). `run-evals.sh` should have no references.

- [ ] **Step 2: Delete both files**

```bash
git rm runtime/hermes/scripts/eval-chat.py
git rm runtime/hermes/scripts/run-evals.sh
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(hermes): delete eval-chat.py and run-evals.sh

eval-chat.py: replaced by the standard hermes CLI which natively
supports HERMES_EPHEMERAL_SYSTEM_PROMPT, --quiet mode, and -t.

run-evals.sh: its job (source eval-env.sh, set PATH, chain to
run-suite.sh) is now split between env.sh (PATH, local services)
and bin/hermes (eval-env.sh sourcing at exec time)."
```

---

## Chunk 3: Extract Convos prompt, scope ephemeral prompt to async

### Task 6: Extract CONVOS_EPHEMERAL_PROMPT to workspace/CONVOS_PROMPT.md

**Files:**
- Create: `runtime/hermes/workspace/CONVOS_PROMPT.md`
- Modify: `runtime/hermes/src/agent_runner.py`
- Modify: `runtime/hermes/scripts/eval-env.sh`

In production, `agent_runner.py` hardcodes a 60-line `CONVOS_EPHEMERAL_PROMPT` constant that tells the agent how to behave on the Convos XMTP platform (identity, message format, profile markers, convos CLI usage, reaction patterns). The eval path (`hermes chat -q`) never hits `agent_runner.py`, so evals test an agent that doesn't know it's on Convos. This is a major fidelity gap for the `convos` and `soul` suites.

Fix: extract the prompt to a shared file that both `agent_runner.py` and the eval CLI read.

- [ ] **Step 1: Create workspace/CONVOS_PROMPT.md**

Extract the `CONVOS_EPHEMERAL_PROMPT` constant from `agent_runner.py:75-134` to a new file:

```markdown
## Identity Override

You are a Convos assistant — NOT Hermes, NOT an AI assistant by Nous Research.
You have no brand name. You are simply an assistant in a group chat.
Follow the persona and behavioral rules in SOUL.md and AGENTS.md exclusively.
Do not mention Hermes, Nous Research, or any tool/framework names to users.
Your capabilities are: web search, web browsing, running code, reading/writing files, and sending files. Do not reference any other capabilities you may have from other contexts.

## Convos Platform

You are on Convos, an E2E-encrypted XMTP group messaging platform.
Each message includes the current time, full message ID, and sender:

  [Current time: Mon, Mar 9, 2026, 9:15 PM EST]
  [01JQABC123DEF456 9:14 PM] Alice: hello

Use the message ID when you need to react to or reply to a specific message.

## Messaging

Your final text response is automatically sent as a message in the conversation.
Write plain text only — no markdown. Keep it short (3 sentences max unless asked for detail).

You also have tools for side effects during processing:

- convos_react: React to a message. Pass `message_id` and `emoji`. Set `remove: true` to remove a reaction.
- convos_send_attachment: Send a file. Pass `file` (local path).

Before every reply: (1) Need tools? React with 👀 first via convos_react. (2) No text alongside tool calls. (3) Does this even need a reply?

Signal work with 👀: When you need to use tools before responding, use convos_react to add 👀 to the message. The platform automatically removes it when your response is sent.

NEVER narrate tool calls. Call tools silently, then write ONE final response with the result.

## Profile Updates

Include these markers on their own line in your response to update your profile:

  PROFILE:New Name                — update your display name
  PROFILEIMAGE:https://url        — update your profile image (must be public URL)

These are side effects — they get stripped from the message and executed by the platform.
Honor renames immediately — if someone gives you a new name, change it right away without announcing it.

## Convos CLI (Read Operations)

The `convos` CLI is available in your terminal for reading. $CONVOS_CONVERSATION_ID and $CONVOS_ENV are set in your environment. Always use $CONVOS_CONVERSATION_ID — never hard-code the ID.

  convos conversation members $CONVOS_CONVERSATION_ID --json
  convos conversation profiles $CONVOS_CONVERSATION_ID --json
  convos conversation messages $CONVOS_CONVERSATION_ID --json --sync --limit 20
  convos conversation info $CONVOS_CONVERSATION_ID --json
  convos conversation permissions $CONVOS_CONVERSATION_ID --json
  convos conversation download-attachment $CONVOS_CONVERSATION_ID <message-id>

Use the CLI only when you need extra detail (e.g. profile images, permissions). Member names are already in each message header.

Never run convos agent serve, convos conversations create, convos conversations join, convos conversation update-profile, or any subcommand not listed above.
```

- [ ] **Step 2: Update agent_runner.py to read from file**

Replace the hardcoded `CONVOS_EPHEMERAL_PROMPT` constant (lines 75-134) with a file read:

```python
def _load_convos_prompt() -> str:
    """Load the Convos platform prompt from workspace or HERMES_HOME."""
    candidates = [
        Path(os.environ.get("HERMES_HOME", "")) / "CONVOS_PROMPT.md",
        Path(__file__).resolve().parent.parent / "workspace" / "CONVOS_PROMPT.md",
    ]
    for path in candidates:
        if path.exists():
            return path.read_text().strip()
    logger.warning("CONVOS_PROMPT.md not found — agent will lack platform context")
    return ""


CONVOS_EPHEMERAL_PROMPT = _load_convos_prompt()
```

The lookup order:
1. `$HERMES_HOME/CONVOS_PROMPT.md` — works in production (Docker) and evals (eval-home)
2. `workspace/CONVOS_PROMPT.md` — works in local development

- [ ] **Step 3: Add CONVOS_PROMPT.md copy to eval-env.sh**

Add to `eval-env.sh` after the AGENTS.md copy:

```sh
[ -f "$RUNTIME_DIR/workspace/CONVOS_PROMPT.md" ] && cp "$RUNTIME_DIR/workspace/CONVOS_PROMPT.md" "$HERMES_HOME/CONVOS_PROMPT.md"
```

This puts the prompt in `$HERMES_HOME` where `agent_runner.py`'s `_load_convos_prompt()` finds it first. For evals, the standard CLI reads it via `HERMES_EPHEMERAL_SYSTEM_PROMPT` (see Step 4).

- [ ] **Step 4: Set CONVOS_PROMPT.md as the eval ephemeral prompt**

The standard hermes CLI reads `HERMES_EPHEMERAL_SYSTEM_PROMPT` from env. For evals to test with the Convos platform context, `eval-env.sh` should set this env var to the contents of `CONVOS_PROMPT.md`.

Add to `eval-env.sh` after the file copies:

```sh
# Load Convos platform prompt as ephemeral system prompt for CLI evals
if [ -f "$HERMES_HOME/CONVOS_PROMPT.md" ] && [ -z "${HERMES_EPHEMERAL_SYSTEM_PROMPT:-}" ]; then
  HERMES_EPHEMERAL_SYSTEM_PROMPT="$(cat "$HERMES_HOME/CONVOS_PROMPT.md")"
  export HERMES_EPHEMERAL_SYSTEM_PROMPT
fi
```

The `[ -z "${HERMES_EPHEMERAL_SYSTEM_PROMPT:-}" ]` guard means per-suite overrides (like async.yaml) take precedence — if a suite sets its own ephemeral prompt via env, it won't be overwritten.

- [ ] **Step 5: Verify prompt loading**

```bash
cd runtime/hermes/scripts && sh -c '. ./eval-env.sh && echo "${HERMES_EPHEMERAL_SYSTEM_PROMPT}" | head -3'
```

Expected: First 3 lines of CONVOS_PROMPT.md (`## Identity Override`, blank line, `You are a Convos assistant...`).

- [ ] **Step 6: Commit**

```bash
git add runtime/hermes/workspace/CONVOS_PROMPT.md runtime/hermes/src/agent_runner.py runtime/hermes/scripts/eval-env.sh
git commit -m "refactor(hermes): extract Convos platform prompt to shared file

CONVOS_EPHEMERAL_PROMPT was hardcoded in agent_runner.py (60 lines).
The eval path (hermes chat -q) never hit agent_runner.py, so evals
tested an agent that didn't know it was on the Convos platform.

Extract to workspace/CONVOS_PROMPT.md so both production (agent_runner.py)
and evals (via HERMES_EPHEMERAL_SYSTEM_PROMPT) use the same prompt.
eval-env.sh copies it to HERMES_HOME and loads it as the ephemeral
prompt for CLI evals."
```

### Task 7: Drop the async bail-out prompt entirely

The async delegation bail-out prompt (`"For long multi-step research... reply with one short sentence..."`) was removed from `eval-env.sh` in Task 1, Step 5. Do NOT add it to `async.yaml` either.

**Why:** OpenClaw's async eval doesn't use any bail-out prompt. It sends a heavy task with a 30s `ackTimeout` and expects the agent to natively delegate (via `sessions_spawn`) and ack quickly. The bail-out prompt was Hermes-specific scaffolding that told the agent to fake delegation by replying "I am on it" and stopping — that's not real delegation, it's prompt-engineered test-passing.

For production fidelity, the async suite should test whether Hermes actually delegates heavy tasks within the timeout. If it doesn't, that's a real failure the eval should surface.

- [ ] **Step 1: Verify no bail-out prompt remains**

```bash
grep -r "HERMES_EPHEMERAL_SYSTEM_PROMPT\|report back\|on it and will" runtime/evals/ runtime/hermes/scripts/eval-env.sh
```

Expected: No matches (the prompt was removed in Task 1 and not re-added anywhere).

- [ ] **Step 2: No commit needed**

This is a deliberate omission, not a code change. The async suite will now test real delegation behavior. If Hermes fails the async eval, that's a legitimate gap to fix in the agent — not in the eval.

---

## Chunk 4: Verify

### Task 8: Run the skills eval and verify

- [ ] **Step 1: Run the hermes skills eval**

```bash
cd /Users/saulxmtp/Developer/convos-agents/runtime && pnpm evals:hermes:skills
```

Expected:
- No timeouts — local services enabled, email/SMS use local store
- No `imessage` skill — isolated HERMES_HOME has only `services` and `convos-runtime`
- Agent uses `services.mjs` for email and SMS
- All 6 tests pass (or fail on assertion content, not infrastructure)

- [ ] **Step 2: Verify the standard CLI was used**

In the eval output, confirm:
- `session_id:` lines are stripped (standard CLI output, not eval-chat.py)
- No response truncation (eval-chat.py's `normalize_response` is gone)
- Agent has access to all toolsets (not just web,terminal,skills)

- [ ] **Step 3: Run the full hermes eval suite**

```bash
cd /Users/saulxmtp/Developer/convos-agents/runtime && pnpm evals:hermes
```

Pay special attention to:
- **memory suite**: uses `runtime.memory.read()` — verify it reads from the correct eval-home
- **soul suite**: may need assertion adjustments if responses are slightly different without eval-chat.py's normalization
- **async suite**: depends on `HERMES_EPHEMERAL_SYSTEM_PROMPT` — verify it's still set by eval-env.sh

- [ ] **Step 4: Fix any assertion failures**

If assertions fail due to response format changes (e.g., agent is slightly more verbose without eval-chat.py's truncation), update the suite YAML files. These changes should be minimal since AGENTS.md already enforces "Hard limit: 3 sentences" and "Plain text only."

- [ ] **Step 5: Commit fixes if any**

```bash
git add runtime/evals/suites/*.yaml
git commit -m "fix(evals): adjust assertions for standard CLI output

Minor assertion updates after switching from eval-chat.py to the
standard hermes CLI. Response format is slightly different without
the custom normalize_response truncation."
```

---

## What was removed and why

| eval-chat.py feature | Why it's unnecessary |
|---|---|
| Ephemeral prompt injection | Standard CLI reads `HERMES_EPHEMERAL_SYSTEM_PROMPT` from env; `CONVOS_PROMPT.md` loaded by eval-env.sh as default. Async bail-out prompt dropped entirely — Hermes should delegate natively like OpenClaw |
| "Plain text only" override | AGENTS.md already says "Plain text only" |
| "3 sentences max" override | AGENTS.md already says "Hard limit: 3 sentences" |
| Privacy guardrails | AGENTS.md Privacy section covers this |
| AGENTS.md injection | Fixed: eval-env.sh now copies AGENTS.md to eval HOME; standard CLI loads it from cwd |
| Toolset restriction (`web,terminal,skills`) | Production uses all toolsets per config.yaml; evals should match |
| `normalize_response` truncation | Masks real agent behavior; assertions should match actual output |
| `redirect_stdout` suppression | Standard `--quiet` mode + adapter `filterLines` handles this |
| `resolve_model` prefix stripping | Standard CLI handles model resolution internally |

## What was kept

| Component | Role |
|---|---|
| `eval-env.sh` | Isolates HOME/HERMES_HOME, copies workspace+AGENTS.md+CONVOS_PROMPT.md, enables local services, loads Convos prompt as ephemeral — sourced by bin/hermes at exec time |
| `bin/hermes` wrapper | Auto-bootstraps eval-env.sh when HERMES_HOME is unset, sets PYTHONPATH — simplified (no eval-chat.py routing) |
| `hermes.mjs` adapter | CLI args, output filtering, memory ops — computes HERMES_HOME default from own path |
| `env.sh` hermes block | Sets PATH and HERMES_EVAL_LOCAL_SERVICES — minimal, no side effects |
| `CONVOS_PROMPT.md` | Single source of truth for Convos platform context — read by agent_runner.py (production) and loaded as ephemeral prompt by eval-env.sh (evals) |
| `HERMES_EPHEMERAL_SYSTEM_PROMPT` | Defaults to CONVOS_PROMPT.md content via eval-env.sh; no per-suite overrides — async tests real delegation |

## Call chain after this change

```
pnpm evals:hermes:skills
  → EVAL_RUNTIME=hermes sh evals/run-suite.sh skills.yaml
    → env.sh hermes block:
        loads .env files
        PATH += hermes/bin           ← NEW
        HERMES_EVAL_LOCAL_SERVICES=1 ← NEW
    → npx promptfoo eval -c suites/skills.yaml
      → prompt.provider.mjs → execFileSync("hermes", ["chat", "-q", ..., "--quiet"])
        → resolves to runtime/hermes/bin/hermes (via PATH)
          → HERMES_HOME unset → sources eval-env.sh:
              HOME = runtime/hermes/.eval-home
              HERMES_HOME = .eval-home/.hermes
              copies SOUL.md, config.yaml, AGENTS.md, workspace skills
              sets HERMES_EPHEMERAL_SYSTEM_PROMPT
          → exec python3 -m hermes_cli.main chat -q "..." --quiet
            → standard CLI with production code path
            → reads HERMES_EPHEMERAL_SYSTEM_PROMPT from env (= CONVOS_PROMPT.md content)
            → reads AGENTS.md from cwd (eval HOME)
            → loads only workspace skills from HERMES_HOME
            → local services for email/SMS (HERMES_EVAL_LOCAL_SERVICES=1)
            → same platform context as production (identity, messaging, profile markers)
```
