# D22-B2 — G-3 COMPOSITION CLOSURE
## ENRICHMENT ATTEMPT / LEASE → APOLLO → B1b

| | |
|---|---|
| **Gate** | G-3 — verify the attempt ledger and lease composed with the B1b write path |
| **Verdict** | **G-3 NOT CLOSED.** Items 1–5 and 7–11 **VERIFIED**; **§6 tenant isolation is PARTIAL** because of one defect, **G-6**, which needs an owner decision. |
| **Date** | 2026-10-06 |
| **Implementation code changed** | **NONE.** No defect required a code fix; the one found needs a schema decision. `ingestionBoundary.ts` is still `4c3237a8fbcb9585`, unchanged since B1b closure. |
| **Added** | One test file: `backend/tests/realschema/b2_g3_attempt_composition.test.ts` (`1cbbe9c58201b37a`, 17 tests) |
| **Production** | **Untouched.** No production DB, no credential, no provider call, no deploy, no migration, no flag change, Docker never started. |

> **Why not CLOSED.** Everything G-3 asked about the ledger, the lease, retry, replay and settlement is verified. One requirement is not met: §6 says *"Attempting to cross tenants must fail closed."* It does not fail closed **at the attempt ledger** — it fails one step later, at the evidence layer. Canonical integrity is intact; **attribution is not**. The remedy is a migration altering foreign keys on an existing table, which is larger than this gate's "smallest authorized fix" and is the owner's call.

---

## Classification summary

| # | Item | Status |
|---|---|---|
| 1 | Actual call graph | **VERIFIED** (traced in code) |
| 2 | Attempt lifecycle | **VERIFIED** |
| 3 | Lease lifecycle | **VERIFIED** |
| 4 | Transaction boundaries | **VERIFIED** — and there is no spanning transaction, by design (§4) |
| 5 | Apollo → attempt → B1b composition | **VERIFIED** (A–H in one pass) |
| 6 | T1 results | **VERIFIED** — unchanged, not re-run wholesale |
| 7 | T2 results | **VERIFIED** — 17/17 new; 1148/1154 across all 50 real-schema suites (§7) |
| 8 | Retry results | **VERIFIED** — CASES 1, 2, 3, 5, 6 |
| 9 | Lease collision results | **VERIFIED** — CASE 4 |
| 10 | Tenant isolation results | **PARTIAL** — canonical safe; attempt ledger exposed (**G-6**) |
| 11 | Mutation probes | **VERIFIED** — 8/8 killed |
| 12 | G-2 characterization | **VERIFIED** — and sharper than recorded (§12) |
| 13 | G-4 characterization | **VERIFIED** |
| 14 | G-1 not changed | **VERIFIED** |
| 15 | Production-safety evidence | **VERIFIED** |
| 16 | Remaining gaps | **1 new (G-6)**, 4 carried, none fixed |

---

## 1. The actual call graph

Traced in source, not inferred from tests.

```
backend/jobs/prospectRetryJob.ts            cron, inert unless PI_RETRY_SCHEDULER_ENABLED='true'
  │                                          AND a tenant allow-list is set
  └─ runRetryCycle → consumeEnrichmentWork  ← passes lease AND requireAttemptRecord: true
       │                                      (consumeEnrichmentWork.ts:221,233)
       └─ executeEnrichmentRecorded
            1. nextAttemptNumber(...)        work-item scoped: (org, subject, entity,
            │                                provider, requestedAttributes)   — A4Y
            2. claimEnrichmentWork(...)      ATOMIC. Arbiter = the live partial unique index.
            │    lost claim → EnrichmentWorkClaimedError, thrown BEFORE adapter
            │    resolution, credential resolution, cost authorisation and any egress
            3. wrap the adapter:
            │    markProviderCallPending → provider_call_state='unknown'  BEFORE transport
            │    then providerCalled = true, then baseAdapter.enrich()
            4. executeEnrichment (frozen A3 contract, unmodified)
            │    authorizeCost → resolveCredential → findRecentObservation
            │    → adapter.enrich → usable fields? → persistObservation
            │         → ingestSourceRecord → B1b arbitration → canonical + decision log
            5. completeAttempt(...)          settlement, best-effort

pages/api/prospects/[id]/enrich.ts          operator-triggered
  └─ executeProspectEnrichment → executePlannedField → executeEnrichmentRecorded
       forwards requireAttemptRecord and lease FROM ITS INPUT
       (the manual path supplies neither — see Q10 below)
```

**Provider selection is NOT `providersFor`.** `execution.ts:339` takes `selection.sourceId` from `selection.ts`'s `selectAcquisitionSource`, which consults neither `isAvailable()` nor `providersFor()` nor `getProvider()`. See §12.

---

## 2. Attempt lifecycle

| Stage | Writes | Why it is in that order |
|---|---|---|
| **open** | `started_at`, `attempt_number`, `requested_attributes`, `correlation_id`, `provider_call_state='not_called'`, `completed_at` NULL | Written **before** the executor runs. If the process dies mid-call the row stays **open**, which is the state a maintenance loop must be able to see. A single write after completion would lose the crash case entirely. |
| **pre-transport mark** | `provider_call_state='unknown'` | Written **before** egress. A process death after this leaves `unknown` rather than a row claiming no call was made while the tenant's quota was spent. **Verified at runtime**: the row reads `unknown` at the instant transport is entered. |
| **settle** | `completed_at`, `outcome`, `provider_called`, `provider_call_state`, `execution_status`, `next_retry_at`, `source_record_id`, `attributes_returned`, `detail`, `executor_version` | Every exit passes through one `close()`, exactly once. |

`execution_status` ∈ `completed` · `refused_pre_call` · `platform_failed` · `mark_failed`, and it is **separate** from `provider_call_state` on purpose: whether a failure is retryable is decided by whether the provider was actually reached, not by our own verdict.

The TypeScript field `retryAfterAt` maps to the column **`next_retry_at`** (`attempts.ts:627`). *(My first query used the field name and failed; corrected.)*

---

## 3. Lease lifecycle

- **Owner:** `claimed_by` (a worker/process id — never a credential, never a user) with `claimed_until`.
- **Arbiter:** the database, not the code —
  `prospect_enrichment_attempts_account_live UNIQUE (organization_id, account_id, provider_key) WHERE account_id IS NOT NULL AND completed_at IS NULL`
  (and the person equivalent). Of two racing workers exactly one INSERT survives.
- **Tenant-scoped by construction:** `organization_id` is the index's first column, so two tenants can never contend. **Verified**: both tenants claimed the same domain's work simultaneously, two live rows, neither blocked.
- **Recovery:** an expired lease, or — only when the caller supplies `abandonedBefore` — an unleased row that started before that cutoff. No duration is defaulted, derived or invented.
- **Release:** settlement sets `completed_at`, which removes the row from the live partial index. There is no explicit unlock.

---

## 4. Transaction boundaries — there is no spanning transaction, and that is the design

**There is no single transaction covering attempt + evidence + canonical + decision.** Each write is its own statement through `ownedDbTable`. The composition does not pretend otherwise; it substitutes **ordering plus truthful states** for atomicity:

| Scenario | Outcome | Deceptive? |
|---|---|---|
| crash before the call | attempt **open**, `provider_call_state='unknown'` | No — "started, end unknown" |
| mark fails | execution stops, closed `mark_failed` / `not_called` | No — provably no transport |
| executor throws after `persistObservation` succeeded | canonical **written**; attempt closed `platform_failed`, `outcome` NULL, `provider_called` from the observed flag | No — `outcome` NULL says "no provider verdict", and it does not blame the vendor |
| `completeAttempt` throws | canonical written, attempt left **open** | No — "inventing a completion would be worse than the gap" |

**Answering G-3 Q7 directly: yes, attempt state and canonical state can diverge — but never deceptively.** Every divergence is represented by a state that declares itself incomplete or unknown. There is no path on which the ledger asserts something false about spend.

**Q8 — can replay double-write?** No. CASE 5: three executions → three attempts, **one** assertion, **one** decision, **one** source record.
**Q9 — can a failed attempt produce canonical evidence?** No. `executeEnrichment` returns before `persistObservation` whenever no usable field exists, and a refusal carries `fields: []`.
**Q10 — can a canonical write occur with no attempt record?** **Yes — on the manual path only, by documented design.** `requireAttemptRecord` defaults to **false**, so a recording failure is tolerated: "the tenant asked for work, and losing the audit row is a smaller harm than refusing it". The automated path passes `true` and cannot reach a provider without a record.

---

## 5. Apollo → attempt → B1b, composed (A–H in one pass)

Driven through the **automated** posture (`lease` + `requireAttemptRecord: true`), with the real recorder, real lease, real executor, real adapter, real LI-2 persistence, real B1b and the real schema. Only `safeFetch` is stubbed.

| | Evidence |
|---|---|
| **A** attempt created | one row, `organization_id` = requester, `provider_key='apollo'`, `attempt_number=1` |
| **B** lease acquired | `claimed_by='worker-g3'`, `claimed_until` set |
| **C** Apollo executed | `safeFetch` called **exactly once**; `providerCalled: true` |
| **D** assertion persisted | one `source_assertions` row, `provider='apollo'`, `normalized_value='4200'` |
| **E** arbitration executed | `applied_reason='single_uncontested_assertion'` |
| **F** canonical updated | `prospect_accounts.employee_count = 4200` |
| **G** provenance persisted | one `canonical_attribute_decisions` row, value + reason |
| **H** attempt settled | `completed_at` set, `outcome='enriched'`, `provider_call_state='called'`, `execution_status='completed'`, and **`source_record_id` equals the evidence the run produced** — the link between the two ledgers |

The pre-transport mark was observed **at the moment of transport** as `unknown`, then overwritten with `called` on settlement.

---

## 6. T1 — VERIFIED, not re-run wholesale

B2's T1 (2019/2019 across 65 suites) stands; the gate asked not to repeat it. `tsc --noEmit --incremental false` → **0 errors** after this gate's addition.

## 7. T2 — VERIFIED

- **New G-3 suite: 17/17.**
- **All 50 real-schema suites: 1148/1154, 49/50 suites passing.**

The one failing suite is **`rls_anon_exposure.test.ts` (6 tests), and it is environmental and unrelated.** Every failure is `role "postgres" does not exist`: the portable cluster was initialised with superuser `eng004`, while that suite expects a Supabase-shaped cluster owned by `postgres`. It contains **zero** references to enrichment, Apollo, `source_assertions`, `canonical_attribute_decisions` or `prospect_enrichment_attempts`. Reported rather than hidden; it is not a regression from this gate.

---

## 8. Retry results

| Case | Result |
|---|---|
| **1** successful attempt | one attempt, one decision, exactly one provider call |
| **2** retryable failure (429) | settled with the provider's verdict; `next_retry_at` **NULL** because that response carried no `Retry-After` — nothing invented; **no canonical write** |
| **3** retry | a **new numbered** attempt (1 → 2), outcomes `['rate_limited','enriched']`, canonical written once, **one** decision, **one** assertion |
| **5** replay ×3 | three attempts, **one** assertion, **one** decision, **one** source record |
| **6** terminal failure (401) | settled; no canonical value, no assertion, no decision |

**Failure paths, each asserting the attempt records it while canonical records nothing:** `no_match` (404), `provider_unavailable` (500), `rate_limited` (429), `timeout`, `credential_missing`. For `credential_missing` there was **no transport at all** and the attempt settled `refused_pre_call` / `not_called`.

## 9. Lease collision — CASE 4

Worker one claimed and did not settle, leaving the attempt live. Worker two was refused with `EnrichmentWorkClaimedError`, **performed no transport** (`safeFetch` never called), and wrote nothing — no second attempt, no evidence, no canonical value. The refusal happens before adapter resolution, so the loser cannot spend anything.

---

## 10. Tenant isolation — PARTIAL, and the defect is G-6

**What holds.** For a correct, same-tenant run, all five rows carry the same `organization_id`: attempt, source record, assertion, decision, account. Asserted as one query over all five tables, with a non-empty match set.

**What does not hold.** `prospect_enrichment_attempts` is the **only** table in this chain whose entity foreign keys are **single-column**:

```
attempts :  FOREIGN KEY (account_id)                  REFERENCES prospect_accounts(id)
evidence :  FOREIGN KEY (account_id, organization_id) REFERENCES prospect_accounts(id, organization_id)
```

| Table | Composite tenant FKs |
|---|---|
| `source_records` | 2 |
| `source_assertions` | 3 |
| `canonical_attribute_decisions` | 3 |
| **`prospect_enrichment_attempts`** | **0** |

**Observed at runtime.** Tenant A enriching tenant B's account:

- the execution **fails** and **no canonical data is touched** — no source record, no assertion, no canonical value, no decision, because the evidence layer's composite FK refuses;
- but an attempt row **is** written, with `organization_id` = A and `account_id` = B's account;
- and `provider_called: true` — **the provider had already been contacted**, so tenant A's credential was spent on a call about tenant B's account, recorded against A;
- the row settles `platform_failed` with `outcome` NULL and `source_record_id` NULL.

**Severity.** Not a canonical-integrity defect — B1b's guarantees hold completely. It is an **attribution and spend-accounting** defect, plus a defence-in-depth gap. It is **latent rather than live**: the operator route authorises through `requireTenantAccess` and the retry job lists candidates per tenant, so reaching it requires a caller that already has a tenant mix-up.

**Not fixed, deliberately.** The remedy is a migration converting two foreign keys on an existing table (both parent unique indexes already exist, so it is mechanically feasible). That exceeds this gate's "smallest authorized fix", and §10 forbids production migrations. **Recorded as G-6 and pinned by two tests** — one behavioural, one structural — so the gap is visible and a future fix flips them deliberately rather than discovering them.

---

## 11. Mutation probes — 8 of 8 killed

Real behavioural mutations only; no comment-only, zero-byte or same-value mutation. Anchor matched exactly once, bytes changed, suite required to fail, restore in `finally`, hash re-verified.

| # | Probe | Verdict |
|---|---|---|
| 1 | attempt record omitted (claim succeeds, id discarded) | **KILLED** (12 failed) |
| 2 | lease bypassed (claim path skipped) | **KILLED** (2 failed) |
| 3 | retry treated as fresh (attempt number pinned to 1) | **KILLED** (2 failed) |
| 4 | lease ownership ignored (lost claim no longer stops execution) | **KILLED** (1 failed) |
| 5 | failed provider attempt writes evidence | **KILLED** (7 failed) |
| 6 | successful result bypasses the attempt ledger | **KILLED** (12 failed) |
| 7 | cross-tenant attempt attachment (attempt attributed to a fixed tenant) | **KILLED** (13 failed) |
| 8 | duplicate retry produces a duplicate canonical decision | **KILLED** (1 failed) |

Restored byte-identically: `recordedExecution fb484a41aa6c8d0b`, `attempts af9a772af98adcb2`, `execute ee4217e213cd28eb`, `ingestionBoundary 4c3237a8fbcb9585`.

*Probe 1 first ABORTED on an anchor-indentation error of mine — reported as an abort, not as a result, and corrected.*

---

## 12. G-2 characterization — sharper than previously recorded

**Is it unreachable?** Yes. The only references to the enrichment `providersFor` are its definition (`registry.ts:163`), a re-export (`index.ts:26`) and **a JSDoc comment** (`execute.ts:181`). There is **no executable production caller**.

**Does any production caller depend on it?** No. Selection runs through `selection.ts`'s `selectAcquisitionSource` / `evaluateSource` (`execution.ts:339`), which consults neither `isAvailable()` nor `providersFor()` nor `getProvider()`.

**Will it block future autonomous selection?** The risk is worse than "a latent trap", and this is the part worth your attention: the JSDoc on `executeEnrichment`'s `providerId` parameter says

> *"Chosen by the caller from `providersFor(...)`; never taken from client input."*

That instruction **points a future implementer at a function that can never return anything**, because every tenant-credential adapter answers `isAvailable(): false` by design. Someone building capability-based selection would follow the documentation and get an empty list, and the honest conclusion "no provider is available" would be wrong.

**Recommendation only (no change made):** either make `providersFor` tenant-aware — taking an `organizationId` and asking the credential port, which is the only way the question has an answer — or delete it and correct that JSDoc to name `selectAcquisitionSource`. The cheapest safe step is correcting the JSDoc, because it is the part that actively misleads.

## 13. G-4 characterization

**Can a tenant-scoped credential safely exist in the isolated environment?** Mechanically yes, and nothing like it exists today: `integration_credentials` is present in the isolated schema and holds **0 rows**; none was added. Two obstacles make it pointless rather than unsafe:

1. the credential path runs through `credentialEncryption`, which imports a `@/config` alias the real-schema jest config does not map — the error this gate hit and routed around by stubbing the production ports;
2. a **synthetic** credential cannot authenticate to Apollo, so storing one would prove nothing that the stubbed transport does not already prove.

**What authorization would be required for real execution?** All of: a real Apollo API key; an explicit decision about **which tenant** it is attributed to, since the model is BYO-provider and that tenant is invoiced directly; and acceptance that a `no_match` is **billable** (Apollo's documentation does not say a miss is refunded).

**Is a provider sandbox available?** **UNVERIFIED — and not determinable from the repository.** The word `sandbox` appears nowhere in the enrichment module. Whether Apollo offers one is a vendor question, not a code question, and I have not guessed.

**Conclusion:** real Apollo execution remains a **separate operational gate**. Nothing in B2 or G-3 depends on it, and no credential was added anywhere.

## 14. G-1 was not changed

No `providerInferred` column exists on `source_assertions` (confirmed against the live schema: 0 columns matching `%inferred%`). No migration was authored — the census is **438**, unchanged. The evidence schema was not widened.

---

## 15. Production safety

| Claim | Evidence |
|---|---|
| No production DB | `W6_DB_URL = postgresql://…@127.0.0.1:55432/b1b_closure`; the harness independently refuses managed hosts |
| No production credential | the only credential in the suite is `synthetic-tenant-apollo-key`; the production ports are stubbed to **throw** if ever constructed, so a fallback to the real credential store would fail loudly |
| No real provider call | `safeFetch` mocked; every response a local literal |
| No migration | none authored; census unchanged at 438 |
| No deploy, no flag change | `vercel` / `railway` / `gh` never invoked; no `.env*` written |
| Docker never started | `docker ps` fails — daemon down, checked at start and end |
| Server stopped | no PID file, 0 processes, 0 listeners on 55432 |
| Implementation untouched | all six implementation files `clean` against `HEAD` except `ingestionBoundary.ts`, whose "M" is B1b's uncommitted change and whose hash `4c3237a8fbcb9585` is identical to B1b closure |
| Nothing committed | one new test file, uncommitted |

---

## 16. Remaining gaps

| # | Gap | Status |
|---|---|---|
| **G-6** | **NEW.** `prospect_enrichment_attempts` lacks the composite tenant FKs every other table in the chain has, so a cross-tenant attempt row is storable and records a paid provider call. Canonical integrity unaffected; attribution is. | **DEFECT FOUND — not fixed.** Needs an owner decision: accept, or authorize the FK migration. |
| **G-1** | `providerInferred` does not survive into the assertion | **DEFERRED** by instruction |
| **G-2** | `providersFor()` unreachable, and its JSDoc points future callers at it | **CHARACTERIZED**, recommendation only |
| **G-4** | No tenant credential anywhere; real Apollo execution is a separate operational gate | **CHARACTERIZED**, recommendation only |
| **G-5** | Apollo claims one attribute; four more deliberately unmapped | **DEFERRED** by design |
| — | `rls_anon_exposure` fails in this environment (`role "postgres" does not exist`) | **Environmental**, unrelated, pre-existing |

---

## Verdict

**G-3 NOT CLOSED.**

The attempt ledger, the lease, retry, replay, settlement and the full A–H composition with B1b are **VERIFIED**, with 8/8 mutation probes killed and no implementation change required. G-3 is held open by **one** item: §6's requirement that a cross-tenant attempt fail closed. It does not — at the attempt ledger — and the fix is a schema decision that belongs to you.

**Two ways to close it.** Accept G-6 on the grounds that canonical integrity is intact and the exposure is attribution-only and latent — in which case G-3 closes immediately with G-6 recorded as accepted. Or authorize the migration converting `prospect_enrichment_attempts.person_id` / `.account_id` to composite tenant foreign keys, after which the two pinned tests flip and G-3 closes on the stronger guarantee.

**STOP.** No second provider. No B3 / B4 / B10. Production untouched.
