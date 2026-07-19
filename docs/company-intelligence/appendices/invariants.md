# Appendix — Platform Invariants (P1–P30)

The constitutional invariants from DESIGN-002 §11. Each binds every implementation. Non-waivable invariants are marked ⛔ (see GOVERNANCE §5). Each carries its rationale and the audit finding it closes or the strength it preserves.

| # | Invariant | Rationale / audit anchor | Non-waivable |
|---|---|---|---|
| **P1** | Evidence is immutable. | Foundation of lineage and explainability; superseded never edited. [I2C] | |
| **P2** | Reads never mutate state. | Closes read-triggered generation (A2 C9 — `getProfile` autoRefine). | |
| **P3** | One write authority per context. | Closes the 10-writer surface (A2 C1). | ⛔ (singleton) |
| **P4** | Four singletons: one grounding authority, one conversation engine, one confidence vocabulary, one event bus. | Prevents re-fragmentation (D1 §13). | ⛔ |
| **P5** | Every Fact has Provenance. | Explainability substrate (D1 §12). | |
| **P6** | Every Fact version has computed Confidence. | Trust-owned; no bare values. | |
| **P7** | Every AI output is explainable to its Grounding Context. | If it can't answer "based on what?", it doesn't ship. | |
| **P8** | User-confirmed truth overrides inferred truth, permanently, per field. | Preserves the certified lock invariant (A1 §8). | ⛔ |
| **P9** | Deterministic observation overrides inference. | Ordering of authority. | |
| **P10** | Inference is always labeled; never presented as observation or user truth. | Closes the launder-as-user-truth path (A3 §7). | |
| **P11** | No consumer bypasses the Grounding Authority for grounding. | Closes 5-mechanism fragmentation (A3 §3). | ⛔ (singleton) |
| **P12** | Confidence is reproducible; never monotonic by construction; never defaulted when unknown. | Closes the confidence contract defects (A3 §6). | |
| **P13** | Contradictions are surfaced, never silently resolved. | Closes silent last-writer-wins (A2 C8). | |
| **P14** | Learning never silently changes Facts. | The learning safety boundary (D2 §9). | ⛔ |
| **P15** | Knowledge is append-only; supersession, never destruction. | No data loss; rollback-proof history. | |
| **P16** | No hidden AI generation: every LLM call is a registered workflow with a run record. | Governs the 13 call sites (A3 §4). | |
| **P17** | No duplicate conversations, confidence systems, grounding mechanisms, or ownership. | Anti-fragmentation. | |
| **P18** | No orphan fields: every field has a contract or does not exist. | Field governance (D2 §3). | |
| **P19** | Validation is universal: no generated value persists unvalidated, on any path. | Closes the #1 quality hole (A3 §7). | ⛔ |
| **P20** | Deterministic logic never fabricates content. | Deletes the PT boilerplate injector (A4 §7). | |
| **P21** | Tenancy is structural on every object; cross-tenant reads impossible by construction. | Closes tenancy-by-discipline (A2 C14). | ⛔ |
| **P22** | Evidence-selection exclusions are recorded (no silent truncation). | Closes silent evidence loss (A4 §8). | |
| **P23** | All cross-context communication is evented. | Closes the dual notification stack (A2 C11). | |
| **P24** | Every generation records cost; cost policies govern every AI stage. | Generalizes the refresh-gate cost model (D1 §17). | |
| **P25** | Locks are real: a declared lock is honored by every writer or the write fails loudly. | Closes phantom locks (A2 C8). | |
| **P26** | Projections are derived, never hand-edited. | Read-model integrity (I2G). | |
| **P27** | Freshness is honest: every surfaced value carries its age and decay state. | No stale-as-fresh. | |
| **P28** | External publication draws only from Observed+ facts. | Reports/exports never ship unverifiable claims. | |
| **P29** | Silent data loss is prohibited: any dropped write is an error, never a warning. | Closes the schema-cache column-drop (A1 §8). | |
| **P30** | The constitution binds: any change violating P1–P29 is rejected in review regardless of local merit. | Enforceability. | ⛔ |

## The four singletons (P4, permanent, non-waivable)

The counts that must stay at exactly one, enforced by CI census (GOVERNANCE §3):

1. **One write authority** (Knowledge) — census: I2A §14.1
2. **One grounding authority** (Distribution) — census: I2D §17.1
3. **One confidence vocabulary/engine** (Trust) — census: I2B §16.1
4. **One conversation engine** (Generation) — census: I2E §15.1

Adding a fifth of any is non-conformant by definition.
