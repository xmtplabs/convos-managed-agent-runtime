---- MODULE PoolInstance ----
EXTENDS FiniteSets, Integers, TLC

\* Generated. Treat as a build artifact.
Null == "__NULL__"

CONSTANTS Instances

VARIABLES status, hasConvo, runtimeClean

vars == <<status, hasConvo, runtimeClean>>

TypeOK ==
  /\ status \in [Instances -> {"starting", "idle", "claiming", "pending_acceptance", "claimed", "tainted", "crashed", "dead", "sleeping"}]
  /\ hasConvo \in [Instances -> BOOLEAN]
  /\ runtimeClean \in [Instances -> BOOLEAN]

claimingHasNoConvo ==
  \A i \in Instances : (~(status[i] = "claiming")) \/ (hasConvo[i] = FALSE)
idleIsClean ==
  \A i \in Instances : (~(status[i] = "idle")) \/ ((hasConvo[i] = FALSE) /\ (runtimeClean[i] = TRUE))
startingHasNoConvo ==
  \A i \in Instances : (~(status[i] = "starting")) \/ (hasConvo[i] = FALSE)

becomeIdle(i) ==
  /\ i \in Instances
  /\ (status[i] \in {"starting", "sleeping", "dead"}) /\ (runtimeClean[i] = TRUE)
  /\ status' = [status EXCEPT ![i] = "idle"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
failWhileUnclaimed(i) ==
  /\ i \in Instances
  /\ status[i] \in {"starting", "idle"}
  /\ status' = [status EXCEPT ![i] = "dead"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
sleep(i) ==
  /\ i \in Instances
  /\ status[i] \in {"starting", "idle"}
  /\ status' = [status EXCEPT ![i] = "sleeping"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
claim(i) ==
  /\ i \in Instances
  /\ status[i] = "idle"
  /\ status' = [status EXCEPT ![i] = "claiming"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
completeClaim(i) ==
  /\ i \in Instances
  /\ status[i] = "claiming"
  /\ status' = [status EXCEPT ![i] = "claimed"]
  /\ hasConvo' = [hasConvo EXCEPT ![i] = TRUE]
  /\ UNCHANGED <<runtimeClean>>
markPendingAcceptance(i) ==
  /\ i \in Instances
  /\ status[i] = "claiming"
  /\ status' = [status EXCEPT ![i] = "pending_acceptance"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
completePendingAcceptance(i) ==
  /\ i \in Instances
  /\ status[i] = "pending_acceptance"
  /\ status' = [status EXCEPT ![i] = "claimed"]
  /\ hasConvo' = [hasConvo EXCEPT ![i] = TRUE]
  /\ UNCHANGED <<runtimeClean>>
failPendingAcceptance(i) ==
  /\ i \in Instances
  /\ status[i] = "pending_acceptance"
  /\ status' = [status EXCEPT ![i] = "tainted"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
recoverClaimToIdle(i) ==
  /\ i \in Instances
  /\ (status[i] = "claiming") /\ (runtimeClean[i] = TRUE)
  /\ status' = [status EXCEPT ![i] = "idle"]
  /\ hasConvo' = [hasConvo EXCEPT ![i] = FALSE]
  /\ UNCHANGED <<runtimeClean>>
failClaim(i) ==
  /\ i \in Instances
  /\ (status[i] = "claiming") /\ (runtimeClean[i] = FALSE)
  /\ status' = [status EXCEPT ![i] = "crashed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
crashWhileClaimed(i) ==
  /\ i \in Instances
  /\ status[i] = "claimed"
  /\ status' = [status EXCEPT ![i] = "crashed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
crashWhilePending(i) ==
  /\ i \in Instances
  /\ status[i] = "pending_acceptance"
  /\ status' = [status EXCEPT ![i] = "crashed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
markTainted(i) ==
  /\ i \in Instances
  /\ status[i] \in {"claimed", "idle", "starting"}
  /\ status' = [status EXCEPT ![i] = "tainted"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
recheckWithConvo(i) ==
  /\ i \in Instances
  /\ (status[i] \in {"crashed", "dead", "sleeping", "tainted", "pending_acceptance"}) /\ (hasConvo[i] = TRUE)
  /\ status' = [status EXCEPT ![i] = "claimed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
recheckCleanNoConvo(i) ==
  /\ i \in Instances
  /\ (status[i] \in {"crashed", "dead", "sleeping", "tainted", "pending_acceptance"}) /\ (hasConvo[i] = FALSE) /\ (runtimeClean[i] = TRUE)
  /\ status' = [status EXCEPT ![i] = "idle"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
runtimeGainsConvo(i) ==
  /\ i \in Instances
  /\ (hasConvo[i] = FALSE) /\ (status[i] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ hasConvo' = [hasConvo EXCEPT ![i] = TRUE]
  /\ UNCHANGED <<status, runtimeClean>>
runtimeLosesConvo(i) ==
  /\ i \in Instances
  /\ (hasConvo[i] = TRUE) /\ (status[i] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ hasConvo' = [hasConvo EXCEPT ![i] = FALSE]
  /\ UNCHANGED <<status, runtimeClean>>
runtimeBecomesDirty(i) ==
  /\ i \in Instances
  /\ (runtimeClean[i] = TRUE) /\ (status[i] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ runtimeClean' = [runtimeClean EXCEPT ![i] = FALSE]
  /\ UNCHANGED <<status, hasConvo>>
runtimeBecomesClean(i) ==
  /\ i \in Instances
  /\ (runtimeClean[i] = FALSE) /\ (status[i] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ runtimeClean' = [runtimeClean EXCEPT ![i] = TRUE]
  /\ UNCHANGED <<status, hasConvo>>
kill(i) ==
  /\ i \in Instances
  /\ ~(status[i] = "claiming")
  /\ status' = [status EXCEPT ![i] = "dead"]
  /\ hasConvo' = [hasConvo EXCEPT ![i] = FALSE]
  /\ UNCHANGED <<runtimeClean>>

Action_becomeIdle_1 ==
  /\ (status["i1"] \in {"starting", "sleeping", "dead"}) /\ (runtimeClean["i1"] = TRUE)
  /\ status' = [status EXCEPT !["i1"] = "idle"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_becomeIdle_2 ==
  /\ (status["i2"] \in {"starting", "sleeping", "dead"}) /\ (runtimeClean["i2"] = TRUE)
  /\ status' = [status EXCEPT !["i2"] = "idle"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_failWhileUnclaimed_1 ==
  /\ status["i1"] \in {"starting", "idle"}
  /\ status' = [status EXCEPT !["i1"] = "dead"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_failWhileUnclaimed_2 ==
  /\ status["i2"] \in {"starting", "idle"}
  /\ status' = [status EXCEPT !["i2"] = "dead"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_sleep_1 ==
  /\ status["i1"] \in {"starting", "idle"}
  /\ status' = [status EXCEPT !["i1"] = "sleeping"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_sleep_2 ==
  /\ status["i2"] \in {"starting", "idle"}
  /\ status' = [status EXCEPT !["i2"] = "sleeping"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_claim_1 ==
  /\ status["i1"] = "idle"
  /\ status' = [status EXCEPT !["i1"] = "claiming"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_claim_2 ==
  /\ status["i2"] = "idle"
  /\ status' = [status EXCEPT !["i2"] = "claiming"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_completeClaim_1 ==
  /\ status["i1"] = "claiming"
  /\ status' = [status EXCEPT !["i1"] = "claimed"]
  /\ hasConvo' = [hasConvo EXCEPT !["i1"] = TRUE]
  /\ UNCHANGED <<runtimeClean>>
Action_completeClaim_2 ==
  /\ status["i2"] = "claiming"
  /\ status' = [status EXCEPT !["i2"] = "claimed"]
  /\ hasConvo' = [hasConvo EXCEPT !["i2"] = TRUE]
  /\ UNCHANGED <<runtimeClean>>
Action_markPendingAcceptance_1 ==
  /\ status["i1"] = "claiming"
  /\ status' = [status EXCEPT !["i1"] = "pending_acceptance"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_markPendingAcceptance_2 ==
  /\ status["i2"] = "claiming"
  /\ status' = [status EXCEPT !["i2"] = "pending_acceptance"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_completePendingAcceptance_1 ==
  /\ status["i1"] = "pending_acceptance"
  /\ status' = [status EXCEPT !["i1"] = "claimed"]
  /\ hasConvo' = [hasConvo EXCEPT !["i1"] = TRUE]
  /\ UNCHANGED <<runtimeClean>>
Action_completePendingAcceptance_2 ==
  /\ status["i2"] = "pending_acceptance"
  /\ status' = [status EXCEPT !["i2"] = "claimed"]
  /\ hasConvo' = [hasConvo EXCEPT !["i2"] = TRUE]
  /\ UNCHANGED <<runtimeClean>>
Action_failPendingAcceptance_1 ==
  /\ status["i1"] = "pending_acceptance"
  /\ status' = [status EXCEPT !["i1"] = "tainted"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_failPendingAcceptance_2 ==
  /\ status["i2"] = "pending_acceptance"
  /\ status' = [status EXCEPT !["i2"] = "tainted"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_recoverClaimToIdle_1 ==
  /\ (status["i1"] = "claiming") /\ (runtimeClean["i1"] = TRUE)
  /\ status' = [status EXCEPT !["i1"] = "idle"]
  /\ hasConvo' = [hasConvo EXCEPT !["i1"] = FALSE]
  /\ UNCHANGED <<runtimeClean>>
Action_recoverClaimToIdle_2 ==
  /\ (status["i2"] = "claiming") /\ (runtimeClean["i2"] = TRUE)
  /\ status' = [status EXCEPT !["i2"] = "idle"]
  /\ hasConvo' = [hasConvo EXCEPT !["i2"] = FALSE]
  /\ UNCHANGED <<runtimeClean>>
Action_failClaim_1 ==
  /\ (status["i1"] = "claiming") /\ (runtimeClean["i1"] = FALSE)
  /\ status' = [status EXCEPT !["i1"] = "crashed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_failClaim_2 ==
  /\ (status["i2"] = "claiming") /\ (runtimeClean["i2"] = FALSE)
  /\ status' = [status EXCEPT !["i2"] = "crashed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_crashWhileClaimed_1 ==
  /\ status["i1"] = "claimed"
  /\ status' = [status EXCEPT !["i1"] = "crashed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_crashWhileClaimed_2 ==
  /\ status["i2"] = "claimed"
  /\ status' = [status EXCEPT !["i2"] = "crashed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_crashWhilePending_1 ==
  /\ status["i1"] = "pending_acceptance"
  /\ status' = [status EXCEPT !["i1"] = "crashed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_crashWhilePending_2 ==
  /\ status["i2"] = "pending_acceptance"
  /\ status' = [status EXCEPT !["i2"] = "crashed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_markTainted_1 ==
  /\ status["i1"] \in {"claimed", "idle", "starting"}
  /\ status' = [status EXCEPT !["i1"] = "tainted"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_markTainted_2 ==
  /\ status["i2"] \in {"claimed", "idle", "starting"}
  /\ status' = [status EXCEPT !["i2"] = "tainted"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_recheckWithConvo_1 ==
  /\ (status["i1"] \in {"crashed", "dead", "sleeping", "tainted", "pending_acceptance"}) /\ (hasConvo["i1"] = TRUE)
  /\ status' = [status EXCEPT !["i1"] = "claimed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_recheckWithConvo_2 ==
  /\ (status["i2"] \in {"crashed", "dead", "sleeping", "tainted", "pending_acceptance"}) /\ (hasConvo["i2"] = TRUE)
  /\ status' = [status EXCEPT !["i2"] = "claimed"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_recheckCleanNoConvo_1 ==
  /\ (status["i1"] \in {"crashed", "dead", "sleeping", "tainted", "pending_acceptance"}) /\ (hasConvo["i1"] = FALSE) /\ (runtimeClean["i1"] = TRUE)
  /\ status' = [status EXCEPT !["i1"] = "idle"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_recheckCleanNoConvo_2 ==
  /\ (status["i2"] \in {"crashed", "dead", "sleeping", "tainted", "pending_acceptance"}) /\ (hasConvo["i2"] = FALSE) /\ (runtimeClean["i2"] = TRUE)
  /\ status' = [status EXCEPT !["i2"] = "idle"]
  /\ UNCHANGED <<hasConvo, runtimeClean>>
Action_runtimeGainsConvo_1 ==
  /\ (hasConvo["i1"] = FALSE) /\ (status["i1"] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ hasConvo' = [hasConvo EXCEPT !["i1"] = TRUE]
  /\ UNCHANGED <<status, runtimeClean>>
Action_runtimeGainsConvo_2 ==
  /\ (hasConvo["i2"] = FALSE) /\ (status["i2"] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ hasConvo' = [hasConvo EXCEPT !["i2"] = TRUE]
  /\ UNCHANGED <<status, runtimeClean>>
Action_runtimeLosesConvo_1 ==
  /\ (hasConvo["i1"] = TRUE) /\ (status["i1"] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ hasConvo' = [hasConvo EXCEPT !["i1"] = FALSE]
  /\ UNCHANGED <<status, runtimeClean>>
Action_runtimeLosesConvo_2 ==
  /\ (hasConvo["i2"] = TRUE) /\ (status["i2"] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ hasConvo' = [hasConvo EXCEPT !["i2"] = FALSE]
  /\ UNCHANGED <<status, runtimeClean>>
Action_runtimeBecomesDirty_1 ==
  /\ (runtimeClean["i1"] = TRUE) /\ (status["i1"] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ runtimeClean' = [runtimeClean EXCEPT !["i1"] = FALSE]
  /\ UNCHANGED <<status, hasConvo>>
Action_runtimeBecomesDirty_2 ==
  /\ (runtimeClean["i2"] = TRUE) /\ (status["i2"] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ runtimeClean' = [runtimeClean EXCEPT !["i2"] = FALSE]
  /\ UNCHANGED <<status, hasConvo>>
Action_runtimeBecomesClean_1 ==
  /\ (runtimeClean["i1"] = FALSE) /\ (status["i1"] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ runtimeClean' = [runtimeClean EXCEPT !["i1"] = TRUE]
  /\ UNCHANGED <<status, hasConvo>>
Action_runtimeBecomesClean_2 ==
  /\ (runtimeClean["i2"] = FALSE) /\ (status["i2"] \in {"pending_acceptance", "claimed", "tainted", "crashed"})
  /\ runtimeClean' = [runtimeClean EXCEPT !["i2"] = TRUE]
  /\ UNCHANGED <<status, hasConvo>>
Action_kill_1 ==
  /\ ~(status["i1"] = "claiming")
  /\ status' = [status EXCEPT !["i1"] = "dead"]
  /\ hasConvo' = [hasConvo EXCEPT !["i1"] = FALSE]
  /\ UNCHANGED <<runtimeClean>>
Action_kill_2 ==
  /\ ~(status["i2"] = "claiming")
  /\ status' = [status EXCEPT !["i2"] = "dead"]
  /\ hasConvo' = [hasConvo EXCEPT !["i2"] = FALSE]
  /\ UNCHANGED <<runtimeClean>>

Init ==
  /\ status = [x \in Instances |-> "starting"]
  /\ hasConvo = [x \in Instances |-> FALSE]
  /\ runtimeClean = [x \in Instances |-> TRUE]

Next ==
  \/ \E i \in Instances : becomeIdle(i)
  \/ \E i \in Instances : failWhileUnclaimed(i)
  \/ \E i \in Instances : sleep(i)
  \/ \E i \in Instances : claim(i)
  \/ \E i \in Instances : completeClaim(i)
  \/ \E i \in Instances : markPendingAcceptance(i)
  \/ \E i \in Instances : completePendingAcceptance(i)
  \/ \E i \in Instances : failPendingAcceptance(i)
  \/ \E i \in Instances : recoverClaimToIdle(i)
  \/ \E i \in Instances : failClaim(i)
  \/ \E i \in Instances : crashWhileClaimed(i)
  \/ \E i \in Instances : crashWhilePending(i)
  \/ \E i \in Instances : markTainted(i)
  \/ \E i \in Instances : recheckWithConvo(i)
  \/ \E i \in Instances : recheckCleanNoConvo(i)
  \/ \E i \in Instances : runtimeGainsConvo(i)
  \/ \E i \in Instances : runtimeLosesConvo(i)
  \/ \E i \in Instances : runtimeBecomesDirty(i)
  \/ \E i \in Instances : runtimeBecomesClean(i)
  \/ \E i \in Instances : kill(i)

EquivalenceNext ==
  \/ Action_becomeIdle_1
  \/ Action_becomeIdle_2
  \/ Action_failWhileUnclaimed_1
  \/ Action_failWhileUnclaimed_2
  \/ Action_sleep_1
  \/ Action_sleep_2
  \/ Action_claim_1
  \/ Action_claim_2
  \/ Action_completeClaim_1
  \/ Action_completeClaim_2
  \/ Action_markPendingAcceptance_1
  \/ Action_markPendingAcceptance_2
  \/ Action_completePendingAcceptance_1
  \/ Action_completePendingAcceptance_2
  \/ Action_failPendingAcceptance_1
  \/ Action_failPendingAcceptance_2
  \/ Action_recoverClaimToIdle_1
  \/ Action_recoverClaimToIdle_2
  \/ Action_failClaim_1
  \/ Action_failClaim_2
  \/ Action_crashWhileClaimed_1
  \/ Action_crashWhileClaimed_2
  \/ Action_crashWhilePending_1
  \/ Action_crashWhilePending_2
  \/ Action_markTainted_1
  \/ Action_markTainted_2
  \/ Action_recheckWithConvo_1
  \/ Action_recheckWithConvo_2
  \/ Action_recheckCleanNoConvo_1
  \/ Action_recheckCleanNoConvo_2
  \/ Action_runtimeGainsConvo_1
  \/ Action_runtimeGainsConvo_2
  \/ Action_runtimeLosesConvo_1
  \/ Action_runtimeLosesConvo_2
  \/ Action_runtimeBecomesDirty_1
  \/ Action_runtimeBecomesDirty_2
  \/ Action_runtimeBecomesClean_1
  \/ Action_runtimeBecomesClean_2
  \/ Action_kill_1
  \/ Action_kill_2

Spec == Init /\ [][Next]_vars
EquivalenceSpec == Init /\ [][EquivalenceNext]_vars

====