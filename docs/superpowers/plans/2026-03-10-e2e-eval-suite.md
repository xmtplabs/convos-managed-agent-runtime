# E2E Eval Suite Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Promptfoo-based e2e eval suite that sends real messages to a running OpenClaw agent and grades responses with LLM-as-judge plus side-effect verification.

**Architecture:** A custom Promptfoo provider creates a conversation via `convos-cli`, joins the runtime via `POST /convos/join`, sends messages as the user identity, polls for agent responses, and returns them for judging. Custom JS assertions verify side effects (profile name/image) on the XMTP network.

**Tech Stack:** Promptfoo (via npx), convos-cli, OpenRouter (judge LLM), GitHub Actions workflow_dispatch

**Spec:** `docs/superpowers/specs/2026-03-10-e2e-eval-design.md`
**Issue:** https://github.com/xmtplabs/convos-agents/issues/418

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `runtime/scripts/qa/eval/provider.mjs` | Create | Custom Promptfoo provider: conversation setup, send messages, poll for agent responses |
| `runtime/scripts/qa/eval/assertions.mjs` | Create | Side-effect verification functions (profile name, profile image) |
| `runtime/scripts/qa/eval/promptfooconfig.yaml` | Create | Test suite definition with 5 test cases |
| `runtime/scripts/qa/eval/test-image.jpg` | Create | Small recognizable test image for attachment test |
| `runtime/package.json` | Modify | Add `qa:eval` script |
| `.github/workflows/runtime-dispatch.yml` | Modify | Add `run_eval` input and eval step |

---

## Chunk 1: Provider and Assertions

### Task 1: Create the custom Promptfoo provider

**Files:**
- Create: `runtime/scripts/qa/eval/provider.mjs`

- [ ] **Step 1: Create `provider.mjs` with conversation setup and message flow**

```js
// runtime/scripts/qa/eval/provider.mjs
import { execSync } from 'child_process';

const ENV = process.env.XMTP_ENV || 'dev';
const GATEWAY_PORT = process.env.GATEWAY_INTERNAL_PORT || '18789';
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
// Full path required — npx promptfoo doesn't source node-path.sh
const CONVOS = '/app/node_modules/.bin/convos';

let sharedConversationId = null;
let userInboxId = null;

function exec(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf-8', timeout: 30_000, ...opts }).trim();
}

function setup() {
  // 1. Create conversation via convos-cli (user identity)
  const createOut = exec(
    `${CONVOS} conversations create --name "QA Eval ${Date.now()}" --env ${ENV} --json`
  );
  const data = JSON.parse(createOut);
  sharedConversationId = data.conversationId;
  userInboxId = data.inboxId;
  const inviteUrl = data.invite.url;

  console.log(`[eval] Created conversation ${sharedConversationId}`);
  console.log(`[eval] User inboxId: ${userInboxId}`);

  // 2. Have the runtime join via POST /convos/join
  const joinBody = JSON.stringify({ inviteUrl, profileName: 'QA Eval Agent' });
  exec(
    `curl -sf -X POST http://localhost:${GATEWAY_PORT}/convos/join ` +
    `-H 'Content-Type: application/json' ` +
    `-H 'Authorization: Bearer ${GATEWAY_TOKEN}' ` +
    `-d '${joinBody}'`,
    { timeout: 30_000 }
  );

  console.log(`[eval] Runtime joined conversation`);

  // 3. Wait for join to propagate
  execSync('sleep 5');
}

function pollForAgentResponse(afterTimestamp) {
  const deadline = Date.now() + 120_000; // 120s timeout
  const pollInterval = 3_000; // 3s between polls

  while (Date.now() < deadline) {
    const messagesOut = exec(
      `${CONVOS} conversation messages ${sharedConversationId} ` +
      `--sync --limit 5 --direction descending --env ${ENV} --json`,
      { timeout: 30_000 }
    );

    let messages;
    try {
      messages = JSON.parse(messagesOut);
    } catch {
      execSync(`sleep ${pollInterval / 1000}`);
      continue;
    }

    // Find first message from someone other than the user, after our send
    const agentMsg = (Array.isArray(messages) ? messages : []).find(
      (m) => m.senderInboxId !== userInboxId && new Date(m.sentAt).getTime() > afterTimestamp
    );

    if (agentMsg) {
      return agentMsg.content || agentMsg.text || JSON.stringify(agentMsg);
    }

    execSync(`sleep ${pollInterval / 1000}`);
  }

  throw new Error('Timed out waiting for agent response (120s)');
}

export default class OpenClawProvider {
  id() {
    return 'openclaw-agent';
  }

  async callApi(prompt, context) {
    if (!sharedConversationId) {
      setup();
    }

    const vars = context.vars || {};
    const beforeSend = Date.now();

    // If there's an attachment, send it first
    if (vars.attachment) {
      const attachDir = new URL('.', import.meta.url).pathname;
      const attachPath = vars.attachment.startsWith('./')
        ? `${attachDir}${vars.attachment.slice(2)}`
        : vars.attachment;

      exec(
        `${CONVOS} conversation send-attachment ${sharedConversationId} ` +
        `${attachPath} --env ${ENV}`,
        { timeout: 30_000 }
      );
      console.log(`[eval] Sent attachment: ${vars.attachment}`);
      execSync('sleep 2'); // Brief pause between attachment and text
    }

    // Send the text prompt
    exec(
      `${CONVOS} conversation send-text ${sharedConversationId} ` +
      `${JSON.stringify(prompt)} --env ${ENV}`,
      { timeout: 30_000 }
    );
    console.log(`[eval] Sent prompt: ${prompt}`);

    // Poll for agent response
    try {
      const response = pollForAgentResponse(beforeSend);
      console.log(`[eval] Agent response: ${response.substring(0, 100)}...`);
      return {
        output: response,
        metadata: { conversationId: sharedConversationId },
      };
    } catch (err) {
      return {
        output: '',
        error: err.message,
        metadata: { conversationId: sharedConversationId },
      };
    }
  }
}
```

- [ ] **Step 2: Verify the file is valid JS**

Run: `node --check runtime/scripts/qa/eval/provider.mjs`
Expected: No output (valid syntax)

- [ ] **Step 3: Commit**

```bash
git add runtime/scripts/qa/eval/provider.mjs
git commit -m "feat(eval): add custom Promptfoo provider for OpenClaw agent"
```

---

### Task 2: Create custom assertions

**Files:**
- Create: `runtime/scripts/qa/eval/assertions.mjs`

- [ ] **Step 1: Create `assertions.mjs` with profile verification functions**

```js
// runtime/scripts/qa/eval/assertions.mjs
import { execSync } from 'child_process';

const ENV = process.env.XMTP_ENV || 'dev';
// Full path required — npx promptfoo doesn't source node-path.sh
const CONVOS = '/app/node_modules/.bin/convos';

function getProfiles(conversationId) {
  const out = execSync(
    `${CONVOS} conversation profiles ${conversationId} --env ${ENV} --json`,
    { encoding: 'utf-8', timeout: 30_000 }
  ).trim();
  return JSON.parse(out);
}

/**
 * Verify agent's profile name matches expected value.
 * Reads expected name from context.vars.expectedName.
 * Usage in YAML: file://assertions.mjs:profileNameEquals
 */
export function profileNameEquals(output, context) {
  const expectedName = context.vars?.expectedName;
  if (!expectedName) {
    return { pass: false, score: 0, reason: 'Missing vars.expectedName in test config' };
  }

  const conversationId = context.providerResponse?.metadata?.conversationId;
  if (!conversationId) {
    return { pass: false, score: 0, reason: 'No conversationId in provider metadata' };
  }

  // Wait briefly for profile update to propagate
  execSync('sleep 3');

  try {
    const profiles = getProfiles(conversationId);
    const match = (Array.isArray(profiles) ? profiles : []).some(
      (p) => p.name === expectedName
    );
    return {
      pass: match,
      score: match ? 1 : 0,
      reason: match
        ? `Profile name is "${expectedName}"`
        : `Expected name "${expectedName}", got: ${(Array.isArray(profiles) ? profiles : []).map((p) => p.name).join(', ')}`,
    };
  } catch (err) {
    return { pass: false, score: 0, reason: `Failed to query profiles: ${err.message}` };
  }
}

/**
 * Verify agent's profile image is set (non-null).
 * Usage in YAML: file://assertions.mjs:profileImageSet
 */
export function profileImageSet(output, context) {
  const conversationId = context.providerResponse?.metadata?.conversationId;
  if (!conversationId) {
    return { pass: false, score: 0, reason: 'No conversationId in provider metadata' };
  }

  execSync('sleep 3');

  try {
    const profiles = getProfiles(conversationId);
    const hasImage = (Array.isArray(profiles) ? profiles : []).some(
      (p) => p.image && p.image !== 'null'
    );
    return {
      pass: hasImage,
      score: hasImage ? 1 : 0,
      reason: hasImage
        ? 'Profile image is set'
        : 'Profile image is null or missing',
    };
  } catch (err) {
    return { pass: false, score: 0, reason: `Failed to query profiles: ${err.message}` };
  }
}
```

- [ ] **Step 2: Verify the file is valid JS**

Run: `node --check runtime/scripts/qa/eval/assertions.mjs`
Expected: No output (valid syntax)

- [ ] **Step 3: Commit**

```bash
git add runtime/scripts/qa/eval/assertions.mjs
git commit -m "feat(eval): add side-effect assertion functions for profile verification"
```

---

## Chunk 2: Config, Test Image, and CI Integration

### Task 3: Create Promptfoo config and test image

**Files:**
- Create: `runtime/scripts/qa/eval/promptfooconfig.yaml`
- Create: `runtime/scripts/qa/eval/test-image.jpg`

- [ ] **Step 1: Download a small recognizable test image**

Use the XMTP logomark as the test image (referenced in existing test-profile-update.sh):

```bash
curl -sL https://xmtp.org/img/logomark-dark.png -o runtime/scripts/qa/eval/test-image.png
```

Note: Using .png since the source is PNG. Update the YAML `attachment` var accordingly.

- [ ] **Step 2: Create `promptfooconfig.yaml`**

```yaml
# runtime/scripts/qa/eval/promptfooconfig.yaml
# E2E eval suite for OpenClaw runtime.
# Run: npx promptfoo eval -c scripts/qa/eval/promptfooconfig.yaml

description: "OpenClaw Runtime E2E Eval"

providers:
  - file://provider.mjs

defaultTest:
  options:
    provider:
      id: openrouter:anthropic/claude-sonnet-4
      config:
        apiKey: "{{EVAL_OPENROUTER_API_KEY}}"

tests:
  - description: "Agent can update profile name"
    vars:
      prompt: "Update your profile name to 'QA Bot Alpha'. Confirm when done."
      expectedName: "QA Bot Alpha"
    assert:
      - type: llm-rubric
        value: "The response indicates the profile name was successfully updated"
      - type: javascript
        value: "file://assertions.mjs:profileNameEquals"

  - description: "Agent can update profile photo"
    vars:
      prompt: "Update your profile photo to https://xmtp.org/img/logomark-dark.png. Confirm when done."
    assert:
      - type: llm-rubric
        value: "The response indicates the profile photo was successfully updated"
      - type: javascript
        value: "file://assertions.mjs:profileImageSet"

  - description: "Agent can recognize image content"
    vars:
      prompt: "What do you see in that image? Describe it briefly."
      attachment: "./test-image.png"
    assert:
      - type: llm-rubric
        value: "The response describes specific visual content from the image, not a generic refusal or inability to see images"

  - description: "Agent can tell the time"
    vars:
      prompt: "What time is it right now?"
    assert:
      - type: llm-rubric
        value: "The response contains a specific time in hours and minutes, not a refusal"

  - description: "Agent can see group members"
    vars:
      prompt: "Who is in this conversation? List the participants."
    assert:
      - type: llm-rubric
        value: "The response lists one or more participants, identities, or addresses in the conversation"
```

- [ ] **Step 3: Commit**

```bash
git add runtime/scripts/qa/eval/promptfooconfig.yaml runtime/scripts/qa/eval/test-image.png
git commit -m "feat(eval): add promptfoo config and test image"
```

---

### Task 4: Add pnpm script

**Files:**
- Modify: `runtime/package.json:16` (add after `qa:prompts` line)

- [ ] **Step 1: Add `qa:eval` script to package.json**

Add this line after `"qa:prompts": "sh scripts/qa/prompts.sh"`:

```json
"qa:eval": "npx promptfoo eval -c scripts/qa/eval/promptfooconfig.yaml",
```

- [ ] **Step 2: Verify pnpm reads it**

Run: `cd runtime && pnpm run qa:eval --help 2>&1 | head -5`
Expected: Promptfoo help output (or "npx: command not found" if not in container — that's OK, it runs in Docker)

- [ ] **Step 3: Commit**

```bash
git add runtime/package.json
git commit -m "feat(eval): add qa:eval pnpm script"
```

---

### Task 5: Update GitHub Actions dispatch workflow

**Files:**
- Modify: `.github/workflows/runtime-dispatch.yml:7-16` (add input)
- Modify: `.github/workflows/runtime-dispatch.yml:108` (add step after smoke tests)

- [ ] **Step 1: Add `run_eval` input to workflow_dispatch**

After the existing `tag` input (line 15), add:

```yaml
      run_eval:
        description: 'Run e2e eval suite after smoke tests'
        type: boolean
        default: false
```

- [ ] **Step 2: Add eval step after smoke tests**

After the "Run QA smoke tests" step (line 108) and before the "Dump logs" step, add:

```yaml
      - name: Run e2e eval
        if: ${{ inputs.run_eval }}
        run: |
          docker exec \
            -e EVAL_OPENROUTER_API_KEY=$EVAL_OPENROUTER_API_KEY \
            qa-runtime timeout 900 pnpm qa:eval
        env:
          EVAL_OPENROUTER_API_KEY: ${{ secrets.EVAL_OPENROUTER_API_KEY }}
```

- [ ] **Step 3: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/runtime-dispatch.yml'))"`
Expected: No output (valid YAML)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/runtime-dispatch.yml
git commit -m "ci: add manual e2e eval trigger to runtime dispatch workflow"
```

---

## Post-Implementation Checklist

- [ ] Add `EVAL_OPENROUTER_API_KEY` secret to the GitHub repo settings
- [ ] Test locally: `cd runtime && docker build && docker run` then `docker exec <container> pnpm qa:eval`
- [ ] Test via dispatch: trigger workflow with `run_eval: true` on a non-production tag
