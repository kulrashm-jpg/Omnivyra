# CPG-038 — Operator Manipulation Analysis

**Assumption throughout:** the CPG operator is also the only available frame author and executes every step (the situation CPG-037B established).

**Designs compared:**
- **D0** — beacon value used directly as the seed; operator timestamps the frame privately (e.g. OpenTimestamps or RFC 3161).
- **D1** — the proposed design (`PROPOSED_BEACON_DESIGN_NOT_APPROVED.md`): the frame commitment is published as the **single** pre-registered entry in a public append-only transparency log, and the stage seed is derived from that commitment plus a beacon round fixed by rule from the log's signed timestamp.

Verdict key: **PREVENTED** (cannot succeed) · **DETECTED** (can be attempted but is publicly auditable, and a rule voids it) · **OPEN** (neither).

| # | Attack | D0: beacon + private timestamp | D1: beacon + single public logged commitment | Rule that stops it in D1 |
|--:|---|---|---|---|
| 1 | Choose companies after knowing the randomness | PREVENTED only if the timestamp is trustworthy | **PREVENTED** | R-3: round R is strictly after the log's signed `integratedTime` + Δ, so the beacon value does not exist when the frame is committed |
| 2 | Choose randomness after seeing the companies | PREVENTED (drand is threshold-generated and unbiasable) | **PREVENTED** | R-2/R-3: network, scheme and round formula frozen at T0; the operator chooses nothing |
| 3 | Create multiple candidate-list versions | **OPEN** — each version can be privately timestamped before R; nobody can enumerate them | **DETECTED → VOID** | R-5: exactly one commitment entry per stage signed by the pre-registered key before round R; the log is enumerable by key, so a second entry voids the stage |
| 4 | Hash many lists and reveal only the favourable one after the beacon | **OPEN — decisive failure of D0.** Commit K lists, wait for R, compute K draws, disclose the best | **PREVENTED** | R-5 + R-6: only a logged entry counts. Unlogged lists are not commitments; logging K lists is detected by R-5; logging after R is outside the window |
| 5 | Wait for a favourable beacon round | PREVENTED if the round is fixed by rule; OPEN if the rule refers to operator-chosen time | **PREVENTED** | R-3: R is a pure function of the log's signed timestamp. Choosing *when* to log gives no advantage, because every future round is unknown at logging time |
| 6 | Discard an unfavourable beacon value (declare failure, restart) | **OPEN** | **DETECTED** | R-8: every entry under the key is published with its full computed draw; restarts need a new protocol version that lists all prior entries and draws. An auditor can recompute every attempt's draw from public data, so discarding cannot be hidden |
| 7 | Modify a candidate row after commitment | DETECTED (hash mismatch) if the commitment is trusted | **PREVENTED** | R-4: the draw tool recomputes the frame hash and refuses any mismatch with the logged commitment |
| 8 | Change an identifier after commitment | Same as 7 | **PREVENTED** | R-4; the rank key is identifier-bound (candidate-002 §5.7) |
| 9 | Change class or quota after seeing rankings | Quotas are frozen; class is a frame column | **PREVENTED** | R-4 (class inside committed rows); the development quota is frozen; held-out quotas come from the sizing file, which is itself committed in the held-out entry (R-7) |
| 10 | Use a different beacon network or round than preregistered | OPEN unless verified | **PREVENTED** | R-2: chain hash, scheme and period frozen; the verifier refuses any other chain; R-3 recomputes the round |
| 11 | Deliberately void a stage (e.g. publish a second entry) to force a re-draw | OPEN | **DETECTED** | R-8: voids are permanent and public; the draw of every voided entry remains computable and must be reported |
| 12 | Publish the log entry, see the draw, then argue the entry is "not the commitment" | OPEN | **PREVENTED** | R-5: an entry is binding by construction — pre-registered key, fixed payload schema, first entry |
| 13 | Tamper with a beacon relay response | OPEN (trust in relay) | **PREVENTED only with signature verification** | R-9: BLS verification against the frozen group public key. **Needs a BLS12-381 implementation not available without a new dependency — GAP G3** |
| 14 | Backdate the commitment timestamp | OPEN with operator-supplied time | **PREVENTED** | The time comes from the log's own signed entry timestamp, verified against the log's public key, not from the operator |
| 15 | Hold the development commitment back, use the dev draw to shape the held-out frame, then commit held-out | Allowed by design | **HARMLESS** | The held-out seed derives from the held-out commitment and a later round; development knowledge reveals nothing about held-out ranks (R-7 domain separation) |

## What the beacon does NOT solve

| Residual | Why | Governed by |
|---|---|---|
| **Operator-authored frame composition** — e.g. listing only "easy" companies | A frame built before the randomness is known cannot be rank-aware, but it can still be *globally* biased | Enumerator-independence requirement and admissibility rules (candidate-002 §5, §19.3). **Unchanged, and still unmet if no independent enumerator exists** |
| **Attestation discretion on drawn companies** | Post-draw inadmissibility makes observations INVALID, not replaced (§5.9), so there is no re-draw incentive. But a biased author can still harm validity | §5.9 no-replacement rule; §15.5 90% valid floor |
| **Reference truth and rating independence** | Unrelated to seeds | §9, §12 — still require independent people |

## Conclusion

**D0 (beacon plus private timestamp) does not provide the required protection:** attacks 3, 4, 6 and 11 remain open. Public randomness alone only prevents choosing the seed. It does not stop choosing among frames.

**D1 does** — **provided** its uniqueness channel (R-5), trusted timestamp and beacon signature verification actually exist and have been approved. Those three are the gaps in the final report.
