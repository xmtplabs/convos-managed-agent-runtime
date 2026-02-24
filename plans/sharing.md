**Date:** 2026-02-22
**Status:** Draft

---

---

## Product Goals

**Enable two types of agent sharing on Convos: template sharing and instance sharing.**

Agents get better the more you use them. Every conversation teaches an agent something — preferences, context, judgment. Today that knowledge is trapped in a single conversation.

Agent sharing turns agents into a marketplace. Creators build and train specialized agents — a travel planner, a restaurant booker, a crypto trader — and publish them for anyone to use. Users browse a store and add an agent to their conversation the same way they'd add a friend. Creators get distribution. Users get capable, trained agents without building anything. The more people use an agent, the more feedback the creator gets to make it better. This is how an agent economy starts.

### The creator journey

```
Build privately → Train through conversation → Share with friends
       ↑                                            |
       |                                            v
  Update template ← Train more ← Get feedback ←────┘
       |
       v
  Publish to store (when ready)
       ↑                  |
       |                  v
  Update template ← Users personalize & use
```

1. **Creators build and train agents privately.** Create a template, spin up an instance in a private conversation, and iterate. Refine the instructions, teach it through conversation, get it right before anyone else sees it.
2. **Share trained instances with friends first.** Clone the agent — with its accumulated knowledge — into a group conversation. This is instance sharing: the agent carries what it's learned. Friends interact with a trained agent, not a blank slate.
3. **Keep training, keep sharing.** Every conversation teaches the agent more. Clone it into more conversations as it improves. Update the template instructions and all instances sync.
4. **Publish to the store when ready.** Templates are private by default. Publishing is a deliberate act — the creator decides when the agent is good enough for everyone. The store is the last step, not the first.
5. **Template updates propagate.** After publishing, the creator keeps improving. Instruction updates push to all running instances — both the creator's own and copies from the store.

### Sharing templates

1. **Users browse and add agents like contacts.** No technical knowledge needed. Tap to add, the agent joins your conversation fresh and ready.
2. **Each copy is independently personalizable.** The template is the starting point. Users teach their copy through conversation — preferences, names, context. The agent becomes theirs.

### Sharing trained instances

1. **Agents carry what they've learned.** When you bring an agent into a new conversation, it arrives with a summary of everything it knows. This is how both creators and users move agents between conversations.
2. **Instance owners control their context.** The person who's been using the agent owns its accumulated context. Only they can authorize sharing it — whether they're the template creator or a user who personalized a copy from the store.
3. **Context transfer is end-to-end encrypted.** Summaries travel as private XMTP groups between agents. The pool never sees the content. No one in either conversation sees the transfer.

Monetization is out of scope for now. Start with distribution and usage.

## User Stories

### Creator

| # | Story | Flow |
| --- | --- | --- |
| C1 | As a creator, I can create a template with instructions and skill config | Template CRUD |
| C2 | As a creator, I can instantiate my template into a conversation | Template sharing (private) |
| C3 | As a creator, I can improve my agent by talking to it in conversation | Normal usage |
| C4 | As a creator, I can clone my trained agent (with context) into a new conversation | Instance sharing |
| C5 | As a creator, I can publish my template to the agent store | Visibility toggle |
| C6 | As a creator, I can update my template's instructions and all instances sync | Instruction sync |
| C7 | As a creator, I can see all instances running from my template | Dashboard |

### User

| # | Story | Flow |
| --- | --- | --- |
| U1 | As a user, I can browse the agent store and add a public template to my conversation | Template sharing (public) |
| U2 | As a user, I can personalize the agent through conversation (name, preferences, context) | Normal usage |
| U3 | As a user, I can clone my personalized agent (with context) into a different conversation | Instance sharing |
| U4 | As a user, I receive instruction updates when the template creator pushes them | Instruction sync |

C4 and U3 are the same operation. Context transfer is authorized by the **instance owner** — the person who's been in conversation with the agent — not the template creator. The template creator owns the template; the instance owner owns the instance's accumulated context.

## Functional Requirements

### Templates

1. Creators can create, update, and delete templates containing agent name, instructions, and skill config.
2. Templates are private by default. Creators can publish them to the agent store (public) or unpublish them.
3. Anyone can instantiate a public template into a conversation. Private templates can only be instantiated by their creator.
4. Instantiating a template provisions a fresh agent instance with no conversation history.

### Instances

1. Each instance tracks its owner — the person who claimed it — separately from the template creator.
2. An instance receives its instructions from its template. When the template creator updates instructions, all live instances sync automatically.
3. Instruction sync is push-based: the pool fans out updates to instances immediately.
4. Instances write updated instructions to [IDENTITY.md](http://identity.md/) so the agent picks them up on the next turn.

### Instance sharing (clone with context)

1. Instance owners can clone a running instance into a new conversation. The clone inherits the template's instructions plus summarized context from the parent.
2. Only the instance owner can authorize a clone. Authorization requires the owner's XMTP identity signature.
3. The parent instance generates the context summary (LLM call) and sends it to the child as a private 2-agent XMTP group — encrypted end-to-end, never passing through the pool.
4. The child instance recognizes the parent DM, ingests the summary, and begins participating with inherited context.
5. The pool acts as a trustless relay: it orchestrates provisioning and routes the clone request but never sees context or validates authorization signatures.

### Lineage

1. Each instance tracks which instance it was cloned from (`parent_instance`).
2. Template creators can see how many instances are running from their template on the dashboard.

## Data Model

### New table: `agent_templates`

```sql
CREATE TABLE agent_templates (
  id            TEXT PRIMARY KEY,           -- nanoid
  creator_id    TEXT NOT NULL,              -- XMTP inbox ID of the creator
  agent_name    TEXT NOT NULL,              -- display name
  instructions  TEXT NOT NULL,              -- system prompt
  model         JSONB NOT NULL DEFAULT '{"default": "gpt-oss-20b", "allow_override": true}',
  tools         JSONB NOT NULL DEFAULT '[]', -- tool declarations (see schema below)
  visibility    TEXT NOT NULL DEFAULT 'private',  -- 'private' or 'public'
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
```

### Template tool schema

Each entry in the `tools` array declares a tool the agent needs and how its config is provisioned:

```json
{
  "tools": [
    {
      "id": "sms",
      "name": "SMS (Telnyx)",
      "provisioning": "pool",
      "description": "Agent gets a dedicated phone number for sending/receiving SMS"
    },
    {
      "id": "email",
      "name": "Email (AgentMail)",
      "provisioning": "pool",
      "description": "Agent gets a dedicated email inbox"
    },
    {
      "id": "crypto",
      "name": "Crypto (Bankr)",
      "provisioning": "pool",
      "description": "Agent gets a wallet for crypto transactions"
    },
    {
      "id": "personal-email",
      "name": "Your email address",
      "provisioning": "user",
      "prompt": "What email address should the agent send from?",
      "required": false
    }
  ]
}
```

**`provisioning` values:**

- `"pool"` — the pool creates and manages the resource per instance (e.g. new Telnyx number, new AgentMail inbox). User doesn't need to provide anything.
- `"user"` — the user provides the value at claim time. The client reads the `prompt` field and asks the user before claiming.

Pool-owned config (browser API keys, OpenRouter) is not declared in the template — it's invisible infrastructure.

**Model configuration:**

The template sets a default model. Users can override at claim time.

```json
{
  "model": {
    "default": "gpt-oss-20b",
    "allow_override": true
  }
}
```

**Example: "Tokyo Trip Planner" template**

```json
{
  "agent_name": "Trip Planner",
  "instructions": "You are a travel planning assistant. You help groups plan trips...",
  "model": { "default": "gpt-oss-20b", "allow_override": true },
  "tools": [
    { "id": "sms", "provisioning": "pool" },
    { "id": "email", "provisioning": "pool" },
    { "id": "personal-email", "provisioning": "user",
      "prompt": "Your email for booking confirmations?", "required": true }
  ]
}
```

At claim time, the client sees the default model (overridable), pool-provisioned tools (SMS, Email — no user action needed), and user-supplied fields (personal email — prompts the user).

### Modified table: `agent_metadata`

```sql
ALTER TABLE agent_metadata
  ADD COLUMN template_id      TEXT REFERENCES agent_templates(id),
  ADD COLUMN owner_id         TEXT,           -- XMTP inbox ID of instance owner
  ADD COLUMN parent_instance  TEXT;
```

### Relationships

- `agent_templates` (1) to many `agent_metadata` (instances)
- When an instance has a `template_id`, it gets instructions from the template
- `owner_id` is the XMTP inbox ID of whoever claimed the instance — authorizes context transfer
- `parent_instance` tracks which instance was cloned from (lineage)
- Template `creator_id` authorizes template operations (CRUD, publish, instruction sync)
- Instance `owner_id` authorizes context operations (clone with context)

## Template Sharing: Instantiate from Store (no context)

Anyone can instantiate a public template. No signature required. The agent starts fresh.

```
USER in CONVOS CLIENT (new conversation)
    |
    |  1. Taps "Add agent" -> browses agent store (or own templates)
    |     Public: GET /api/pool/templates?visibility=public
    |     Own:    GET /api/pool/templates?creator={inbox_id}
    |
    |  2. Selects a template (e.g. "Tokyo Trip Planner")
    |     Client reads template schema:
    |     - model: shows default, allows override if allow_override=true
    |     - tools with provisioning="user": prompts user to fill in
    |     - tools with provisioning="pool": no user action needed
    |
    |  3. Client calls pool:
    |     POST /api/pool/claim
    |     {
    |       requester: "user-inbox-id",
    |       templateId: "tmpl_456",
    |       conversationId: "convo-hex",
    |       model: "gpt-oss-20b",              // default or user override
    |       userConfig: {                       // user-supplied tool values
    |         "personal-email": "saul@example.com"
    |       }
    |     }
    |
    v
POOL
    |  4. Checks template visibility:
    |     - public: anyone can instantiate
    |     - private: verifies requester == creator_id
    |  5. Provisions pool-managed tools (new Telnyx number, AgentMail inbox, etc.)
    |  6. Claims idle instance, configures with:
    |     - template instructions
    |     - selected model
    |     - pool-provisioned tool credentials
    |     - user-supplied config values
    |  7. Sets owner_id = requester on the new instance
    |  8. Instance joins conversation via invite link
    |  9. Returns { instanceId }
```

No context transfer. No parent instance involved. The agent has the template's instructions, its provisioned tools, and user-supplied config. The requester becomes the instance owner — they can later clone it with context into other conversations.

## Instance Sharing: Clone with Context (instance owner only)

The instance owner — whoever claimed and has been using the agent — can authorize context transfer. Requires owner signature.

```
INSTANCE OWNER in CONVOS CLIENT (new conversation)
    |
    |  1. Taps "Add agent" -> "My agents" -> sees their running instances
    |     GET /api/pool/agents?owner={owner_inbox_id}
    |     Shows live instances they own, across all templates
    |
    |  2. Selects a running instance (e.g. "Tokyo Trip Planner" in Convo A)
    |     Client shows clone config:
    |     - model: pre-filled from parent, can override
    |     - pool-provisioned tools: re-provisioned fresh (new number, new inbox)
    |     - user-supplied config: pre-filled from parent, can override
    |     - context prompt: "What should the agent bring with it?"
    |     Client signs the clone request with owner's XMTP key
    |
    |  3. Client calls pool:
    |     POST /api/pool/claim
    |     {
    |       requester: "owner-inbox-id",
    |       templateId: "tmpl_456",
    |       conversationId: "convo-B-hex",
    |       cloneFrom: "abc123",            // parent instance ID
    |       model: "gpt-oss-20b",           // carried or overridden
    |       userConfig: {                   // carried or overridden
    |         "personal-email": "saul@example.com"
    |       },
    |       contextPrompt: "General travel knowledge but not Japan trip details",
    |       ownerSignature: "0x..."      // proves instance owner authorized this
    |     }
    |
    v
POOL
    |  4. Checks requester == parent instance's owner_id
    |     (Basic ID check — signature is verified by the parent, not the pool)
    |  5. Provisions fresh pool-managed tools (new Telnyx number, new AgentMail inbox)
    |  6. Claims idle instance, configures with:
    |     - template instructions
    |     - selected model
    |     - fresh pool-provisioned tool credentials
    |     - user-supplied config (carried or overridden from parent)
    |  7. Sets owner_id = requester on the child instance
    |  8. Sets parent_instance = cloneFrom on the child instance
    |  9. Child joins new conversation via invite link
    |     -> GroupUpdated system message: "Agent joined by invite"
    |  10. Returns { instanceId } to client
    |
    |  11. Pool tells parent: "send summary to child via DM"
    |      POST parent.url/pool/clone-summary
    |      {
    |        childInboxId: "0x...",
    |        contextPrompt: "Bring your general travel knowledge but not the Japan trip details",
    |        ownerSignature: "0x..."       // passed through for parent to verify
    |      }
    |
    v
PARENT INSTANCE
    |  12. Verifies owner signature against its owner_id
    |  13. Generates context summary using the owner's contextPrompt as the directive
    |  14. Creates private 2-agent XMTP group to child's inbox ID
    |  15. Sends summary as DM message
    |      -> Encrypted E2E, pool never sees content
    |      -> No one in any conversation sees this
    |
    v
CHILD INSTANCE (already in new conversation)
    |  16. Receives DM from parent's inbox ID
    |  17. Recognizes sender as parent (parent_instance in its config)
    |  18. Ingests summary into its working context
    |  19. Ready to participate with inherited knowledge
```

### User experience

**Instantiate (Template sharing):** Browse agent store -> tap to add -> agent appears fresh
**Clone with context (Instance sharing):** Pick one of your running agents -> agent appears with context from its previous life

This flow is the same whether you're a template creator cloning your own agent (C4) or a user cloning an agent they instantiated from the store (U3). The authorization is: you own the instance, you own its context.

### Pool's role in authorization

The pool does a basic ID check (requester == owner_id) as a fast rejection of obviously unauthorized requests. But the real authorization is the owner signature, which the pool passes through to the parent instance for cryptographic verification. The pool never validates the signature itself — it's a convenience gate, not a trust boundary.

## Template Sync

When the creator updates a template, all live instances pick up the change.

```
CREATOR (Dashboard or API)
    |
    |  PUT /api/pool/templates/{templateId}
    |  { instructions: "Updated prompt...",
    |    model: { "default": "gpt-oss-30b", "allow_override": true },
    |    tools: [...] }
    |  + creatorSignature
    |
    v
POOL
    |  1. Verifies creator signature, updates agent_templates row
    |  2. Finds all live instances with this template_id
    |  3. Fans out to each instance:
    |     POST instance.url/pool/update-template
    |     {
    |       instructions: "Updated prompt...",
    |       model: { "default": "gpt-oss-30b", "allow_override": true },
    |       tools: [...],
    |       templateUpdatedAt: "2026-02-22T...",
    |       creatorSignature: "0x..."
    |     }
    |
    v
EACH INSTANCE
    |  4. Verifies creator signature
    |  5. Writes updated instructions to IDENTITY.md
    |  6. Updates model config (if instance hasn't overridden it)
    |  7. Updates tool config (may require pool to provision/deprovision tools)
    |  8. Next agent turn picks up changes
```

- Push-based, not polling. Pool fans out immediately.
- Creator signature travels end-to-end. Instances verify directly.
- [IDENTITY.md](http://identity.md/) is the existing mechanism for instructions (no new file or reload path).
- **Model sync respects user overrides.** If the user chose a different model at claim time, the creator's update doesn't overwrite it.
- **Tool changes may require provisioning.** If the creator adds a new pool-provisioned tool (e.g. adds SMS to a template that didn't have it), the pool needs to provision the resource for each existing instance. Removing a tool may require cleanup.
- Eventual consistency: pool retries unreachable instances on next health check.

## Authorization

### Trust model

Two axes of authorization:

**Template operations → template creator signs**

- Create, update, delete, publish templates
- Push instruction updates to all instances
- Creator signs with their XMTP identity key; instances verify directly

**Context operations → instance owner signs**

- Clone an instance with accumulated context
- The instance owner is whoever claimed and has been conversing with the agent
- Pool does a basic ID check (requester == owner_id) for fast rejection
- Owner signature is passed through to the parent instance for cryptographic verification
- A template creator cloning their own agent is just a special case where creator == owner

**Template instantiation → no signature**

- Public templates: anyone can instantiate, no signature needed
- Private templates: pool checks requester inbox == creator_id (no crypto signature, just an ID check — no sensitive data involved)
- Requester becomes the instance owner (`owner_id`)

**Context is E2E encrypted.** Summaries travel as private XMTP groups between agents. Never stored in pool DB. Never visible to conversation members. The pool does basic ID checks but the cryptographic trust boundary is at the instance level.

### Attack surface

| Threat | Mitigation |
| --- | --- |
| Stranger instantiates private template | Pool checks requester inbox == creator_id |
| Unauthorized context transfer | Instance owner signature required; parent verifies before sending summary |
| User clones someone else's instance | Parent checks owner signature against its owner_id — rejects |
| Pool exfiltrates context | Pool never sees summary content (E2E encrypted XMTP DM) |
| Forged instruction update | Instances verify template creator signature; pool can't forge |
| Replay attack | Signature includes timestamp; tokens are single-use |

## What stays the same

- Pool provisioning flow (claim idle instance -> provision -> join)
- Instance lifecycle (health checks, cleanup, replenishment)
- Convos extension (agent serve, message handling)
- Per-instance resources (wallet, OpenRouter key, AgentMail inbox)
- XMTP group membership (agents join via invite link, same as today)

## New API endpoints

### Pool API

- `GET /api/pool/templates?visibility=public` — browse agent store
- `GET /api/pool/templates?creator={inbox_id}` — list creator's templates
- `POST /api/pool/templates` — create a template (private by default)
- `PUT /api/pool/templates/{id}` — update template (triggers instruction sync)
- `PATCH /api/pool/templates/{id}/visibility` — publish to store or make private
- `DELETE /api/pool/templates/{id}` — delete template
- `POST /api/pool/claim` — extended with `templateId`, optional `cloneFrom` + `ownerSignature`

### Instance API

- `POST /pool/clone-summary` — receive clone request, send summary to child via private 2-agent group
- `POST /pool/update-template` — receive template update (instructions, model, tools), apply changes

## New capabilities needed

- **Context summarization**: LLM call on the parent instance to generate a summary of accumulated knowledge
- **Agent-to-agent context transfer**: Parent creates a private 2-agent XMTP group with the child and sends the summary
- **Signature verification**: Instances verify XMTP signatures — creator signatures for instruction updates, owner signatures for context transfers
- **Template CRUD**: Dashboard UI for managing templates
- **"Add existing agent" UI**: Convos client flow for selecting a template or running instance

## Open Questions

### Multi-conversation instances vs. cloning

This design assumes cloning: creating a new instance and transferring a memory summary. But why not just add the same running instance to a second conversation?

**What it would simplify:**

- No memory transfer, no summarization, no 2-agent groups, no memoryPrompt
- No provisioning delay — the agent is already running
- No lossy compression — the agent has its full knowledge, not a summary of it
- No second Railway service or resource provisioning

**Concerns:**

- The current architecture is 1 instance = 1 conversation = 1 `convos agent serve` process. Multi-conversation support is a significant change to the Convos extension and the pool lifecycle.
- Context bleed — an agent in both a Japan trip convo and a Greece trip convo might mix details between the two. The owner might want this, but other members of each conversation didn't sign up for it.
- Privacy — members of Convo A didn't consent to the agent knowing things from Convo B. Even though XMTP messages are E2E encrypted per-conversation, the agent itself has access to both.
- Tool sharing — one phone number, one email across all conversations. Sometimes desirable, sometimes not.
- Concurrency — one agent handling multiple active conversations simultaneously.

**Could we support both?** "Add to conversation" for when you want the same agent with full continuity. "Clone" for when you want a separate copy with selective memory and independent tool config. These serve different use cases — but supporting both adds complexity.

This question should be resolved before implementation. If multi-conversation instances are viable, the instance sharing flow simplifies dramatically. If not, the current cloning design is the right approach.

### Context summarization

- **What goes in the summary?** An agent accumulates three kinds of knowledge:
    1. **Training** — things that make it better at its job. "Don't suggest chains, only local restaurants." "Always confirm the date before booking."
    2. **Personalization** — user/group preferences. "Saul is vegetarian." "Our hotel is in Shinjuku."
    3. **Credentials** — phone numbers, API keys, account details. "Use this Telnyx number for SMS."

    None of these categories are cleanly "always carry" or "never carry." It depends on context. A travel agent trained for Japan might be cloned for a Greece trip — it should carry general travel knowledge and dietary preferences, but not the Shinjuku hotel or the Japan phone number. Then the owner sets up a new phone number during Greece training and wants *that* to carry when cloning into the group chat with trip buddies.

    This suggests the owner should be able to guide what carries over at clone time. Should the template creator also define default summarization directives?


### Agent-to-agent context transfer

- **Creating groups from agents.** The Convos extension currently operates within a single conversation. The parent needs to create a new 2-agent group with the child's inbox ID. What `convos agent serve` CLI support is needed for this?
- **Child identification.** The child knows its `parent_instance` config value, but needs to map that to the parent's XMTP inbox ID to recognize incoming context. The pool should provide the parent's inbox ID at provisioning time.

### Authorization

- **XMTP signature format.** What exactly is signed? What fields, what encoding, what key type? Needs to align with XMTP v3 identity key capabilities.
- **Signature verification on instances.** Instances currently don't have the XMTP SDK available for signature verification. This is a new runtime dependency.

### Ownership

- **Can ownership transfer?** If the original owner leaves a conversation, can they hand the instance to someone else?
- **What happens to clones when the parent is killed?** The child has already received its summary — does it continue independently? Does lineage tracking still matter if the parent is gone?
- **Multi-owner scenarios.** If a group conversation has multiple admins, can only the original claimer clone, or should conversation admins also be able to?

### Tool configuration and cloning

There are three ownership tiers for tool config:

1. **Pool-owned** — shared infrastructure the pool provides to all instances. E.g. API keys for browser automation, OpenRouter keys. The instance doesn't know or care about these.
2. **Instance-owned, pool-provisioned** — the pool creates a unique resource per instance. E.g. a new Telnyx phone number, a new AgentMail inbox. The pool manages the lifecycle (create on provision, delete on cleanup).
3. **Instance-owned, user-supplied** — the user provides their own value at claim time. E.g. their personal email address, their own API key for a service.

Open questions:

- **How does this map to cloning?** Pool-owned config is always fresh (new instance, new keys). Pool-provisioned config could either carry over or be re-provisioned — does the clone get the same Telnyx number or a new one? User-supplied config presumably needs to be re-specified at clone time, but the owner might want to keep the same values.
- **How does the user supply config at claim time?** The template's `tools` declares what tools are available. Does it also declare which fields are user-supplied? Does the client prompt the user to fill them in before claiming?
- **How is this structured?** Today these are flat env vars. We need a representation that distinguishes the three tiers so the pool knows what to provision, the client knows what to prompt for, and the clone flow knows what to carry vs. re-create vs. ask for again.

### Template store

- **Discovery and curation.** How do users find good agents? Search? Categories? Featured/curated? Usage counts?
- **Abuse prevention.** What stops someone from publishing a malicious or spammy template? Reporting? Review process? Rate limits?
- **Template versioning.** When a creator updates instructions, all instances sync. But what if a user liked the old version? Is there a need for pinning or version history?