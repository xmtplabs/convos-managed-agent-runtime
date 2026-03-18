import {
  defineMachine,
  enumType,
  eq,
  lit,
  not,
  scalarVar,
  setVar,
  variable
} from "tla-precheck";

const status = variable("status");

export const instanceMachine = defineMachine({
  version: 2,
  moduleName: "Instance",
  variables: {
    status: scalarVar(enumType("draft", "active", "cancelled"), lit("draft"))
  },
  actions: {
    activate: {
      params: {},
      guard: eq(status, lit("draft")),
      updates: [setVar("status", lit("active"))]
    },
    cancel: {
      params: {},
      guard: eq(status, lit("active")),
      updates: [setVar("status", lit("cancelled"))]
    },
    reset: {
      params: {},
      guard: eq(status, lit("cancelled")),
      updates: [setVar("status", lit("draft"))]
    }
  },
  invariants: {
    // Example: an invariant that is always checked across every reachable state
    // noCancelledDrafts: {
    //   description: "Cancelled items were once active",
    //   formula: not(eq(status, lit("impossible")))
    // }
  },
  proof: {
    defaultTier: "pr",
    tiers: {
      pr: {
        domains: {},
        budgets: {
          maxEstimatedStates: 100,
          maxEstimatedBranching: 10
        }
      }
    }
  }
});

export default instanceMachine;
