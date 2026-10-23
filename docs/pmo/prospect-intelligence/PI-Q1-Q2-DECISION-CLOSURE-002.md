# PI-Q1-Q2-DECISION-CLOSURE-002 — final owner decisions for Q1 and Q2

**DOCUMENTATION-ONLY.** No implementation, no migration, no database operation, no production access, no provider call, no feature-flag change, no commit, push, merge or deployment, no modification of `C:/virality`. **No application code, test, schema, migration, existing controlling document or execution ledger was edited.** One new file: this report.

**Q1 and Q2 decisions are recorded. Q3 remains BLOCKED. PI-ADD-001 remains unratified. Implementation authorization: NONE.**

---

## 1. Verified baseline and source hashes

Measured at **2026-10-17T19:12:44+05:30 (IST)**. The prior baseline was **not assumed**.

| | Expected | **Actual** | Result |
|---|---|---|---|
| Repository | `C:/tmp/r1-ctx` | `C:/tmp/r1-ctx` | **MATCH** |
| Branch | `fix/r1-profile-context` | `fix/r1-profile-context` | **MATCH** |
| HEAD | `29fea38a…81415774` | `29fea38a2d1642c1c2fd957e5151f6be81415774` | **MATCH** |
| Worktree | — | **136 entries (67 M / 69 ??), 0 staged** | unchanged from the prior close |
| This target pre-existing? | must not exist | **ABSENT** | nothing overwritten |

| Source document | Expected | **Actual (24 hex) / lines** | Result |
|---|---|---|---|
| `PI-Q1-Q2-OWNER-DECISIONS-001.md` | `88be0578…`, 293 | `88be0578b6bcacaa6dddff93` / **293** | **MATCH on both** |
| `PI-Q1-Q2-REMAINDER-001.md` | `52ae61bb…`, 318 | `52ae61bb7289b4ecea91c039` / **318** | **MATCH on both** |
| `PI-Q1-Q2-AUDIT-001.md` | `899781f2…`, 336 | `899781f20bd30fa558601cbf` / **336** | **MATCH on both** |
| `PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` | — | `f244adb96027f8078ec263c2` / 236 | unchanged |
| `PI-C1-DECISION-CLOSURE-001.md` | — | `7e74c05d6d991c94e46806e0` / 285 | unchanged |
| `PI-MILESTONE-A-EXECUTION-001.md` (ledger) | — | `1ad1105accdd5866aa8a61df` | unchanged |
| `IMPLEMENTATION-MANIFEST-001.md` | — | `651575cd73f1c3a7e6e04f0d` | unchanged |

**No hash discrepancy.** Source files re-inspected for this record: `backend/types/opportunityLifecycle.ts`, `backend/services/opportunityLifecycleService.ts`, `pages/api/active-leads/lifecycle.ts`, `backend/types/retention.ts`, `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql`, `supabase/migrations/20260921000000_w2_lead_intelligence_uuid_reconciliation.sql`, `backend/security/requireCapability.ts`, `backend/security/AuthorizationService.ts`.

---

## 2. The six newly confirmed owner decisions

**These are policy directions only. None is a claim that the application implements them — see §4.**

### 2.1 Q1 — `triaged` · **OWNER-APPROVED**

> Initial assessment, ready for further qualification or review, and supports reopening accidental dismissal.

**Consistent with the verified topology.** `triaged` is the reopen target of `dismissed` (`opportunityLifecycle.ts:44` — `dismissed: ['triaged','archived']`), and it may proceed to `qualified` directly or to `reviewing` first (`:38` — `triaged: ['reviewing','qualified','dismissed','archived']`). The definition admits both, as the structure requires.

### 2.2 Q1 — `reviewing` · **OWNER-APPROVED**

> Active assessment with revisable qualification, respecting the existing lifecycle transition rules.

**Consistent with the verified topology.** `reviewing` is bidirectional with `qualified` (`:39` and `:40`), so "revisable qualification" matches the allowlist exactly. It cannot reach `monitoring`, `outreach_planned` or `converted` directly, and the definition does not claim otherwise.

### 2.3 Q1 — `monitoring` · **OWNER-APPROVED**

> Observe an opportunity for future developments, including conversion without planned outreach, subject to the existing transition rules.

**Consistent with the verified topology.** `monitoring` is the only non-outreach state that can reach `converted` directly (`:41` — `monitoring: ['qualified','outreach_planned','converted','dismissed','archived']`), so "conversion without planned outreach" is precisely the legal path the allowlist permits.

### 2.4 Q2-1 — Bulk resolution · **OWNER-APPROVED, NARROWLY SCOPED**

> Permit archiving only to clear ordinary account-deletion blocks, with independent per-item validation and outcomes and the required security controls.
>
> **Do not broaden this into general bulk opportunity resolution.**

**Scope boundary recorded explicitly:** the approval covers **transition-to-`archived`, for the purpose of clearing an ordinary account-deletion block, only**. It does **not** authorize bulk qualification, bulk dismissal, bulk disposition, bulk outreach planning, or any other bulk lifecycle operation. Any broader bulk capability requires a separate owner decision.

### 2.5 Q2-4 — Controlled reason code · **OWNER-APPROVED**

> A separate controlled reason code is not required. The target lifecycle state is the controlled element.

**Consistent with the verified mechanism.** The target state is already a closed vocabulary enforced at write time: `canTransitionLifecycle` (`opportunityLifecycle.ts:57-67`) consulted by `transitionLifecycle` (`opportunityLifecycleService.ts:132-137`), which throws `LifecycleTransitionError` on refusal. Combined with the standing directions, **no new reason-code enum is introduced and the disposition enum is not repurposed.**

### 2.6 Q2-5 — Free-text explanation · **OWNER-APPROVED**

> Explanation is optional and retained verbatim under the existing nullable contract.

**The exact field and contract, verified in source as the decision requires:**

| | |
|---|---|
| **Field** | **`opportunity_lifecycle_states.reasoning`** |
| Schema contract | **`reasoning TEXT NULL`** — `supabase/migrations/20260520_phase6_realtime_lifecycle_workflow.sql:19`. A search for `reasoning.*NOT NULL` in that migration returns **no match**, so nullability is confirmed positively, not by absence of evidence alone |
| Type contract | **`reasoning: string | null`** — `backend/types/opportunityLifecycle.ts:20`, in `OpportunityLifecycleRecord` |
| Write path | carried on every transition by `transitionLifecycle` (`opportunityLifecycleService.ts:143`), alongside `previous_state`, `actor_user_id` and `transitioned_at` |

**This is the contract cited.** The second precedent that informed the recommendation — `prospect_list_members.removal_reason`, nullable by explicit design — remains supporting evidence but is **not** the contract under which this decision operates.

---

## 3. All previously approved Q1/Q2 directions — preserved

Retained in full, not reopened and not downgraded.

| # | Approved direction |
|---|---|
| A-1 | The existing nine-state opportunity lifecycle vocabulary owns lifecycle and **terminality** |
| A-2 | **`archived` is the sole terminal state** for ordinary account-deletion eligibility |
| A-3 | All other states — including `dismissed`, `converted`, unknown and future states — are **non-terminal** for this purpose unless a later owner-approved policy changes it |
| A-4 | `converted` must transition to `archived` **through the existing validated and audited mechanism** before qualifying as resolved |
| A-5 | Lifecycle semantics for `triaged`/`reviewing`/`monitoring` are documentation items — **now answered**, §2.1–§2.3 |
| A-6 / A-11 | Do **not** reuse the disposition enum as a deletion-resolution vocabulary without separate justification and approval |
| A-7 | **Capability-based authorization plus step-up** is the baseline for future bulk resolution |
| A-8 | A-7 is a **required security upgrade**, not a claim about current behaviour |
| A-9 | Denied attempts must be **audited without leaking cross-tenant information** |
| A-10 | **No new reason-code enum** for C-1 |
| A-12 | **Preserve optional free-text explanations** where the existing contract permits — now bound to the field named in §2.6 |
| A-13 | Repeated archive requests must eventually return an explicit **already-resolved** result, not a spurious invalid-transition failure |

**Q1 and Q2 are now fully decided.** No Q1 or Q2 item remains open.

---

## 4. Current implementation status versus approved policy

**None of the approved directions is claimed to be implemented.** This table separates owner-approved policy from verified facts about current code.

| Approved policy | Current code | Gap |
|---|---|---|
| **A-2** `archived` is the sole terminal state | **No terminality concept exists.** `grep -ni 'terminal'` across `opportunityLifecycle.ts` and `opportunityLifecycleService.ts` matches **only a doc comment** — never a constant, type or check | **NOT IMPLEMENTED** |
| **A-4** `converted` must archive before qualifying as resolved | **No deletion gate exists** for opportunities; the canonical opportunity entity itself does not exist | **NOT IMPLEMENTED** |
| **§2.1–§2.3** three state definitions | **Documented nowhere.** The lifecycle types carry transitions only; `components/recommendations/tabs/AnalystWorkspacePanel.tsx:65-80` carries a display ordering and colour classes only — no label text, tooltip or help copy | **NOT DOCUMENTED** — see §5.1 |
| **§2.4** bulk archiving for deletion-block clearance | **No bulk operation exists for opportunities.** `pages/api/active-leads/lifecycle.ts` transitions one item | **NOT IMPLEMENTED** |
| **A-7 / A-8** capability + step-up | The lifecycle route authorizes with `getUserRole(ctx.userId, companyId)` at `pages/api/active-leads/lifecycle.ts:59`, `403 FORBIDDEN_ROLE` at `:60`, a further role check at `:62`. **No `requireCapability`, no step-up, no `withIdempotency`.** `opportunityLifecycleService.ts:122-123` states *"Caller (API) is responsible for RBAC checks."* | **NOT IMPLEMENTED — this is the upgrade A-8 describes** |
| **A-9** denials audited without cross-tenant leakage | **Denied lifecycle transitions are not audited today**, because the route does not use `requireCapability`, which is what writes `capability_audit_log` (`requireCapability.ts:144`) | **NOT IMPLEMENTED** |
| **A-13** repeat archive returns already-resolved | **Opposite behaviour today.** `canTransitionLifecycle` returns `{allowed:false, reason:'no_op_same_state'}` at `opportunityLifecycle.ts:61` and `transitionLifecycle` **throws** at `opportunityLifecycleService.ts:136`. `archived: []` also refuses any onward transition | **NOT IMPLEMENTED — an explicit mapping is required** |
| **A-10** no new reason-code enum | Nothing to change — no such enum exists | **ALREADY COMPLIANT** |
| **A-6 / A-11** disposition enum not reused as a deletion-resolution vocabulary | Nothing reuses it; `opportunity_dispositions` is a separate triage axis | **ALREADY COMPLIANT** |
| **§2.6 / A-12** optional free-text, retained verbatim | **Already satisfied by the cited contract**: `reasoning TEXT NULL` (migration `:19`), `string | null` (type `:20`), written on every transition | **ALREADY COMPLIANT** |

**Summary: three directions are already satisfied by existing behaviour; seven are not implemented.** None of the seven is implemented by this record, and none is authorized.

---

## 5. Remaining documentation corrections and traceability work

**Identified only. Nothing applied.** Each item gives the exact path, the relevant lines, the required correction and its status.

### 5.1 Lifecycle semantics and traceability documentation

| | |
|---|---|
| **Required** | Record the three owner-approved definitions (§2.1–§2.3) and the §2.4 scope boundary in `PI-ADD-001 v0.2-PROPOSED` as owner clarifications |
| Where | `docs/pmo/prospect-intelligence/PI-REQUIREMENTS-ADDENDUM-001-PROPOSED.md` → a future v0.2 as a **separate new file** |
| Constraint | No lifecycle type, schema, migration or application file may be modified to record a definition |
| Traceability gap carried | The canonical opportunity entity still has **no requirement identifier** in the ratified carrier — `grep -nE 'opportunit' IMPLEMENTATION-MANIFEST-001.md` returns **zero matches**. The addendum is the agreed authority vehicle; the manifest stays unchanged |
| **Status** | **OPEN — documentation only** |

### 5.2 The contradictory `converted` terminality comment

| | |
|---|---|
| **File** | `backend/types/opportunityLifecycle.ts` |
| **Lines** | **30–31**, inside the doc block spanning 27–34 |
| **Exact text** | *"`converted` and `archived` are terminal — they only accept `archived` as a follow-up (so a converted row can be tombstoned but never revived as detected)."* |
| **Why it is wrong — two distinct errors** | **(a)** `converted` is **not** terminal: `converted: ['archived']` (`:43`) gives it an outgoing transition. **(b)** The clause "they only accept `archived` as a follow-up" is false **for `archived` itself**: `archived: []` (`:45`) accepts **nothing**. So the sentence mis-describes both states it names |
| **Required correction** | Restate so that `archived` is identified as the sole absorbing state and `converted` as a non-absorbing outcome state that must be archived to qualify as resolved — consistent with **A-2** and **A-4** |
| **Status** | **OPEN — application-code comment. NOT edited by this task** (code edits are prohibited). Requires a separate authorized change |

### 5.3 The inaccurate `lead_intelligence` claim

| | |
|---|---|
| **The stale claim** | that `lead_intelligence` has `company_id text` with no foreign key, cited as evidence of a tenant-unsafe outlier |
| **Where it appears** | `docs/pmo/prospect-intelligence/OMNIVYRA-PI-OPPORTUNITY-SPINE-DESIGN-001.md:32` and `docs/pmo/prospect-intelligence/PI-C1-IMPLEMENTATION-GATE-001.md:300` |
| **Verified reality** | `supabase/migrations/20260921000000_w2_lead_intelligence_uuid_reconciliation.sql` reconciled the types and foreign keys: `:7` — `lead_intelligence.company_id text -> uuid  FK -> companies(id)`; `:8` — `lead_intelligence.unified_person_id text -> uuid  composite FK -> unified_persons(id, company_id)`; `:9` — `lead_intelligence_profiles.company_id text -> uuid  FK -> companies(id)`; and `:184-187` add `lead_intelligence_person_tenant_fk` as `FOREIGN KEY (unified_person_id, company_id) REFERENCES public.unified_persons(id, company_id) ON DELETE RESTRICT` |
| **Correct statement** | **`lead_intelligence` is tenant-safe.** It uses a uuid tenant key with a foreign key to `companies(id)` and a composite tenant-safe foreign key to `unified_persons`. **It is not an outlier and must not be cited as one.** |
| **Effect on the conclusion it supported** | The conclusion — six lead/opportunity-shaped models already exist and a seventh should not be added — **still stands on the count**, but its supporting rationale must be restated without the false claim |
| **Status** | **OPEN in two existing reports. NOT edited by this task.** The stale claim is **not repeated as fact** anywhere in this record |

### 5.4 `opportunity_feed_items` retention versus `detection_ref`

| | |
|---|---|
| **The interaction** | `PI-ADD-001` proposes `detection_ref` on the canonical opportunity, pointing at `opportunity_feed_items.id`. That table **is subject to retention** |
| **Evidence** | `backend/types/retention.ts:4` — `'opportunity_feed_items'` is a member of `RETENTION_TARGETS`; `:57` — its binding is `{ table: 'opportunity_feed_items', time_column: 'created_at', soft_delete_column: null }`; `:15-16` — `RETENTION_ARCHIVAL_MODES = ['soft_delete','hard_delete']` |
| **Sharper finding** | **`soft_delete_column: null`** means soft delete is unavailable for this table, so a retention action on it is necessarily a **hard delete**. `detection_ref` can therefore become **permanently unresolvable**, not merely flagged |
| **Mitigating design facts** | `detection_ref` is deliberately a plain uuid rather than a foreign key, so retention cannot cause a hard referential failure; and `detected_reason` is carried **verbatim** on the opportunity precisely so the reason survives the loss of the detection record |
| **Required correction** | `PI-ADD-001` must state explicitly that `detection_ref` **may become unresolvable** after retention, that this is accepted rather than prevented, and that `detected_reason` is the durable record. Note also that `lead_signals` — the evidence anchor — is **not** in `RETENTION_TARGETS` today, which is an **absence of policy, not a guarantee** |
| **Status** | **OPEN — required before ratification** |

### 5.5 Corrections required to `PI-ADD-001` v0.1-PROPOSED before ratification

| # | Correction | Source |
|---|---|---|
| 1 | **FR-A6's six-state vocabulary is superseded.** Restate against the authoritative nine states per **A-1**. Five of its six values (`open`, `disqualified`, `acted`, `closed`, `superseded`) do not exist; `acted` exists nowhere in schema or code | A-1, §2 |
| 2 | **BR-A6's rationale is factually wrong** — it cites `lead_intelligence` as a tenant-unsafe outlier. Restate without that claim; the conclusion survives on the model count | §5.3 |
| 3 | **FR-A36 / AC-A25 presume a reachable person-erasure path.** `erasePerson` exists (`backend/services/prospectIdentity/personErasure.ts:149`) but has **no API route caller**, and `lead_intelligence_person_tenant_fk` can block person deletion outright. State the precondition or defer to the erasure package | `PI-C1-OWNER-DECISIONS-002` §6.3 item 3 |
| 4 | **`detection_ref` dangling-reference statement** must be added | §5.4 |
| 5 | **Add** the three approved state definitions, the §2.4 bulk scope boundary, and the §2.6 named contract | §2 |
| 6 | **Add** the terminality rule (**A-2**, **A-3**, **A-4**) as requirements with acceptance criteria | §3 |

**Status: all six OPEN.** A consolidated **v0.2-PROPOSED** should be prepared as a **separate new file**; the v0.1 proposal is **not overwritten, not edited and not marked ratified** by this task.

---

## 6. Open and blocked decisions

| Item | Status | Note |
|---|---|---|
| **Q1** | **CLOSED — all items decided** | §2.1–§2.3 plus A-1…A-5 |
| **Q2** | **CLOSED — all items decided** | §2.4–§2.6 plus A-7…A-13 |
| **Q3 — legal-erasure policy** | **BLOCKED** | **POLICY NOT LOCATED / APPROVAL UNVERIFIED.** `PI-CONTRACT-002-data-lifecycle.md` is on scope but states *"CONTRACT PREPARED — AWAITING POLICY DECISIONS"* and *"It invents no legal or compliance policy."* **No retention period, legal authority, surviving-record rule or erasure semantics is invented here.** Absence of a policy in this repository is **not** treated as proof that none exists elsewhere. The account-deletion FK design was not changed, no erasure path implemented, and the opportunity subject invariant not weakened |
| **Q4** — high-risk action catalogue | **OPEN** | blocks the second-approver flow, not C-1 |
| **OD-3 / OD-4 / OD-5** | **BLOCKED** | unchanged definitions; block WP-4 and WP-5 |
| **D-C** | **OPEN** | blocks the bridge package |
| **D-E** | **OPEN** | blocks matching; traces to ratified FR-16 / FR-17 |
| **Company-event sources** | **NOT AUTHORIZED** | signal types and weights in code are code, not authorization |
| Production migration state of the PI migrations | **UNVERIFIED** | prohibited operation; operator read required |
| Production tenant isolation | **UNVERIFIED** | local only; the service role holds a row-level-security bypass and the application connects as that role |

**No approval is inferred for any item above.**

---

## 7. PI-ADD-001 status and ratification prerequisites

| | |
|---|---|
| Identifier / version | **PI-ADD-001 v0.1-PROPOSED** |
| Status | **NOT ratified, NOT approved, NOT implementation-authorizing** |
| Hash | `f244adb96027f8078ec263c2…`, 236 lines — **verified unchanged; not edited by this task** |

**Ratification prerequisites, all OPEN:**

1. The six corrections in §5.5 incorporated into a **separate** v0.2-PROPOSED.
2. **Q3 resolved**, since FR-A32…FR-A37 and AC-A23…AC-A25, AC-A29 depend on erasure and retention policy.
3. A formal owner act of ratification, which is a **separate gate** from the Q1/Q2 decisions recorded here.

---

## 8. Schedule and time accountability

### 8.1 Frozen baselines — preserved, unchanged

| Item | Frozen | Source | Changed? |
|---|---|---|---|
| **Milestone A′** | **2026-11-25**, 28.5 human engineer-days | `PI-MILESTONE-A-EXECUTION-001.md` §3 / §3.1 | **NO** |
| **WP-7** | **2026-11-17**, 4.0 engineer-days | same, row WP-7 | **NO** |
| C-1 estimate | 8–12 engineer-days | gate §9.3 | **NO — not revised** |

No date, budget, estimate, scope or sequencing changed. Agent wall-clock throughput is **not** substituted for human engineer-days.

### 8.2 This task

| | |
|---|---|
| **Actual start** | **2026-10-17T19:12:44+05:30 (IST)** |
| External waiting time before start | **6 min 15 s** (prior close 19:06:29 → 19:12:44) — **not** engineering effort |
| Original estimate | **0.25 engineer-days** |
| Active engineering effort consumed | **~5 minutes** |
| 75% threshold (0.1875 d) | **not approached** |
| Remaining estimate | 0 — complete at this report |
| Monitoring | **no continuous monitoring claimed between reports**; every timestamp is a measured `date -Iseconds` |

### 8.3 OVERRUN RISK — REMAINS RAISED

First identified **2026-10-17T16:33+05:30**; confidence **MEDIUM-HIGH**; **unchanged by this task**.

| | |
|---|---|
| Baseline at risk | **Milestone A′ — 2026-11-25**: **+4** working days float at the low C-1 estimate, **ZERO** at the high estimate |
| Baseline not at risk | **WP-7 — 2026-11-17**: +6 to +10 working days float |
| Dominant driver | **Q3 decision latency** — a legal/compliance dependency, still **BLOCKED** |
| Effect of closing Q1 and Q2 | **Favourable, unquantified.** Specification risk falls materially — the lifecycle vocabulary, terminality rule, authorization model, reason-code question and explanation contract are all now settled. **But no estimate is revised and no float is claimed back** |
| **Newly identified risk** | **none** |
| Next review checkpoint | the earlier of a verified Q3 policy, or **Fri 2026-10-23** — the last date C-1 can start and retain any Milestone A′ float |

---

## 9. Verdict and smallest next action

### Verdict: **Q1 and Q2 are CLOSED. C-1 remains gated on Q3 and on PI-ADD-001 ratification.**

Every Q1 and Q2 decision is now recorded as owner-approved policy, with each direction separated from verified facts about current code (§4): three directions are already satisfied by existing behaviour, and **seven are not implemented**. No implementation occurred and none is authorized.

### Smallest next action

| # | Action | Blocks |
|---|---|---|
| **1** | **Supply or point to the approved legal-erasure and retention policy**, or confirm that none exists and a decision must be made (eight sub-decisions stand in `PI-C1-OWNER-DECISIONS-002` §5.5) | **Q3** — the sole remaining gate on the deletion and erasure requirements, and the dominant schedule driver |
| **2** | **Authorize preparation of `PI-ADD-001 v0.2-PROPOSED`** as a separate new file, carrying the six §5.5 corrections | addendum ratification |
| **3** | **Respond to the standing overrun position** — select a recovery option or accept the zero-float position at the high C-1 estimate | Milestone A′ |

Items 2 and 3 need no legal input. Item 1 does.

---

## 10. Required closing statements

- **Q1/Q2 decisions are RECORDED.** All Q1 and Q2 items are decided and documented in §2 and §3.
- **Q3 remains BLOCKED.** Policy not located, approval unverified. No retention period, legal authority, surviving record or erasure semantics has been invented.
- **The addendum remains UNRATIFIED.** `PI-ADD-001` is v0.1-PROPOSED, unedited, with six corrections outstanding.
- **Implementation authorization remains NONE.** C-1a and C-1b are not authorized. C-1a — three tables, one migration, one rollback — may be considered only after Q3 is resolved, `PI-ADD-001` is formally ratified, and the owner separately authorizes that work package.
