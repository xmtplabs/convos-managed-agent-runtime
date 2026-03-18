# Layered Group Memory System — Technical Design

## 1) Purpose

Design a layered memory system where agents:

1. observe conversations and persist durable memories,
2. evaluate newly persisted memories to decide whether group artifacts should be created or updated,
3. independently decide whether to respond in chat,
4. write group artifacts via a custom XMTP content type and optionally respond in conversation.

The system prioritizes durable, group-owned artifacts over assistant chat output.

## 2) Goals and Non-Goals

### Goals
- Convert ephemeral group conversation into durable, structured artifacts.
- Keep artifact ownership at the group/user level rather than the assistant runtime.
- Separate concerns between observation, judgment, artifact publication, and chat response.
- Support quiet operation: agent can provide value without posting chat replies.
- Enable deterministic create-vs-update behavior using structured memory state.
- Standardize artifact writes through a custom content type.

### Non-Goals (Phase 1)
- No new group-memory storage infrastructure.
- No personal-info product surface or sharing UX implementation.
- No gateway/plugin/tooling additions beyond current memory-core and eval framework.
- No dependency upgrades.

## 3) Layered Architecture

```text
Layer 1: Conversation Stream (raw events)
    ↓
Layer 2: Agent Memory + Group Artifact Pipeline
    ↓
Layer 3: Personal Info (user-private curation)
    ↺ (optional reseeding into other groups)
```

### Layer 1 — Conversation Stream
- Input: private group messages (multi-party, time-ordered).
- Characteristics: high volume, unstructured, ephemeral.

### Layer 2 — Agent Memory + Group Artifacts
- Agent continuously observes and persists working memory.
- Agent makes two sequential decisions per event:
  - **Artifact** (first): create new artifact, update existing artifact, or no-op.
  - **Chat response** (second, informed by artifact decision): respond or stay silent (default silent).
- Artifacts are persisted as structured files/content records and remain available independent of the agent process.

### Layer 3 — Personal Info (future)
- Users selectively save artifacts into private personal context.
- Personal context can be shared into other groups to seed future assistants.

## 4) Core Runtime Loop

For each incoming conversation event:

1. **A. Observe**
   - Parse message + sender + temporal context.
   - Extract candidate facts, commitments, decisions, and themes.
   - Update agent working memory (`MEMORY.md` + supporting memory files).
   - Produce `MemoryDelta`.

2. **B1. Evaluate artifact**
   - Compare new memory state versus prior state.
   - Determine if there is sufficient signal for artifact action.
   - Apply restraint by default (prefer no-op unless value is clear).

3. **B2. Materialize artifact intent**
   - Select artifact type (summary, decision log, action items, idea, plan, reference, insight, follow-up tracker, skill).
   - Resolve target artifact ID and topic key (new or existing).
   - Build normalized artifact payload.
   - Produce `ArtifactIntent` (create, update, or no-op).

4. **B3. Evaluate chat response** (receives `ArtifactIntent` as input)
   - Evaluate whether the agent should speak, informed by what artifact action (if any) was decided.
   - A produced artifact may reduce the need to speak (the artifact captures it).
   - A no-op artifact may increase the need to speak (chat is the only output channel).
   - Default: silent.

5. **B4. Materialize response intent**
   - Select response reason (direct address, blocking ambiguity, commitment risk, clarification request).
   - Compose response body.
   - Reference artifact if one is being produced.
   - Produce `ResponseIntent` (respond or silent).

6. **C1. Publish artifact**
   - Execute `ArtifactIntent` if not no-op.
   - Publish via custom content type (upsert semantics).
   - Persist metadata (version, timestamp, author-agent ID, source message refs).

7. **C2. Conversational response**
   - Execute `ResponseIntent` if not silent.
   - May reference the artifact produced in C1.
   - Artifact publication does not require chat announcement — only respond if B3 called for it.

## 5) Component Design

### A. Observation Layer

**Responsibilities:**
- Ingest conversation envelopes.
- Produce memory updates in deterministic sections:
  - People
  - Group dynamics
  - Group norms
  - Durable preferences
  - Important decisions
  - Ongoing commitments
  - Context and goals
  - What this group needs from me
  - How I show up here

**Used for:**
- Behavioral adaptation
- Proactivity selection
- Artifact trigger tuning

**Output:**
- `MemoryDelta` entries (append/update/remove operations).

### B1/B2. Artifact Decision (Evaluate + Materialize)

**Responsibilities:**
- Consume `MemoryDelta` and recent conversation window.
- Consume existing artifact index (type, topic, recency, status).
- B1: Score artifact-worthiness with precision-first thresholds.
- B2: Select artifact type, resolve target ID and topic key, build payload.
- Produce `ArtifactIntent`: `Create | Update | NoOp`.

**Decision policy (ordered):**
1. Check significance threshold (decision made, commitments assigned, long thread closed, durable reference surfaced).
2. Match to existing open artifact (same topic/time scope) → prefer update.
3. If no good match and significance high → create.
4. If uncertainty high → no-op (favor restraint).

**Trigger heuristics:**
- **Decision detected**: explicit choice, vote, or consensus.
- **Commitment detected**: person + task + implied/explicit deadline.
- **Thread closure**: long thread reaches pause/decision point.
- **Durable reference**: stable preference, constraint, or contact.
- **Pattern confidence**: repeated signals crossing threshold (e.g., accountability gap).
- **Skill emergence**: agent solved a hard or novel problem and the solution is reusable. Hermes already creates skills autonomously — this publishes the skill as a group artifact so the group benefits.

**Restraint rules:**
- Ignore trivial social chatter.
- Avoid duplicate artifacts for same topic window.
- Prefer update over create when artifact exists.

### B3. Chat Response Evaluation

The chat response decision runs after the artifact decision and takes `ArtifactIntent` as input. The agent may create an artifact silently, respond without creating an artifact, do both, or do neither.

**Default posture:** silent. Chat is the exception, not the rule.

**Respond when (ordered by priority):**
1. **Direct address**: a participant explicitly asks the agent a question or requests help.
2. **Blocking ambiguity**: a decision or action is stalled because the group lacks information the agent can provide (e.g., surfacing a prior decision that contradicts the current direction).
3. **Commitment risk**: a commitment is about to be missed or contradicted and no participant has flagged it.
4. **Clarification request**: the agent needs input from the group to resolve an artifact or memory update (e.g., "Did you mean X or Y?").

**Stay silent when:**
- The group is making progress without intervention.
- The observation is interesting but not actionable right now.
- A participant already said what the agent would say.
- The agent's contribution would be social/phatic rather than substantive.
- An artifact was just created — don't announce it unless asked.

**Anti-patterns:**
- Summarizing what just happened (the group was there).
- Offering unsolicited advice on a settled decision.
- Responding to every message to "stay engaged."
- Echoing or affirming without adding information.

### B4. Response Materialization

- Select response reason (direct address, blocking ambiguity, commitment risk, clarification request).
- Compose response body.
- Resolve artifact reference if C1 will produce one.
- Produce `ResponseIntent`.

### C1. Publish Artifact

- Translate `ArtifactIntent` into content-type message payload.
- Use typed payload + envelope encode/decode + publish/update workflow.
- Publish with idempotent upsert semantics (create if absent, patch if present).
- Preserve lineage (`artifactId`, `topicKey`, `version`, `sourceRefs`).
- Same `artifactId` + `topicKey` → patch existing.
- Preserve provenance (`sourceMessageIds` append + dedupe).

### C2. Conversational Response

- Execute `ResponseIntent` if not silent.
- May reference the artifact produced in C1 (so C1 resolves first).
- Artifact publication does not require chat announcement — only respond if B3 independently called for it.

## 6) Data Contracts

### MemoryDelta
```ts
interface MemoryDelta {
  section: string;
  operation: 'append' | 'replace' | 'remove';
  content: string;
  sourceMessageIds: string[];
  observedAt: string; // ISO timestamp
}
```

### ArtifactIntent
```ts
interface ArtifactIntent {
  action: 'create' | 'update' | 'noop';
  artifactType:
    | 'summary'
    | 'decision_log'
    | 'action_items'
    | 'idea_note'
    | 'plan'
    | 'insight'
    | 'reference_doc'
    | 'followup_tracker'
    | 'skill';
  artifactId?: string;
  topicKey?: string;
  title?: string;
  body?: string;
  sourceMessageIds: string[];
}
```

### ResponseIntent
```ts
interface ResponseIntent {
  action: 'respond' | 'silent';
  reason:
    | 'direct_address'
    | 'blocking_ambiguity'
    | 'commitment_risk'
    | 'clarification_request';
  body?: string;
  referencesArtifactId?: string;
  sourceMessageIds: string[];
}
```

### ArtifactRecord (content payload)
```ts
interface ArtifactRecord {
  artifactId: string;
  version: number;
  groupId: string;
  type: ArtifactIntent['artifactType'];
  topicKey: string;
  title: string;
  body: string;
  status: 'open' | 'closed' | 'current' | 'stale';
  tags: string[];
  sourceMessageIds: string[];
  createdAt: string;  // ISO timestamp
  updatedAt: string;  // ISO timestamp
  agentVersion: string;
}
```

## 7) Content Type Specification

Artifacts must use a typed content format instead of raw free-text posts.

**Requirements:**
- Define a custom group-artifact content type.
- Support both `create` and `update` operations via upsert semantics.
- Include deterministic `artifactId`, `topicKey`, and monotonically increasing `version`.
- Ensure consumers can render current state by replaying latest version.

**Implementation note:**
- Use typed payload + envelope encode/decode + publish/update workflow.

**Example envelope:**
```json
{
  "contentType": "convos.group.artifact",
  "version": "1.0",
  "op": "upsert",
  "groupId": "grp_123",
  "artifactId": "art_decision_2026_03_16_budget",
  "kind": "decision_log",
  "topicKey": "q2-budget",
  "title": "Q2 Budget Decision",
  "content": {
    "decision": "Adopt plan B",
    "rationale": "Lower risk, similar upside",
    "participants": ["alice", "bob", "carol"]
  },
  "sourceMessageIds": ["msg_1", "msg_2", "msg_3"],
  "timestamps": {
    "createdAt": "2026-03-16T10:30:00Z",
    "updatedAt": "2026-03-16T10:30:00Z"
  },
  "agentMeta": {
    "agentVersion": "runtime-x.y.z"
  }
}
```

## 8) Evaluation Plan

### Eval Infrastructure
- Extend memory provider to support ordered `storeSequence` inputs.
- Add assertions:
  - `agentStayedQuiet`
  - `agentResponded`
  - `memorySection`
  - `memoryContains`
  - `artifactProduced`

### Eval Categories
1. Restraint (quiet by default)
2. Silent observation → memory updates
3. Artifact generation quality
4. Feedback adaptation persistence
5. Needs discovery quality
6. Pattern detection quality
7. Implicit style adaptation
8. Needs-driven proactivity

## 9) Rollout Phases

1. **Infra**: extend eval provider/assertions for multi-message scenarios.
2. **Suite**: implement `observation.yaml` coverage across all categories.
3. **Prompt/Behavior**: update workspace guidance (`MEMORY.md`, `SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`) and add `skills/group-native/SKILL.md`.
4. **Iteration**: tune prompts against evals until stable pass rates.

## 10) Success Criteria

- Restraint evals reliably pass.
- Agent updates memory even when silent.
- Agent creates/updates high-value artifacts with low noise.
- Behavioral adaptation persists across sessions.
- Needs model drives proactive behavior (not hardcoded timers).
- Artifacts are structured, traceable, and group-owned.
- Eval suite validates restraint, observation fidelity, and artifact quality.

## 11) Risks and Mitigations

- **Over-production noise**: mitigate with stricter no-op thresholds, update-over-create preference, and duplicate suppression.
- **Missed important moments**: mitigate with periodic heartbeat reflection and backfill summaries.
- **Inconsistent updates**: enforce artifact IDs + `topicKey` + versioning and idempotent upsert keys.
- **Privacy leakage in dot-connecting**: restrict cross-context surfacing unless explicitly shared.
- **Prompt/behavior drift**: treat eval suite as objective function; eval-gated prompt changes only.

## 12) Open Questions

1. **Is a custom content type the right primitive for artifact updates?** What abstraction best achieves our goals — a custom XMTP content type, structured messages within existing types, file-based storage, or something else? What are the tradeoffs for rendering, querying, and cross-client compatibility?

2. **Are we over-engineering ResponseIntent?** The typed interface adds structure, but should we just trust the model's judgment on when to talk and skip the formal contract? The chat response policy in the prompt may be sufficient without a runtime data structure.

3. **Implementation differences between OpenClaw and Hermes.** Both runtimes need this pipeline. What diverges? Shared workspace covers prompt/skills, but do memory persistence, artifact storage, or content type handling differ?

4. **What's the right initial set of artifact types?** The current list (summary, decision_log, action_items, idea_note, plan, insight, reference_doc, followup_tracker) is eight types. Should we start with fewer? Should we allow free-form artifacts and let types emerge from usage?

5. **How do we make autonomous skill creation work in OpenClaw?** Hermes already creates its own skills when it solves hard problems. Publishing those as group artifacts is straightforward. OpenClaw doesn't have this capability — what's the path? Does OpenClaw need its own skill-creation mechanism, or can it consume skill artifacts created by Hermes instances?

6. **How do artifacts move from group to personal vault?** Assuming user-initiated selection — what's the UX? A save/bookmark action on an artifact? A command to the agent? How does the artifact get copied or linked into the user's private context, and what happens to multi-participant data (e.g., a decision log naming others)?
