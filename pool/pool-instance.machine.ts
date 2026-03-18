import {
  defineMachine,
  enumType,
  boolType,
  eq,
  and,
  or,
  not,
  lit,
  param,
  index,
  mapVar,
  setMap,
  variable,
  forall,
  isin,
  setOf,
  ids,
} from "tla-precheck";

// ── Variables ──────────────────────────────────────────────────────────────────
// References for use in guards and invariants
const status = variable("status");
const hasConvo = variable("hasConvo");
const runtimeClean = variable("runtimeClean");

export const poolInstanceMachine = defineMachine({
  version: 2,
  moduleName: "PoolInstance",

  variables: {
    // DB status column — the 9 real statuses from schema.ts
    status: mapVar(
      "Instances",
      enumType(
        "starting",
        "idle",
        "claiming",
        "pending_acceptance",
        "claimed",
        "tainted",
        "crashed",
        "dead",
        "sleeping",
      ),
      lit("starting"),
    ),

    // Whether the runtime actually has an active conversation
    // (can diverge from DB status — that's what tainted captures)
    hasConvo: mapVar("Instances", boolType(), lit(false)),

    // Whether the runtime reports clean after a reset attempt
    // true = safe to return to idle, false = dirty/tainted
    runtimeClean: mapVar("Instances", boolType(), lit(true)),
  },

  actions: {
    // ── Deploy lifecycle ────────────────────────────────────────────────────

    // Health check passes on a freshly deployed or recovered instance
    becomeIdle: {
      params: { i: "Instances" },
      guard: and(
        isin(
          index(status, param("i")),
          setOf(lit("starting"), lit("sleeping"), lit("dead")),
        ),
        eq(index(runtimeClean, param("i")), lit(true)),
      ),
      updates: [setMap("status", param("i"), lit("idle"))],
    },

    // Deploy fails or gets stuck while unclaimed
    failWhileUnclaimed: {
      params: { i: "Instances" },
      guard: isin(
        index(status, param("i")),
        setOf(lit("starting"), lit("idle")),
      ),
      updates: [setMap("status", param("i"), lit("dead"))],
    },

    // Railway sleep event
    sleep: {
      params: { i: "Instances" },
      guard: isin(
        index(status, param("i")),
        setOf(lit("starting"), lit("idle")),
      ),
      updates: [setMap("status", param("i"), lit("sleeping"))],
    },

    // ── Claim flow ──────────────────────────────────────────────────────────

    // Atomic claim: FOR UPDATE SKIP LOCKED
    claim: {
      params: { i: "Instances" },
      guard: eq(index(status, param("i")), lit("idle")),
      updates: [setMap("status", param("i"), lit("claiming"))],
    },

    // Provision succeeds immediately (conversation created)
    completeClaim: {
      params: { i: "Instances" },
      guard: eq(index(status, param("i")), lit("claiming")),
      updates: [
        setMap("status", param("i"), lit("claimed")),
        setMap("hasConvo", param("i"), lit(true)),
      ],
    },

    // Join returns pending_acceptance (invite not yet accepted)
    markPendingAcceptance: {
      params: { i: "Instances" },
      guard: eq(index(status, param("i")), lit("claiming")),
      updates: [setMap("status", param("i"), lit("pending_acceptance"))],
    },

    // Pending join accepted — runtime confirms conversation
    completePendingAcceptance: {
      params: { i: "Instances" },
      guard: eq(index(status, param("i")), lit("pending_acceptance")),
      updates: [
        setMap("status", param("i"), lit("claimed")),
        setMap("hasConvo", param("i"), lit(true)),
      ],
    },

    // Pending join fails, runtime dirty
    failPendingAcceptance: {
      params: { i: "Instances" },
      guard: eq(index(status, param("i")), lit("pending_acceptance")),
      updates: [setMap("status", param("i"), lit("tainted"))],
    },

    // ── Provision failure recovery ──────────────────────────────────────────

    // Provision fails, reset proves clean → back to idle
    recoverClaimToIdle: {
      params: { i: "Instances" },
      guard: and(
        eq(index(status, param("i")), lit("claiming")),
        eq(index(runtimeClean, param("i")), lit(true)),
      ),
      updates: [
        setMap("status", param("i"), lit("idle")),
        setMap("hasConvo", param("i"), lit(false)),
      ],
    },

    // Provision fails, reset fails or runtime still dirty → crashed
    failClaim: {
      params: { i: "Instances" },
      guard: and(
        eq(index(status, param("i")), lit("claiming")),
        eq(index(runtimeClean, param("i")), lit(false)),
      ),
      updates: [setMap("status", param("i"), lit("crashed"))],
    },

    // ── Runtime failures ────────────────────────────────────────────────────

    // Deploy crashes while claimed
    crashWhileClaimed: {
      params: { i: "Instances" },
      guard: eq(index(status, param("i")), lit("claimed")),
      updates: [setMap("status", param("i"), lit("crashed"))],
    },

    // Deploy crashes while pending_acceptance (has reserved state — agent name, invite)
    crashWhilePending: {
      params: { i: "Instances" },
      guard: eq(index(status, param("i")), lit("pending_acceptance")),
      updates: [setMap("status", param("i"), lit("crashed"))],
    },

    // Conversation mismatch detected → tainted (was silent noop before PR)
    markTainted: {
      params: { i: "Instances" },
      guard: isin(
        index(status, param("i")),
        setOf(lit("claimed"), lit("idle"), lit("starting")),
      ),
      updates: [setMap("status", param("i"), lit("tainted"))],
    },

    // ── Recovery (recheck / webhook health check) ───────────────────────────

    // Recheck: runtime has matching conversation → claimed
    recheckWithConvo: {
      params: { i: "Instances" },
      guard: and(
        isin(
          index(status, param("i")),
          setOf(
            lit("crashed"),
            lit("dead"),
            lit("sleeping"),
            lit("tainted"),
            lit("pending_acceptance"),
          ),
        ),
        eq(index(hasConvo, param("i")), lit(true)),
      ),
      updates: [setMap("status", param("i"), lit("claimed"))],
    },

    // Recheck: runtime clean, no conversation → idle
    recheckCleanNoConvo: {
      params: { i: "Instances" },
      guard: and(
        isin(
          index(status, param("i")),
          setOf(
            lit("crashed"),
            lit("dead"),
            lit("sleeping"),
            lit("tainted"),
            lit("pending_acceptance"),
          ),
        ),
        eq(index(hasConvo, param("i")), lit(false)),
        eq(index(runtimeClean, param("i")), lit(true)),
      ),
      updates: [setMap("status", param("i"), lit("idle"))],
    },

    // ── Environment changes (model nondeterminism) ──────────────────────────
    // These fire only in states where the runtime is actively in use:
    // pending_acceptance, claimed, tainted, crashed.
    // Excluded: starting (not deployed), idle (pristine), claiming (atomic DB op),
    //           dead/sleeping (not running).

    // Runtime gains a conversation (join accepted, recovery, etc.)
    runtimeGainsConvo: {
      params: { i: "Instances" },
      guard: and(
        eq(index(hasConvo, param("i")), lit(false)),
        isin(
          index(status, param("i")),
          setOf(
            lit("pending_acceptance"),
            lit("claimed"),
            lit("tainted"),
            lit("crashed"),
          ),
        ),
      ),
      updates: [setMap("hasConvo", param("i"), lit(true))],
    },

    // Runtime loses a conversation (conversation ends, runtime reset)
    runtimeLosesConvo: {
      params: { i: "Instances" },
      guard: and(
        eq(index(hasConvo, param("i")), lit(true)),
        isin(
          index(status, param("i")),
          setOf(
            lit("pending_acceptance"),
            lit("claimed"),
            lit("tainted"),
            lit("crashed"),
          ),
        ),
      ),
      updates: [setMap("hasConvo", param("i"), lit(false))],
    },

    // Runtime becomes dirty (partial provision, residue)
    runtimeBecomesDirty: {
      params: { i: "Instances" },
      guard: and(
        eq(index(runtimeClean, param("i")), lit(true)),
        isin(
          index(status, param("i")),
          setOf(
            lit("pending_acceptance"),
            lit("claimed"),
            lit("tainted"),
            lit("crashed"),
          ),
        ),
      ),
      updates: [setMap("runtimeClean", param("i"), lit(false))],
    },

    // Runtime becomes clean (successful factory reset)
    runtimeBecomesClean: {
      params: { i: "Instances" },
      guard: and(
        eq(index(runtimeClean, param("i")), lit(false)),
        isin(
          index(status, param("i")),
          setOf(
            lit("pending_acceptance"),
            lit("claimed"),
            lit("tainted"),
            lit("crashed"),
          ),
        ),
      ),
      updates: [setMap("runtimeClean", param("i"), lit(true))],
    },

    // ── Manual actions ──────────────────────────────────────────────────────

    // Kill: explicit user action. Cannot kill during atomic claim.
    kill: {
      params: { i: "Instances" },
      guard: not(eq(index(status, param("i")), lit("claiming"))),
      updates: [
        setMap("status", param("i"), lit("dead")),
        setMap("hasConvo", param("i"), lit(false)),
      ],
    },
  },

  invariants: {
    // Claiming instances haven't been provisioned yet — no conversation
    claimingHasNoConvo: {
      description: "An instance in claiming status cannot have a conversation",
      formula: forall(
        "Instances",
        "i",
        or(
          not(eq(index(status, param("i")), lit("claiming"))),
          eq(index(hasConvo, param("i")), lit(false)),
        ),
      ),
    },

    // Idle instances are clean and have no conversation
    idleIsClean: {
      description: "Idle instances have no conversation and are runtime-clean",
      formula: forall(
        "Instances",
        "i",
        or(
          not(eq(index(status, param("i")), lit("idle"))),
          and(
            eq(index(hasConvo, param("i")), lit(false)),
            eq(index(runtimeClean, param("i")), lit(true)),
          ),
        ),
      ),
    },

    // Starting instances have no conversation
    startingHasNoConvo: {
      description: "Starting instances cannot have a conversation",
      formula: forall(
        "Instances",
        "i",
        or(
          not(eq(index(status, param("i")), lit("starting"))),
          eq(index(hasConvo, param("i")), lit(false)),
        ),
      ),
    },

    // Note: pendingHasNoConvo was intentionally omitted — a pending_acceptance
    // instance CAN have a conversation (join accepted, pool not yet notified).
    // recheckWithConvo and completePendingAcceptance handle this window.
  },

  proof: {
    defaultTier: "pr",
    tiers: {
      pr: {
        domains: {
          Instances: ids({ prefix: "i", size: 2 }),
        },
        budgets: {
          maxEstimatedStates: 100_000,
          maxEstimatedBranching: 10_000,
        },
      },
    },
  },
});

export default poolInstanceMachine;
