# PI-STATE-OF-PROGRAMME

**Living document. This is the authoritative current state of Prospect Intelligence.**
Every other document in this directory is a frozen point-in-time artifact and is historical evidence only.

| | |
|---|---|
| **Base SHA** | `af2fb6e9` (`origin/main`, merge of PR #270 — "PI · T2 Integration / T3 Certified", 2026-09-24) |
| **Established** | 2026-09-23 |
| **Last reconciled against reality** | **2026-09-24** — see `§0.B` |
| **Method** | Six parallel read-only structural surveys over a clean worktree at the base SHA, plus orchestrator verification of every load-bearing claim |
| **Implementation status** | **MERGED, APPLIED, DEPLOYED.** WS-A1, WS-B and the WS-C / WS-D / WS-F deliverables of §3.13–§3.17 integrated on `integrate/pi-t2-001`, T3-certified at `1c0fef0c`, merged as PR #270; `origin/main` is `af2fb6e9`. Both new PI migrations are **APPLIED to production**. Railway auto-deployed `af2fb6e9` to the production worker. No flag or provider changed |

## 0.A How to read this document — evidence classes, and the cheap re-verification

This section exists because of a real failure. Three agents read the 2026-09-23
edition, saw `NOT APPLIED` against both migrations, and concluded the PI schema
did not exist — one of them wrote up "three premises the repository contradicts"
and reported that the migrations were never applied. Every one of those readings
was faithful to the document and wrong about the world. The document had drifted
and carried nothing saying how old any reading was.

So: every load-bearing claim below names its evidence class, and this is what
each class does and does not license.

| Evidence class | What it means | Cheapest read-only re-verification |
|---|---|---|
| **VERIFIED against production** | observed in the live production database, `SELECT` only | one `SELECT` over `information_schema` / `pg_catalog` for the object named |
| **PROVEN on real PostgreSQL** | executed on a disposable PostgreSQL 17 with the migrations replayed. Proves the **behaviour of the DDL**, not the state of production | `bash scripts/ci/real-schema-ci.sh` — disposable container, destroyed on exit (§3.17) |
| **CI-VERIFIED** | executed by GitHub Actions on GitHub's own PostgreSQL service container, independent of any local machine | the `Real-Schema CI` run on the SHA in question |
| `T1` / `T2` / `T3` | jest suites at a named SHA | re-run the named suite at that SHA |
| **Reasoned** | derived from the DDL or the code and never executed | nothing to re-run — treat as a hypothesis, never as a pass |
| `UNVERIFIED` | asserted somewhere, not observed | as above |

**The two classes most often conflated, and the distinction this document lives on.**
"PROVEN on real PostgreSQL" says the DDL does what it claims when it runs.
"VERIFIED against production" says it has run *there*. The first says nothing
about production; the second says nothing about untested edge behaviour. A claim
holding both is stronger than either. They are never merged here.

**⚠ Never infer applied-migration state from the migration ledger.** Both new PI
migrations were applied through the Supabase Studio SQL editor, which does not
write `supabase_migrations.schema_migrations`. The ledger therefore does not
record them while the schema carries them — see `§0.C`. Establish whether a
migration is applied by looking for its **objects**.

## 0.B Reconciliation provenance

| Reconciled | By what evidence |
|---|---|
| **2026-09-24** | Lane F — truth reconciliation. Worktree `C:/tmp/pi-lane-f-truth`, branch `pi/lane-f-truth`, base `af2fb6e9`. Evidence taken as authoritative: the operator's record of applying both migrations through the Supabase Studio SQL editor, each returning "Success. No rows returned"; the **16/16** post-apply structural verification, executed read-only by a SELECT-only verifier against production, no row drift; the real-schema execution already recorded in §3.17; and the Railway deployment record `eec3a2ab`. Re-derived independently in this worktree at `af2fb6e9`: the git history (`1c0fef0c` → PR #270 → `af2fb6e9`), the sha256 of both migration files, the presence of `.github/workflows/real-schema-ci.yml`, and an import sweep for callers of `backend/services/prospectLifecycle/**` |
| 2026-09-23 | Original establishment — six parallel read-only structural surveys at `a07477e4`; PROD-1 executed read-only over the Supabase Management API |

**Nothing in the repository was changed to make this document true.** No migration
file, no ledger row, no production object, no production code. This reconciliation
is a documentation change. Both migration files at `af2fb6e9` were re-hashed here
and still match the bytes that were applied (see `§PRE-APPLY GATE → Migrations`).

## 0.C ACCEPTED DIVERGENCE — the production ledger does not record the two PI migrations

**Do not "fix" this. Do not hand-write `supabase_migrations.schema_migrations` rows.**

| | |
|---|---|
| **Condition** | `20261027000000` and `20261028000000` are applied to the production **schema** and absent from the production **ledger** |
| **Cause** | they were applied through the Supabase Studio SQL editor. Studio executes the SQL; it does **not** write `supabase_migrations.schema_migrations`. The CLI writes that table, and the CLI was not the channel |
| **Status** | **ACCEPTED** — explicitly acknowledged by the programme owner. Not an open defect, not drift, not an incident, and not on anyone's fix list |
| **Consequence** | a ledger-row probe reports these two migrations as unapplied. That reading is **wrong**, and it is the exact mistake this document exists to prevent |
| **Correct test of applied state** | look for the objects, read-only: `SELECT to_regclass('public.prospect_lifecycle_transitions');` and `SELECT indisunique, indisvalid FROM pg_index WHERE indexrelid = 'public.uq_outreach_outcomes_id_company'::regclass;` — both were confirmed present by the 16/16 post-apply verification |
| **Why it is not repaired** | hand-writing ledger rows asserts a provenance the CLI never created, and is forbidden by standing programme rule. It would also change nothing a reader relies on: the production ledger holds **74** recorded versions against **417** local migration files, a desync of two orders of magnitude that long predates PI |
| **Effect on the deploy gate** | none that is new. `scripts/verify-schema-parity.js`'s ledger probe trips whenever the ledger holds under half the local file count, so it already reports `UNSAFE_MIGRATION_LEDGER_STATE` on every production run; `predeploy-check.js` maps that to WARN and continues unless `PREDEPLOY_STRICT_SCHEMA=1`. Two further absent rows add no signal and remove none. *Evidence: source read at `af2fb6e9`* |

## 0.0 CURRENT STATE — T2 → T3 → MERGED → APPLIED · 2026-09-23 → 2026-09-24

**Decision surface: CLOSED.** Six judgements ratified by the owner (`PI-ADR-005`). Not to be reopened without new **executable** evidence.

### VERIFIED
| | Evidence |
|---|---|
| **PROD-1** | Executed read-only over the Management API. All 187 column checks, **0 BLOCKING missing**; 3 index invariants; 1 type invariant. Ledger 74 rows through `20261026000000` |
| **DEFECT-008** | **PROVEN** — `23514` reproduced on real PostgreSQL 17, and resolved by the ratified model |
| **DEFECT-010** | **PROVEN** — `23505` reproduced, both paths, and resolved |
| **WS-C** | Real-schema verified: append-only trigger, chain, partial indexes, closed vocabularies, `::`-key refusal, cross-tenant `23503`, `seq GENERATED ALWAYS` |
| **Migration replay** | 41 migrations replayed on a disposable PostgreSQL 17, including both new ones, zero errors |
| **Real-schema tests** | **27 suites / 505 tests / 505 passed** |
| **Decision ratifications** | `PI-ADR-005` — J-1 … J-6 |
| **T3** | **CERTIFIED at `1c0fef0c`** — the tip of `integrate/pi-t2-001`, whose last commit fixes a regression the certification run found (`fix(pi-wsc): a blank prior state is corrupt, not absent`) |
| **Production apply** | Both migrations **APPLIED** 2026-09-24 through the Supabase Studio SQL editor, and **16/16 post-apply structural checks PASSED** read-only against production, **no row drift**. Evidence class: **VERIFIED against production** |
| **GitHub CI at `af2fb6e9`** | **GREEN**, including an independent `Real-Schema CI` run (`.github/workflows/real-schema-ci.yml` — migration replay + canonical invariants on GitHub's own PostgreSQL service container). A second execution of the invariants §3.17 proved locally, on hardware nobody here controls. Evidence class: **CI-VERIFIED** |
| **Production deploy** | Railway auto-deployed `af2fb6e9` to the production worker — deployment `eec3a2ab`, **SUCCESS** |

### NON-BLOCKING
- **POLICY-4 retention durations** — one legal question per record class
- **DL-3 retention integration** — PI tables absent from `RETENTION_TARGETS`; `organization_id` vs `company_id` mismatch
- **Enrichment no-evidence / billable-call observability gap** — recorded, deliberately not implemented

### APPLIED TO PRODUCTION — 2026-09-24

Applied by the human operator through the Supabase Studio SQL editor; each
returned "Success. No rows returned". **Ledger rows absent by accepted
divergence — `§0.C`.**

| File | sha256 | State |
|---|---|---|
| `20261027000000_pi_wsf_governance_anchor_after_erasure.sql` | `c91a65719d85427e3c559068ca2324e6248f40806ec09c7ea97902ffc2f71b97` | **APPLIED** — schema carries it; ledger does not record it |
| `20261028000000_pi_prospect_lifecycle_state.sql` | `368e6f6125597cae1621de0116686bbde5e2e943b259b7faa37921ba613f35ab` | **APPLIED** — as above |

Both files at `af2fb6e9` hash to exactly the bytes the pre-apply gate proposed
and the real-schema run replayed, re-confirmed in this worktree on 2026-09-24.

### AUTHORIZED AND DONE

- **Production migration application** — authorized by the programme owner; executed by the human operator on 2026-09-24
- **Post-production-migration verification** — **EXECUTED**, read-only, 16/16 structural checks passed, no row drift. Detail at the foot of this document
- **Deployment** — PR #270 merged; Railway auto-deployed `af2fb6e9` to the production worker (`eec3a2ab`, SUCCESS)

### NOT RUN — what genuinely remains

- **PI read paths against production, post-apply** — `GET /api/prospects`, `GET /api/prospects/:id`; item 6 of the post-apply list. Not a structural check and not recorded as exercised. `UNVERIFIED`
- **`scripts/verify-schema-parity.js` over its own `pg` connection** — the 187-check manifest has been evaluated against production over the Management API (§2.3.1), never through the direct `pg` path `predeploy-check.js` uses. The pooler credential is still rejected, so the gate has never run in the form a deploy runs it
- **Any production exercise of `prospect_lifecycle_transitions`** — the table exists in production, and `backend/services/prospectLifecycle/**` still has **no runtime caller** at `af2fb6e9` (import sweep over `backend`, `pages`, `lib`, `components`: only the module's own files and its two test files). No request path writes or reads it; its production row count is `UNVERIFIED`
- **End-to-end PI lifecycle test** — none exists (§3.12)
- **Deploy-gate coverage for the two objects `20261028000000` created** — `prospect_lifecycle_transitions` and `uq_outreach_outcomes_id_company` are live in production and **absent from the `scripts/verify-schema-parity.js` manifest** (40 tables / 187 column entries, 3 index invariants, 1 declared-type invariant). The gate therefore cannot see either object disappear. `DEFERRED`, with the reason below

**Why the coverage gap is `DEFERRED` and not patched (2026-09-24).** The gate's
own severity rules cannot express these objects honestly yet. A column is
`BLOCKING` only when its absence makes a tenant-reachable read path throw, and
`WARN` when the path is fail-open or degrade-only; `backend/services/prospectLifecycle/**`
has **no runtime caller**, so neither rule fits — `BLOCKING` would overstate a
path no request reaches, and `WARN` would assert a fail-open behaviour that is
false the moment the module is wired (`lifecycleReader.ts` is `if (error) throw`).
An index is `BLOCKING` only when its absence makes a write path silently persist
wrong state, and the manifest deliberately holds no performance-only index;
`uq_prospect_lifecycle_source_event` will qualify once something writes through
it, while `uq_outreach_outcomes_id_company` exists only to make a composite
tenant-safe FK possible and never qualifies. **The right time to add all three is
the change that gives the lifecycle ledger a runtime caller**, in the same commit,
so the severity is chosen against a real path rather than an anticipated one.
*Evidence: `scripts/verify-schema-parity.js` and the import sweep, both at `af2fb6e9`.*

---

## 0.1 Status register — never collapsed to green/red

| Status | Meaning |
|---|---|
| `IMPLEMENTED` | code exists and is merged to the integration branch |
| `T1 VERIFIED` | targeted tests run by the author **and re-run by the orchestrator** |
| `T2 VERIFIED` | affected-subsystem convergence run, with static guards |
| `NOT RUN` | authored but never executed. **Never reported as PASS** |
| `UNVERIFIED` | asserted somewhere but not observed in this session |
| `DEFERRED` | deliberately postponed, with the reason recorded |
| `BLOCKED` | cannot proceed; the unblocking event is named |
| `HUMAN DECISION REQUIRED` | reduced to the smallest question; engineering continues around it |
| `EXTERNAL DEPENDENCY` | needs something outside this repository |
| `PROVEN` | executed on real PostgreSQL, so the DDL's behaviour is observed. **Says nothing about production state** |
| `VERIFIED against production` | observed in the live production database, read-only. **Says nothing about untested edge behaviour** |
| `APPLIED` | the production schema carries the migration's objects, confirmed read-only. Distinct from "recorded in the ledger" — `§0.C` |
| `ACCEPTED` | a known divergence the owner has explicitly accepted. Not a defect, and not to be "fixed" |

| Item | Status | What would change it |
|---|---|---|
| WS-A1, WS-B, GAP-A/B/C, WS-D | `T2 VERIFIED` | — |
| Contracts, ADRs 002/003/004 | `IMPLEMENTED` (documentation) | — |
| GAP-A/B/C **production** evaluation | **`VERIFIED against production`** — all 187 checks evaluated read-only over the Management API 2026-09-23; **0 BLOCKING missing** (§2.3.1) | — |
| GAP-B/C index + type queries, executed | **`T2 VERIFIED`** — evaluated against production 2026-09-23 | — |
| Production schema / migration state | **`VERIFIED against production`** — 187-check gate evaluated 2026-09-23; both new migrations `APPLIED` and 16/16 post-apply structural checks passed 2026-09-24. Ledger rows absent by `ACCEPTED` divergence (`§0.C`) | — |
| Per-tenant `lead_ingestion` DB flag | **`VERIFIED against production`** 2026-09-23 — `lead_ingestion` enabled=true, org-scoped (§2.3.4) | — |
| PROD-1 | **read need SATISFIED** over the Supabase Management API (§2.3). The pooler credential itself is still rejected, so `predeploy-check.js`'s direct `pg` path remains unavailable — that residue is `BLOCKED` · `EXTERNAL DEPENDENCY` | a reissued `SUPABASE_POOLER_DB_URL` |
| DEFECT-008 `23514` | **`PROVEN`** — reproduced on real PostgreSQL 17 | — |
| DL-7 / real-schema execution | **`T2 VERIFIED`** — 27 suites / 505 tests, 41 migrations replayed on a disposable container | — |
| DL-1 | `DEFERRED` | PROD-1 — its premise is a production-only constraint |
| POLICY-1 | **RESOLVED 2026-09-23 — preservation path.** Person-scoped suppression is intentional; the four tests are architectural evidence | — |
| POLICY-4 retention **periods** | `HUMAN DECISION REQUIRED` — one question per record class; off the critical path because retention cannot be expressed for any PI table until DL-3 | legal/compliance input |
| T3 | **`CERTIFIED`** at `1c0fef0c`, merged as PR #270 | — |
| Deployment | **DONE** — `af2fb6e9` auto-deployed to the Railway production worker (`eec3a2ab`, SUCCESS) | — |
| Production migration apply | **`APPLIED`** 2026-09-24, Studio SQL editor; post-apply verification **EXECUTED**, 16/16 structural, no row drift | — |

---

**Verification legend.** `VERIFIED` = observed directly at this SHA or against a live platform API in this session. `UNVERIFIED` = not observed; may be true. A prior report is not verification.

---

## 0. The one-paragraph summary

Prospect Intelligence can **record** a prospect end to end — identity, provenance, governance, ICP, scoring, recommendation, readiness — and can **execute one outreach task** through a human approval gate and faithfully write down what happened to it. It cannot **discover** a prospect, and it cannot **decide what to do second**. Those two absences, plus the absence of any prospect lifecycle state, are the programme. Almost everything else is either already built, or small.

**Refined 2026-09-24.** The third absence has moved but not closed. A prospect lifecycle state machine and its append-only ledger now exist and are **`APPLIED` to production** (§3.15), so the gap is no longer "there is no such thing" but "nothing calls it" — the module has no runtime caller, and the decision that would let outcomes drive it, ARCH-1, is still open. The other two absences are unchanged.

---

## 1. Architecture — preserved as baseline

The frozen spine in `PI-ADR-001.md` stands and is **not** being redesigned:

```
SOURCE → OBSERVATION → IDENTITY RESOLUTION → CANONICAL PROSPECT
       → ENRICHMENT → SCORING → RECOMMENDATION/NBA → READINESS
       → OUTCOME → LEARNING (proposal only)
```

Canonical entities, unchanged: `companies` = tenant · `unified_persons` = canonical person · `prospect_accounts` = external employer · `canonical_leads` = prospect/pursuit record · `leads` = web-form capture · `lead_intelligence` = derived observation · `active_leads` = derived snapshot.

The Do-Not-Build register stands. No second lead/person/account model, no second ICP engine, no second suppression engine, no PI message-sending infrastructure.

**One frozen decision has changed**, by owner decision on 2026-09-23: see `PI-ADR-002-reassessment-seam.md`. Outcomes become evidence into the intelligence context and its fingerprint; they do not become decisions. PI still never sends, learning still proposes only, ratification stays human, suppression still overrides everything.

---

## 2. Ground truth

### 2.1 Repository and deployment — VERIFIED

| Fact | Value |
|---|---|
| `origin/main` | **`af2fb6e9`**, 2026-09-24 — merge of PR #270; T3-certified tip `1c0fef0c` |
| Local `main` | `fef34178` — **229 commits behind** as read on 2026-09-23, further behind since PR #270; do not analyse against it |
| Orchestration worktree | `C:/tmp/pi-base` @ `a07477e4`, `node_modules` junctioned, `.env.test` present |
| User working tree `C:/virality` | branch `preserve/creator-canonical-template-pool`, 29 modified + 62 untracked — **untouched, and to remain so** |
| T1 harness in worktree | working — `npx jest piIcpProposalTargets` → 38/38 pass |
| Test env safety | `backend/tests/setupEnv.ts:39` refuses to run without a non-production env file; `.env.local` is never loaded by tests |
| PI migrations authored | **14** — 12 in `20261011000000` → `20261022000000` (counted from the directory at this SHA, correcting a prior figure of 13) plus `20261027000000` and `20261028000000`, both **APPLIED to production** |
| Last PI-touching merge | **PR #270, 2026-09-24** (`af2fb6e9`); previously PR #248, 2026-09-16 |

### 2.2 Production flags — VERIFIED via platform CLIs

| Flag | Vercel prod | Railway prod | Effect |
|---|---|---|---|
| `ENABLE_LEAD_INGESTION` | present (15d) | **`true`** | outer ingestion kill switch OPEN |
| `ENABLE_ENRICHMENT_SPEND_CEILING` | present | absent | ceiling enforced on Vercel only |
| `LEAD_UNDERSTANDING_ENABLED` | **absent** | **absent** | shadow runtime dark (PI read path does not need it) |
| `LEAD_UNDERSTANDING_AUTHORITATIVE` | **absent** | **absent** | authoritative flip not taken |
| `PI_RETRY_SCHEDULER_ENABLED` | **absent** | **absent** | enrichment retry job inert |
| `PI_RETRY_SCHEDULER_ORG_IDS` | **absent** | **absent** | second gate also closed |
| Any provider API key | **absent** | **absent** | credentials are per-tenant, encrypted store |
| `CRON_INTERVAL_SECONDS` | — | `1800` | cron ticks every 30 min |

The inner gate — a per-tenant `lead_ingestion` row in `feature_flags` — is **UNVERIFIED** (requires a DB read).

### 2.3 Production database — **PROD-1 EXECUTED 2026-09-23. READ-ONLY. NO MUTATION.**

**Access path.** The pooler credential in `.env.local` remains rejected and was **not** retried. PROD-1 ran over a *different* legitimate channel: the Supabase **Management API** (`POST /v1/projects/{ref}/database/query`) using the `SUPABASE_ACCESS_TOKEN` already present in the environment. Every statement was a `SELECT`, behind a local guard refusing any string matching `insert|update|delete|drop|alter|create|truncate|grant|revoke|copy`. No DDL, no DML, no migration, no configuration change. Production is PostgreSQL 17.6.

#### 2.3.1 The authored gate, evaluated — **ALL PI CHECKS PASS**

| Check class | Result |
|---|---|
| Column manifest — 187 checks / 40 tables | **155 present, 32 missing — 0 BLOCKING**, 16 WARN, 16 INFO |
| GAP-B — 3 idempotency indexes | **ALL PRESENT**, `unique=true`, correct partiality, `valid=true` — `indisvalid` here comes from the ad-hoc read-only `pg_index` query used for PROD-1 and the post-apply verification, **not** from `verify-schema-parity.js`, which does not read it (§8) |
| GAP-C — `source_records.ingestion_run_id` | **`text`** — the uuid→text conversion IS applied |

The 32 misses are 8 entirely-absent tables, **all Writer/content-platform**: `content_quality`, `content_block`, `content_recommendation`, `content_approval_history`, `content_performance`, `learning_intelligence`, `learning_memory`, `content_prediction`. **Not one is a PI table.** Classification **B — migration not applied**, owned by the Writer programme, pre-existing, out of PI scope.

**Every one of the 68 BLOCKING checks passes.** The red gate I warned to expect did not occur, and that is now evidence rather than hope.

This also retires an earlier reading of mine. PR #234's verdict — *"32 missing … none is PI-related"* — I took to mean "PI was never in scope". Correct about the **old** manifest. With PI now in scope the count is **unchanged at 32**, which means the PI surface genuinely **is** complete.

#### 2.3.2 The six WS-6/WS-7 columns are PRESENT

`unified_persons.{authority, influence, buying_role}` and `prospect_accounts.{market, business_model, growth_stage}` all exist. Migration `20261013000000` **has been applied** since the 2026-09-04 Phase-B verification that found all six absent. The `42703` condition that blocked activation is **gone**. Ledger: **74 rows**, through `20261026000000`, including the PI enrichment series to `20261022000000`.

#### 2.3.3 The spine is no longer empty — ingestion has run

| Table | Rows | Was (2026-09-04) |
|---|---|---|
| `unified_persons` | **24** | 23 |
| `identity_claims` | **43** | 42 |
| `canonical_leads` | **19** | 18 |
| `prospect_accounts` | **1** | **0** |
| `source_records` | **1** | **0** |
| `source_assertions` | 0 | 0 |
| `prospect_icps` / `_versions` | 0 / 0 | 0 / 0 |
| all `outreach_*`, `outreach_governance_config` | 0 | 0 |

The single `source_record`: `provider=manual`, `entity=person`, `observation_count=1`, carrying **both** a person and an account, dated **2026-09-08**.

**Phase C of the activation plan was executed on 2026-09-08.** A prospect went end to end — person → account → prospect → provenance. The programme's standing *"built and unexercised"* characterisation is **no longer accurate**.

⚠ `source_assertions` is **0** against `source_records` = 1. Either the manual adapter asserted no attributes beyond identity, or assertion recording did not fire. **Classification E — unknown.** Worth one investigation; not blocking.

#### 2.3.4 Flags and credentials — verified, not inferred

- `feature_flags`: **`lead_ingestion` enabled=true, org-scoped** — a tenant **is** enabled. `enrichment_spend_ceiling` enabled=true, org-scoped.
- `integration_credentials`: **6 rows, one `apollo`.** A tenant has stored an Apollo credential.

That makes **WS-B's DEFECT-001 fix immediately consequential rather than theoretical**: before it, the planner discarded tenant source statuses and answered `no_available_source` for every field *despite* a stored credential.

---

### 2.3.5 Superseded — the former blocked state

> **Read this subsection as history only.** Every `UNVERIFIED` it lists was
> resolved by §2.3.1–§2.3.4 on 2026-09-23 and by the post-apply verification on
> 2026-09-24. It is kept because the *access* obstacle it describes is still
> partly real — the pooler credential remains rejected — while the *knowledge*
> obstacle is gone.

**Status at 2026-09-23, re-checked without a blind retry:** `.env.local` is unchanged since `2026-09-13 11:56` — same host, same user, same 16-character secret that previously failed with `password authentication failed for user "postgres"`. Both fallbacks the verifier accepts, `SUPABASE_DB_URL` and `DATABASE_URL`, are **absent**. There is no alternative mechanism in the environment, so the verification was **not attempted again**.

Two independent obstacles remain, both needing the operator:

1. **The permission classifier denies production reads.** A read-only row-count probe was refused.
2. **The pooler credential is rejected.** Almost certainly stale since the 2026-09-12 credential rotation.

Consequently **UNVERIFIED**: which of the 13 PI migrations are applied; every PI table row count; whether any tenant holds the `lead_ingestion` flag; whether any tenant holds an `outreach_governance_config` row; whether any provider credential is stored.

### 2.4 The schema-parity gate did not cover PI — VERIFIED as at 2026-09-13, CLOSED by WS-A1

PR #234 (`d98b3b7f`, 2026-09-13) genuinely fixed `scripts/verify-schema-parity.js`: it previously read `information_schema` through PostgREST, exited 2 on every run in every environment, and `predeploy-check.js` mapped that to "SKIPPED (env unavailable)" — so the gate **reported an environmental excuse forever and never compared a single column**. It is now a direct `pg` connection, is test-guarded against exiting 0 on failure, and I confirmed it exits 2 rather than 0.

That commit records the first real verdict: *"71 columns checked, 32 missing (0 BLOCKING / 16 WARN / 16 INFO), ledger 54 recorded vs 398 local files, exit 3 … none is PI-related."*

**"None is PI-related" must not be read as "the PI schema is healthy."** `REQUIRED_COLUMNS` in that script covers **21 tables, none of them a PI table**:

```
bolt_execution_runs, queue_jobs, scheduled_posts, active_leads, opportunity_feed_items,
content, content_variant, content_revision, content_asset, content_memory,
content_originality, brand_memory, content_quality, content_block, content_recommendation,
content_approval_history, content_performance, publication_lineage,
learning_intelligence, learning_memory, content_prediction
```

`generated/schema-column-manifest.json` is narrower still — `watched_tables` is `["companies","users"]`.

**So the PI schema had zero deploy-gate coverage.** Not one of `unified_persons`, `prospect_accounts`, `source_records`, `source_assertions`, `prospect_enrichment_attempts`, `prospect_icps`, `prospect_icp_versions`, `canonical_leads`, `outreach_tasks`, `outreach_outcomes`, `contact_governance_records`, `identity_claims` was checked before a deploy. Fixing the credential alone would have verified nothing about PI.

**Corrected 2026-09-24 — this subsection is now a diagnosis, not a current state.** It was written in the present tense and reads as one; three readers took it that way. GAP-007 is **CLOSED** by WS-A1: `REQUIRED_COLUMNS` now spans **40 tables / 187 entries** covering all 13 PI tables, plus 3 index invariants and 1 declared-type invariant, and the manifest was evaluated against production with **0 BLOCKING missing** (§2.3.1, §8). *Evidence: `scripts/verify-schema-parity.js` read at `af2fb6e9`.* What remains uncovered is named in §0.0 under `NOT RUN`: `prospect_lifecycle_transitions` and `uq_outreach_outcomes_id_company`, introduced by `20261028000000`, are **not** in the manifest.

---

## 3. Current state by capability

Verdicts are `BUILT` / `PARTIAL` / `ABSENT`, all at `a07477e4`.

### 3.1 Discovery — **ABSENT where it matters**

| Capability | State |
|---|---|
| Ingestion contract, registry, orchestrator, dual gate, 3 HTTP routes | **BUILT** |
| Registered sources | `manual`, `crm`, `csv` — **all operator-supplied**. Zero provider adapters |
| Engagement → PI prospect | **ABSENT** — engagement yields `lead_signals` + `contacts` + one `external_id` claim, then stops |
| Problem/buying-situation discrimination | **BUILT but disconnected** — `leadDetectionService`, `engagementOpportunityService` (incl. `problem_discussion`), `opportunityClassifierService`, `buyerIntentIntelligenceService` all exist and none reaches the PI spine |
| Community/listening → PI prospect | **ABSENT** — full pipeline exists, terminates in `lead_intelligence` |
| MarketPulse as discovery | **ABSENT, structurally** — every `market_pulse_*` row is keyed to the tenant; `entities` is `[]` on every finding; `marketPulseAttributeCoverage()` returns `[]` |
| Sales Navigator adapter boundary | **ABSENT** — catalogue declaration only |
| Extension → PI evidence (the real people-data path, incl. Sales Navigator `raw_context`) | **BUILT, NO RUNTIME CALLER** — `extensionBridge.ts` is written and tested; `pages/api/extension/events.ts` never calls it |

**The structural finding — CORRECTED 2026-09-23.** An earlier version of this section said `canonical_leads` is written by exactly one path and that discovery never reaches the PI spine. Both were wrong, and the correction matters:

- **`canonical_leads` has two writers.** `prospectIdentity/prospectResolution.ts:229` via the ingestion orchestrator (writes `lead_status: null`, deliberately), **and** `crmIngestionService.ts:233` — which also does a **full-row UPDATE at `:226` on every re-ingest**, writing `lead_status` from the customer's own CRM string (`:210`). That column has no CHECK constraint.
- **`adoptLead` reaches the person spine.** It is not merely a `lead_intelligence` write: `leadIntelligencePorts.ts:13-26` → `resolveUnifiedPerson` → **`INSERT INTO unified_persons`** at `identityResolutionService.ts:362`. So generic engagement carrying an email or phone **already mints a canonical person today**. Only bare social handles are refused, by `socialContactResolution.ts:22-29`.

The accurate statement: every discovery mechanism (`engagement`, `community`, `marketpulse`, `website`, `crm`) calls `adoptLead(...)`, which writes `lead_intelligence` **and can mint `unified_persons`** — but none of them creates a **Prospect**. There are two parallel lead systems; **PI's Prospect entity is on the side with no discovery**, while the person spine is already reachable from ungated engagement. That live pollution vector is an argument *for* the candidate model, not merely an argument about tidiness.

### 3.2 Identity, provenance, governance — **BUILT**

Conservative resolution with deterministic tenant-scoped keys; ambiguity parks and never merges (a merge executor exists in SQL and is refused in code). Provenance retains value + source + `observed_at` + confidence. RULE A/B/C is implemented: one uncontested value applies, disagreeing sources withhold, an existing canonical value is never overwritten. Suppression is 4 stores / 3 evaluators with a frozen precedence, and fails closed at every read.

Two structural weaknesses, both **BUILT-but-incomplete**:
- **No arbitration.** Disagreement withholds permanently. `source_assertions.superseded_at` is read but **never written by any production file**, so an assertion can never be retired — and RULE C makes the first canonical value permanent.
- **No freshness column.** Freshness is a caller-supplied window, not stored evidence.

### 3.3 Enrichment — **BUILT and UNREACHABLE**

27 files, ~7,400 lines, 13 migrations: registry, contract, selection, cost, per-tenant credentials, execution, spend ceiling, observations, persistence, attempt records, leases, provider call state, retry candidates, retry consumer, cron job. Apollo and Clearbit adapters exist. Safety is genuinely good — one provider call per authorised request, cost authorised before egress, a durable pre-transport marker so a crash mid-call is provable, `unknown` transport never auto-retried.

It cannot be reached in production — see `DEFECT-001`. Also: no proactive scheduler exists (by design, stated in five places); the retry job is doubly flag-dark; **enrichment emits no telemetry at all**; and there is no UI that triggers enrichment.

### 3.4 Offering & understanding — **the orphan**

`backend/services/offeringIntelligence/**` is a complete 24-facet offering ontology — `customerProblems`, `valueProposition`, `outcomes`, `differentiators`, `capabilities`, `personas`, `industries`, `icpAlignment` — with twelve engine functions and tests. It has **zero consumers, no database table, and no writer** (`persistence.ts:1-5`: "NO writer wired in Phase B").

Every prior document called the offering model "its own programme with its own discovery." That is wrong. The **sell side is built and orphaned**. What is genuinely missing is the **buy side**: nothing in intake, enrichment or engagement captures a prospect's problem. Timeline entries carry no text; `lead_signals.content_text` exists and is never projected into the scoring context.

`prospectIcp/generator/prompt.ts:32` already names the gap: `UNREPRESENTABLE_CONCEPTS = ['problem_relevance', 'product_service_alignment']`.

### 3.5 ICP — **BUILT**

Closed criterion vocabulary (14 account + 9 person attributes), abstention-correct evaluator, AI proposer wired to a route and a workspace UI, ranked-shortlist targets collapsed into one union criterion (avoiding the 1/5 = 0.2 scoring defect), and human ratification enforced at three layers — route, service, and a database CHECK. This is the programme's best work and the pattern the AI control plane should copy.

### 3.6 Scoring — **PARTIAL, and thinner in practice than on paper**

`SCORE_DIMENSIONS = ['intent','icp','urgency','opportunity','priority']`. Nineteen engines, deterministic, abstention-correct, no fabricated zeroes. Four further dimensions (Problem Fit, Account Potential, Buying Role, Relationship Strength) report `not_implemented` with a reason.

**But on the production path, `opportunity` and `urgency` always abstain**, because `prospectContext` never populates `ctx.signals` (no bridge from `lead_signals.source_type ∈ {engagement, listening}` to the 18-value `BuyingSignalType` — deliberately, to avoid inventing a trigger event) and never populates `ctx.qualification`. Of five dimensions, only `intent`, `icp` and `priority` can produce a value.

`engines/explainability.ts` is fully built — `whyNow`, `whatChanged`, `uncertainty`, per-claim contradictions — and **is surfaced nowhere**.

### 3.7 NBA, readiness, execution — **BUILT for one shot**

Readiness is genuinely good: four states, fails closed at four distinct points, exact channel matching, canonical evaluator. Execution is a complete per-task ledger — materialize → approve (compare-and-set, audited) → dispatch (governance-gated, quota-reserved) → delivery evidence → outcome.

The canonical NBA vocabulary is **three actions**: `personalized_outreach | nurture_sequence | monitor`. It is computed at read time, **never persisted** (`lead_understanding_shadow` has a migration and no writer), and there is a third, undocumented producer (`leadIntelligenceEngine/recommendationEngine.ts`) which is the only thing in the repo that reasons about dormancy — driven entirely by website-visit recency, never by outreach.

### 3.8 Lifecycle — **BUILT and APPLIED, ABSENT at runtime**

**Corrected 2026-09-24 — read the verdict as ABSENT *at runtime*, not absent from the repository.** The sentence that opened this section, *"There is no prospect lifecycle state machine"*, was true at `a07477e4` and is now false. WS-C delivered one (§3.15): `PROSPECT_STATE_MODEL` over the shared engine, six resting states plus initial, 24 edges, and an append-only ledger `prospect_lifecycle_transitions` which is **`APPLIED` to production** and `VERIFIED against production`. What is still absent is its **activation**: `backend/services/prospectLifecycle/**` has no runtime caller at `af2fb6e9`, so no request path writes or reads a transition, and everything the rest of this section says about the consequences — a replied prospect being indistinguishable from an uncontacted one — still holds in production today. The wall described at the foot of this section is also untouched: ARCH-1 is still undecided.

The seven pre-existing status vocabularies below remain as they were, and none of them is authoritative for a PI prospect:

- `canonical_leads.lead_status` — free text, **no CHECK, no vocabulary**; PI's own resolver writes `null` to it and PI never reads it
- `journeyState` — website telemetry, emitted only as a metric
- `FunnelStage` — a recomputed label, not a machine
- `active_leads` — has `bucket` and `change_status`, **no `status` column at all**
- `operational_states` — the only real lead state machine (`new → qualified → working → meeting_scheduled → proposal → won/lost/archived`), **entirely manual and PI-disconnected**
- `outreach_tasks.status` — a real 17-state machine, but **per-task, not per-prospect**
- `prospect_accounts.status` — identity status, not sales

**And there is a deliberate, test-enforced one-way wall.** `feedbackIngestion.ts` states it and guard tests enforce it: *"business outcomes are observational and do not drive lifecycle state."* The scoring fingerprint contains no outreach table. No activation reason references an outcome. Consequently: a prospect who replied, booked a meeting, converted, or ignored five emails is — from PI's point of view — in exactly the same state as one never contacted.

Downstream of that: no-response intelligence **ABSENT** (the `no_response` derivation rule is documented in four places and implemented in none); follow-up sequencing exists but is **open-loop and response-blind** (a static delay ladder; `depends_on_plan_task_id` is stored and never read); meeting/handoff **ABSENT** (`meeting_booked` is classified unobservable — there is no booking integration); nurture and reactivation are **display strings with no mechanism**.

### 3.9 AI control plane — **ABSENT for prospects; the machinery exists**

Zero prospect references in any chat, agent, or copilot surface. But the reusable machinery is substantial and built: an agent runtime with approval gates and deterministic recovery, a capability registry with a tool orchestrator, an LLM gateway, and a grounded, audited, deterministic copilot (`active-leads/copilot.ts`) that already refuses autonomous LLM calls. **Native LLM function-calling is absent repo-wide.**

PI touches an LLM in exactly one place: the ICP generator.

### 3.10 Learning — **ABSENT**. The outcome corpus is a read seam that proposes nothing, by explicit contract.

### 3.11 Observability — **PARTIAL**

Identity and outreach telemetry are rich and correctly bounded (no tenant labels, no PII). **Enrichment telemetry does not exist** — no counter for provider call, refusal, spend-ceiling hit, lease claim, or retry outcome. **There is no operator surface for PI anywhere** — 15 super-admin pages, 6 admin pages, 9 admin components, and the monitoring directory contain zero PI references.

### 3.12 Tests — **BUILT (unit), PARTIAL (real-schema), ABSENT (e2e)**

~132 PI test files; **27 real-schema suites** that verify DDL invariants against a live Postgres container — the 25 pre-existing ones plus the two authored by WS-F and WS-C. They are no longer unexecuted: **505 tests / 505 passed** on a disposable PostgreSQL 17 with 41 migrations replayed (§3.17), and the same invariants ran independently under `Real-Schema CI` at `af2fb6e9`. **No end-to-end PI lifecycle test exists.** The nearest thing is a script, not a suite.

Per an existing programme note, the real-schema harness is raw `pg` while ingestion writes via PostgREST — so **the application write path has never executed against real constraints**.

---

## 3.13 WS-D — offering activation, DONE (read-time, no schema)

`offeringIntelligence/**` is **sound, tested and not duplicative** — 1,081 lines, 23 files, one owner (`assembleOfferingUnderstanding`), every engine abstaining without input. Its only gap versus `leadUnderstanding` was the half that programme has and this one did not: an **async context builder** and a **read composer**.

**Activated with no migration**, because `leadUnderstanding` has no table either — `lead_understanding_shadow` exists and nothing writes it; the understanding is computed per request. A third store was avoided: `company_intelligence_products` and `report_settings.market_pulse.core_offerings` are already two partial copies of the same fact.

Built: `tenantOfferingContext.ts` (the missing builder — one tenant-scoped `company_profiles` read, a pure row→seed mapper, typed gaps) and `problemFit.ts` (the seam — `readTenantOfferingUnderstanding` plus `assessProblemFitReadiness`, which returns a literal `scorable: false`). `SCORE_DIMENSIONS` untouched; no write verb in either file, asserted structurally.

**The judgement worth recording:** only `ctx.seed` is populated and the engine inputs are left deliberately empty, so **every offering score dimension abstains**. The twelve engines score adoption, market fit, differentiation and maturity from *observed market* evidence; a tenant's own self-description is not that, and feeding it in would manufacture four scores out of one paragraph. The facets Problem Fit needs come from the seed and are fully populated.

**Three structural losses, now recorded rather than hidden:** `company_profiles` is one row per tenant, so three offerings share one problem statement; `offeringType` is unknowable from an undifferentiated `products_services`; and 10 of 24 facets have no column at all.

**What Problem Fit still needs, and this workstream cannot supply:** a prospect-stated problem (nothing captures one); `lead_signals.content_text` exists and is never projected into the scoring context; `problem_relevance` and `product_service_alignment` are `UNREPRESENTABLE_CONCEPTS` on the ratified ICP surface; a defined representation and weight for the dimension; and per-offering semantics the schema structurally cannot hold.

**Deliberately not done:** the seam is **not wired into `prospectIntelligenceRead.ts`**. Doing so would change `PROSPECT_API_VERSION` and add a `company_profiles` read to every prospect-detail request. It is a small, separable change and is left as an explicit decision rather than slipped in.

---

## 3.14 WS-F — person erasure defined; DEFECT-008 and DEFECT-010 resolved in code

**The orchestrator's hypothesis was largely right and wrong in one load-bearing way.** Right: the database is not broken, the FK and CHECK are coherent for both-anchored and target-only rows, and the real defect is an undefined erasure path. Wrong: *"the fix may need no migration at all"* is **false**, because —

> `contact_governance_has_anchor` is **not predicated on `revoked_at`** — confirmed against production: `CHECK ((person_id IS NOT NULL) OR ((target_normalized IS NOT NULL) AND (length(btrim(target_normalized)) > 0)))`.

Two consequences. **Revoking is not a remedy** — a revoked person-only row still has its `person_id` nulled and still raises `23514`. And **revoked history cannot be repaired by any procedure**, because ADR §16 forbids touching any field but `revoked_at`/`revoked_reason`; writing today's address onto a record in force two years ago would fabricate history. Append-only governance therefore forces **exactly one CHECK change** — not the FK, not the index, not the vocabulary.

**DEFECT-010 confirmed**, plus a second reachable path the orchestrator did not identify: two *different* people sharing a target, deleted in one statement (a tenant cascade), collide with each other — no pre-existing target row needed.

**Selected model — re-anchor, revoke, delete** (`prospectIdentity/personErasure.ts`): read contact points from `identity_claims` **before** the delete (that edge CASCADEs); read **every** governance record naming the person **including revoked ones**; carry enforceable instructions forward as target-anchored records preserving the original `effective_from`; revoke the originals with a reason, which removes them from the partial index and makes DEFECT-010 unreachable; delete tenant-scoped; return `suppressionsLostToErasure`.

**Writer/reader changes: none.** The three governance modules are unmodified; the only change outside new files is an export block. Channel binding is explicit — `email` records carry only onto email claims, `*` onto both; `domain`/`external_profile`/`external_id` are excluded because `normalizeGovernanceTarget` has no normaliser for them and carrying onto them would produce governance that *looks* enforced and is not.

**Honest narrowing, stated not hidden:** after erasure the instruction blocks every address the platform knew, on the channels it governs — it cannot block an address never recorded. The re-import hole stays closed (a new person resolved from a carried address is still blocked by target match). Where a person had a person-only suppression and no contact point, the instruction genuinely ends; it is revoked with a reason and **reported**.

**Production confirms the migration is safe:** `contact_governance_records` holds **0 rows — 0 person-only, 0 revoked**. The live CHECK matches the migration's preflight assumption exactly, and the person FK is `confdeltype='n'` (SET NULL) as it expects.

**Open decision for the ADR owner:** `ON DELETE NO ACTION` on the person FK would make both defects structurally impossible with no CHECK change, and is LI-4C.1's own remedy for the identical failure — but it reverses D-3 and falsifies `li3_contact_governance.test.ts:311`. WS-F declined to reverse a ratified decision. The erasure procedure is needed and correct either way; only the migration would change.

**Status:** `IMPLEMENTED` · `T1 VERIFIED` (161/161, re-run by the orchestrator) · `T2 VERIFIED` (T2-004: 16 suites / 444 tests, three static guards exit 0) · **`T3 CERTIFIED`** at `1c0fef0c`, merged as PR #270.

Migration `20261027000000` is **`APPLIED` to production** — 2026-09-24, Studio SQL editor, ledger row absent by `ACCEPTED` divergence (`§0.C`) — and the post-apply CHECK definition, including the retained live-row requirement, was **`VERIFIED against production`** read-only.

**Corrected 2026-09-24.** The sentence that stood here — *"The real-schema suite (27 tests) is NOT RUN — no Postgres, no Docker; both defects are proven against a strict model of PostgreSQL derived from the DDL, which is evidence, not proof"* — was already stale when §3.17 was written and is retracted. Docker became available, the suite **RAN** (27 suites / 505 tests / 505 passed, 41 migrations replayed on a disposable PostgreSQL 17), and DEFECT-008 and DEFECT-010 are therefore **`PROVEN` on real PostgreSQL**, not reasoned from a model of it. The same invariants were then executed independently by `Real-Schema CI` on GitHub's own PostgreSQL at `af2fb6e9`.

---

## 3.15 WS-C — the prospect lifecycle ledger, DELIVERED

**8 new files, 0 existing files modified.** The shared engine in `lib/operations/operationalStateModel.ts` is handed a `PROSPECT_STATE_MODEL` config — not forked, not copied, not edited; its test file is untouched and still passes.

**Six resting states + initial**, 24 edges. Four are judgements rather than readings:
- `identified → engaged` — `engagement_threads` exist independently of anything PI initiated, so an inbound reply can reach an unjudged prospect. Refusing it would force the writer to fabricate a `qualified` transition it has no evidence for.
- `not_interested → engaged` — `rejected` means "not interested in THIS" and is distinct from `unsubscribed`. A later `replied` is real and observable. So `not_interested` is **not** terminal.
- **`closed_disqualified` has no exits**, unlike `DEFAULT_STATE_MODEL`'s re-openable terminals. A close can be caused by `unsubscribed`; a re-openable close would let the ledger say "pursue" about someone who asked never to be contacted — the same compliance failure class as a stale stored `suppressed`.
- `meeting_scheduled` is **contract-only and unreachable today** — its only cause is `meeting_booked`, which is unobservable. It is in `PROSPECT_STATES_UNREACHABLE_TODAY`, so the gap is *reported* rather than silently never-populated.

**`outreach-active` is a PROJECTION, not a state** — so six states, not seven. PI DECIDES, OUTREACH EXECUTES: a persisted copy would be a mirror PI cannot keep current, and stale `outreach-active` after every task was cancelled is the same lie-shape as a stored `suppressed`. The projection joins on the **person** edge, because `outreach_tasks.lead_id` is `text` and A3 records it is *not proven* to be a lead id; a test asserts `lead_id` is never a filter. Consequence recorded: the resting position while outreach runs is `qualified`, and reactivation is `nurture → qualified` — a deviation from ADR-004 §4.1's wording, not its intent.

**Re-ingestion stability is structural, not conventional.** `prospect_id` is `uuid` with a composite tenant FK, so a `::`-delimited leadKey is **unrepresentable**, not merely discouraged. `source_event_key` is colon-free by CHECK — with a separately-named `prospect_lifecycle_event_key_no_leadkey` constraint so the refusal is visible in the name a reviewer reads. A test asserts the migration's regex and the TS pattern are the same string. LI-2 re-ingestion bumps `observation_count` on the same row, so an unchanged observation yields the same key and no new transition, while a changed payload yields a new hash, row and key — the required behaviour for free.

**Debounce resolved caller-side**, three layers: `same_state` is intercepted *before* the shared engine is called, so its test-locked meaning for four other entity types is untouched; a 6h window returns `unchanged, wrote:false` rather than a 409; and a partial unique index on `source_event_key` gives duplicate-event idempotency by `23505`, never `ON CONFLICT` (`42P10`).

**Status:** `IMPLEMENTED` · `T1 VERIFIED` (102/102 after renumber, re-run by the orchestrator) · `T2 VERIFIED` (T2-005: 23 suites / 593 tests, four static guards exit 0) · **`T3 CERTIFIED`** at `1c0fef0c`, merged as PR #270 — the certification run found and fixed a regression in this workstream (`a blank prior state is corrupt, not absent`).

Migration `20261028000000` is **`APPLIED` to production** — 2026-09-24, Studio SQL editor, ledger row absent by `ACCEPTED` divergence (`§0.C`). `prospect_lifecycle_transitions` and `uq_outreach_outcomes_id_company` were **`VERIFIED against production`** read-only, the table with its 3 unique indexes, 2 indexes, 3 triggers, RLS enabled and 1 policy, the index present, unique and valid.

**Corrected 2026-09-24.** The claim *"Real-schema suite (27 tests) NOT RUN"* is retracted: the suite **RAN**, and this table and both partial unique indexes were created and exercised among the 41 migrations replayed on real PostgreSQL 17 (§3.17).

**Still `NOT RUN` in production, and worth saying plainly:** nothing writes the ledger yet. `backend/services/prospectLifecycle/**` has **no runtime caller** at `af2fb6e9` — an import sweep over `backend`, `pages`, `lib` and `components` finds only the module's own two files and its two test files. The table exists in production; its row count is `UNVERIFIED`; no request path reaches it.

### 3.15.1 A collision caught at integration

WS-F and WS-C ran in parallel and **both authored `20261027000000`**. Each passed `check:migrations` in its own worktree because each saw only its own file. A duplicate version prefix is the exact failure this repo's ledger is already full of — the CLI orders by numeric version, records the version complete after one arbitrary file runs, and silently skips the rest. WS-F keeps `20261027000000` (merged first); the lifecycle ledger moved to `20261028000000` with its three in-repo references updated. **Post-merge there are no duplicate full-version prefixes among post-floor migrations.**

### 3.15.2 Judgements flagged for reversal

1. **A tenant hard-delete is now blocked** — `organization_id` cascades `companies → canonical_leads →` this table and the append-only trigger refuses DELETE. Identical to what `opportunity_lifecycle_states` has done since `20260520`, so precedent rather than new hazard, but real. Pointed at `PI-CONTRACT-002` rather than inventing a purge path.
2. **An index was added to another domain's table** — `uq_outreach_outcomes_id_company`, additive and idempotent against a verified-empty family, needed because no tenant-safe composite FK to the evidence was otherwise possible. If cross-domain additions need Outreach sign-off, this is the line.
3. **The chain trigger + advisory lock exceeds the brief** — judged necessary because without it "current state = latest row" is not coherent under concurrency. Easy to drop.
4. **`origin='human'` requires `actor_user_id` by CHECK** — makes the flag meaningful, but rejects a human transition arriving through a service path with no user id.

### 3.15.3 Open question

Whether ADR-004's `closed/disqualified` was **one state or two**. Read as one and named `closed_disqualified`. If two, the vocabulary is seven resting states and the migration CHECK changes.

---

## 3.16 Parked — verified dead code, deliberately not removed

`backend/services/strategicIntelligenceService.ts` has **zero importers**, verified independently by the orchestrator across `backend`, `pages`, `lib`, `components` and `scripts`, including a dynamic-import sweep. The only nearby hits are differently-named files (`strategicIntelligenceMetrics`, `strategicIntelligenceOrchestrationService`). A doc in `docs/` claims it is "imported elsewhere"; that claim is **false**.

**Parked rather than removed.** It delivers no immediate programme value, and removing it would widen the blast radius of a cycle whose objective is real-schema verification. The verification above is recorded so the deletion is a five-minute job whenever someone wants it. Status: `DEFERRED`, not `BLOCKED`.

---

## 3.17 Real-schema execution — DONE. Both defects PROVEN, both migrations EXECUTED.

**Environment.** Docker Desktop was installed but dormant; starting it gave the repository's own supported path. `scripts/ci/real-schema-ci.sh` manages a disposable `pgvector/pgvector:pg17` container (`w6-real-schema`, port 5433) and drives it via `docker exec psql`, so no host Postgres is needed — which is why the absence of `psql`, `initdb` and any local install did not matter. There is genuinely no Postgres on this machine outside Docker.

**Isolation, audited before anything ran.** The daemon auto-started a local Supabase **`cert`** stack on restart policies — studio, kong, gotrue, postgrest, a local Postgres — all local images on localhost ports. **Nothing points at production; there is no worker container.** The standing note about Docker starting a production worker concerns compose, not this. The stack was left untouched. The disposable container carries `POSTGRES_PASSWORD=w6`, no production credential and no production hostname, and is destroyed on exit.

**Result — clean full run:** `ready after 6s` · `restored in 33s (errors: 1, unexpected: 0)` · **`replayed 41 migration(s) in 96s`** · **27 suites / 505 tests / 505 passed.**

Both new migrations — `20261027000000` (governance anchor) and `20261028000000` (lifecycle ledger) — **executed against real PostgreSQL 17 among those 41**, with zero errors, and the 25 pre-existing real-schema suites still pass.

### 3.17.1 What execution proved

| Claim | Status |
|---|---|
| DEFECT-008 — person-only row aborts the delete with `23514` | **PROVEN** |
| DEFECT-010 — both-anchored row collides with `23505` on the way out | **PROVEN** |
| DEFECT-010's second path — two people sharing a target collide inside one cascade | **PROVEN** |
| Revoking does **not** make a person-only row deletable pre-migration | **PROVEN** — this is exactly where the orchestrator's "no migration needed" hypothesis failed |
| `20261027000000` admits a revoked row and still requires an anchor on a live one | **PROVEN** |
| Capability B — person-only, both-anchored, both-anchored-with-clash, several records all erasable | **PROVEN** |
| Capability A — a carried-forward target still blocks a **re-imported** person at that address | **PROVEN** |
| Tenant isolation; tenant delete still works; merge survivor still refused | **PROVEN** |

### 3.17.2 Five wrong predictions — all in the tests, none in the product

Both suites were authored without a database, so every assertion was a *prediction about* the migration. Five predictions were wrong.

**Three shared one root cause.** `deletePerson` used `attempt()`, which is a `SAVEPOINT` that **rolls back on success** — it captures a SQLSTATE, it does not mutate. Every assertion about post-delete state therefore measured nothing: the person was still present, `person_id` was never nulled, `identity_claims` never CASCADEd. Added `erasePerson`, which deletes and keeps it, still inside the caller's `inRollback`. The SQLSTATE-asserting tests keep `attempt()`, which is what it is for.

**Fourth:** the `outreach_tasks` fixture supplied two of the **eight** columns that are `NOT NULL` with no default. Now supplies all eight — including the four WS-3 provenance stamps — taken from the catalog rather than discovered one error at a time.

**Fifth:** `pg_get_indexdef` normalises a boolean predicate, so `WHERE is_initial` prints as `WHERE (is_initial = true)`. The assertion matched the source spelling: reads correctly, fails against the catalog.

**No product code changed.** The five fixes are entirely in the two test files.

---

## 4. Defect register

| ID | Severity | Statement | Verification |
|---|---|---|---|
| **DEFECT-001** | **High** · **CLOSED** by WS-B | `executeProspectEnrichment` (`prospectIntelligenceRead.ts:613`) plans with `ingestionEnrichmentCoverage()` — no tenant statuses, and "absent means none" — while computing `tenantSourceStatuses(organizationId)` at `:632` for a different callee. Every field resolves `no_available_source`; the `action !== 'enrich'` guard at `:622` returns `not_planned` before execution. **The entire enrichment subsystem is unreachable in production.** | VERIFIED by orchestrator |
| **DEFECT-002** | **High** | `leads.unified_person_id` is `NOT NULL` in the production baseline with **no committed migration creating it** — the `20260506*` series skips `…000006`, and a committed rollback *drops* a constraint nothing creates. Documented in-repo as known drift. | VERIFIED |
| **DEFECT-003** | **High** | `leads_person_tenant_fk` carries `ON DELETE SET NULL (unified_person_id)` against that `NOT NULL` column → `23502`. Person deletion behaves as RESTRICT. `w5_tenant_isolation` misses it because `contacts` (nullable) is the control. | VERIFIED |
| **DEFECT-004** | **High (compliance)** | The unsubscribe → suppression seam is **absent**. `POST /api/outreach/outcomes` deliberately rejects `unsubscribed` because of it. No live exposure (an unsubscribe cannot be recorded) — and no way to honour one. | VERIFIED |
| **DEFECT-005** | **High (integrity)** | **All six** `postDiscoveryConnectors` (instagram, facebook, twitter, reddit, hackernews, linkedin) return hard-coded fabricated posts with fake `source_url`s (`https://linkedin.com/feed/update/mock-…`). They are registered in `CONNECTORS` and reachable via `getConnector(platform)` from `leadJobProcessor`, which is wired to the `engine-jobs` worker on `type === 'LEAD'` and iterates tenant-configured `platforms` with **no allow-list check**. A separate, genuinely real listening registry (`connectors/listeningConnectorRegistry.ts` — reddit, HN, github) exists alongside it. Production reachability is **UNVERIFIED** (depends on DB rows). | Code path VERIFIED |
| **DEFECT-006** | **Medium** | `source_assertions.superseded_at` is read but never written. No arbitration exists. Combined with RULE C, the first canonical value for an attribute is permanent and a disagreement withholds forever. | VERIFIED |
| **DEFECT-009** | Medium | `leadIntelligenceReadService.ts:85` reads `active_leads` filtering on `organization_id`, but the **live** table's tenant column is `company_id` — the reader follows migration `20260817_active_leads_object_model.sql` while production carries a different, run-scoped design. It is inside a `try/catch → []`, so it silently returns nothing rather than erroring. Two conflicting `active_leads` designs are committed. | VERIFIED (against the committed dump) |
| **DEFECT-010** | **High** · **CLOSED** by WS-F | A **second** trap on the same delete path. `uq_contact_governance_identity` keys on `coalesce(person_id::text, target_normalized)` — person_id wins while non-null. So a **both-anchored** row's idempotency key is its person id, and when the person is deleted the key **changes** to the target. If a target-anchored row already exists for that `(organization_id, channel, governance_type, target)`, the `SET NULL` update collides and raises `23505`, aborting the delete. Distinct from DEFECT-008: it traps the *both-anchored* shape, which is otherwise the erasure-safe one. Any erasure procedure must reconcile duplicate anchors before deleting. **`PROVEN` on real PostgreSQL 17** — the index definition was observed, and the `23505` was then **reproduced**, on both paths, including two different people sharing a target colliding inside one tenant cascade (§3.17.1). Resolved by `20261027000000`, which is **`APPLIED` to production**. *Corrected 2026-09-24: this cell previously read "the `23505` is reasoned, not executed".* |
| **GAP-007** | **High** · **CLOSED** by WS-A1 | The deploy-time schema gate covered 21 tables, **none of them PI**. See §2.4. Now **40 tables / 187 entries** — 68 BLOCKING, 100 WARN, 19 INFO — all 13 PI tables covered, plus 3 index invariants and 1 declared-type invariant. *Corrected 2026-09-24: this cell read "36 tables / 174 entries", which was the count at WS-A1 and is no longer the count in the script.* ⚠ **Residual, and it is new:** `prospect_lifecycle_transitions` and `uq_outreach_outcomes_id_company`, both created by `20261028000000` and both live in production, are **not covered by the manifest** — see §0.0 `NOT RUN`. | VERIFIED · CLOSED, with the `20261028000000` objects uncovered (*counts re-derived from `scripts/verify-schema-parity.js` at `af2fb6e9`*) |
| **DEFECT-008** | **High** · **CLOSED** by WS-F | `contact_governance_records.person_id` carries `ON DELETE SET NULL (person_id)` — deliberately, "so governance outlives the person" — against CHECK `contact_governance_has_anchor` (`person_id IS NOT NULL OR target_normalized IS NOT NULL`). Postgres validates CHECKs on the UPDATE that `SET NULL` performs, so a **person-anchored-only** governance record makes that person undeletable with `23514`, defeating the very design intent. Structurally identical to DEFECT-003, one constraint class over. No longer latent and no longer open: `contact_governance_records` holds **0 rows in production** (`VERIFIED against production`, §3.14 — previously recorded here as "believed empty (UNVERIFIED)"), an erasure path now exists (`prospectIdentity/personErasure.ts`), and `20261027000000` — **`APPLIED`** — widens the CHECK so the trap is unreachable. **Still makes POLICY-1's anchor decision load-bearing for POLICY-4.** | **`PROVEN` on real PostgreSQL 17** — the FK's `SET NULL (person_id)`, the CHECK and their collision were observed in the migration and against production; the `23514` was then **reproduced** on a disposable PostgreSQL 17, as was the fact that revoking does **not** make a person-only row deletable pre-migration (§3.17.1). Resolved by `20261027000000`, **`APPLIED` to production**. *Corrected 2026-09-24: this cell previously read "PARTLY VERIFIED … reasoned … not executed: proving it needs a real-schema run, which is deferred".* |

---

## 5. Decisions required from the operator

| ID | Decision | Why it cannot be inferred |
|---|---|---|
| **ARCH-1** | **May the outcome ledger inform the intelligence layer?** The target product (lifecycle, no-response intelligence, reassessment, reactivation, post-meeting) requires it. The current architecture forbids it by explicit contract and guard test. This is the single largest decision in the programme and needs a superseding ADR, not an inference. | The wall is deliberate and documented; removing it silently would violate the programme's own governance |
| **PROD-1** | Production read access — reissue the pooler credential, grant the probe permission, or both | Operator-only |
| **PROD-2** | Is `DEFECT-005` live? i.e. do any tenants have `lead_jobs` rows with platforms configured | Needs a DB read |
| **POLICY-1** | Unsubscribe scope and anchor: channel-scoped or `*`; person- or target-anchored; revocable. **Contract prepared: `PI-CONTRACT-001`.** Two sub-questions are foreclosed by the schema (no time-limited unsubscribe; duplicates already idempotent). ⚠ Interacts with POLICY-4 via DEFECT-008 — person-only anchoring makes every unsubscribed person undeletable | Compliance decision |
| **POLICY-2** | Does an engagement/community signal deserve a PI **prospect**, a **candidate**, or nothing? Three code sites record this as "a product decision nobody has made" | Determines the entire discovery design |
| **POLICY-3** | Contact-frequency / fatigue policy — quiet hours and fatigue "do not exist anywhere yet" | Product + compliance |
| **POLICY-4** | Data lifecycle: retention, erasure, subject access. **Contract prepared: `PI-CONTRACT-002`, 8 decision points, 6 work items.** No PI table is in any retention policy; there is **no person-deletion path at all**, and the FK topology actively blocks one (`lead_intelligence` RESTRICT, `leads` 23502) while CASCADE would destroy `identity_claims` and the merge audit trail | Legal/compliance; gets harder once rows exist |
| **POLICY-5** | Score dimension weights for Account Potential and Buying Role (the facts exist; the weighting is policy) | Product |

---

## 6. Workstream plan

Contract-first per the execution protocol.

**Corrected 2026-09-24 — implementation has started and shipped.** The sentence that stood here, *"No implementation has started"*, is false: WS-A1, WS-B and the deliverables recorded in §3.13–§3.17 are `IMPLEMENTED`, `T3 CERTIFIED` at `1c0fef0c` and merged as PR #270, with both migrations `APPLIED`.

⚠ **The letters in the table below are the *plan's* letters and do not map one-to-one onto the delivered workstream names.** §6's WS-C is the discovery fabric; the delivered WS-C (§3.15) is the lifecycle ledger. Read §3.13–§3.17 for what actually shipped, and treat this table as the original plan rather than a progress board.

| WS | Scope | Owns | Depends on | Parallel class |
|---|---|---|---|---|
| **WS-A** | Schema & safety baseline: extend the preflight to PI tables (GAP-007); close DEFECT-002 and DEFECT-003 while tables are empty | `scripts/verify-schema-parity.js`, `supabase/migrations/*` (new, additive) | PROD-1 for verification | SERIAL (migration authoring) |
| **WS-B** | Enrichment reachability: DEFECT-001; enrichment telemetry | `prospectIntelligenceRead.ts` execute path, enrichment telemetry module | none | PARALLEL-SAFE |
| **WS-C** | Discovery fabric: prospect-candidate contract; engagement/community → PI spine; extension bridge activation (Sales Navigator people-data); quarantine DEFECT-005 | `leadIngestion/**`, `extensionBridge` caller, new candidate model | POLICY-2, contract freeze | SERIAL with WS-E on the candidate contract |
| **WS-D** | Offering activation: persist `offeringIntelligence`, wire it to Problem Fit; prospect-side problem evidence (project `lead_signals.content_text` into context) | `offeringIntelligence/**`, `prospectContext.ts` | contract freeze | PARALLEL-SAFE |
| **WS-E** | Lifecycle & reassessment: prospect state machine; outcome interpretation; no-response derivation; reassessment trigger | new lifecycle module, `prospectContext` fingerprint | **ARCH-1**, contract freeze | SERIAL (core) |
| **WS-F** | Compliance: unsubscribe seam (DEFECT-004); data lifecycle and erasure path | `feedbackIngestion` → governance seam, retention targets | POLICY-1, POLICY-4 | PARALLEL-SAFE |
| **WS-G** | AI control plane over PI + operator observability surface | new PI copilot intents, admin surface | WS-E contracts | LAST |

**Contracts to freeze before parallel implementation** (§28): Prospect · Candidate · Signal · Evidence · Enrichment Attribute · Decision · NBA · Lifecycle Event · Prospect State · Outreach Outcome · Learning Proposal. Where one exists it is reused; `SectionState`, `FIELD_STATES`, `ENRICHMENT_OUTCOMES`, `GOVERNANCE_TYPES`, `SCORE_DIMENSIONS` and the ICP criterion vocabulary are already frozen and authoritative.

---

## 7. Classification of the target specification

Per the "do not build for the sake of completion" rule.

| Target capability | Class |
|---|---|
| Ingestion contract, identity, provenance, governance, ICP, readiness, execution ledger, flags, tenant isolation | **ALREADY BUILT** |
| Enrichment provider fabric | **ALREADY BUILT** — blocked by DEFECT-001 |
| PI schema deploy coverage; DEFECT-002/003 | **REQUIRED NOW** — cheapest while tables are empty |
| Enrichment reachability + telemetry | **REQUIRED NOW** |
| Unsubscribe seam | **REQUIRED NOW** (before any dispatch) |
| Discovery → PI spine; candidate model | **REQUIRED NOW** — this is the product |
| Offering activation + Problem Fit | **REQUIRED NOW** — sell side already built |
| Lifecycle state + reassessment + no-response | **REQUIRED NOW**, gated on ARCH-1 |
| Data lifecycle / erasure | **REQUIRED NOW** — POLICY-4; hardest after rows exist |
| Buying-signal vocabulary bridge | **POLICY DECISION REQUIRED** — do not invent a mapping |
| Account Potential / Buying Role as dimensions | **POLICY DECISION REQUIRED** (weights only) |
| Relationship Strength dimension | **REQUIRED LATER** — no interaction-depth evidence exists anywhere |
| Meeting/handoff | **REQUIRED LATER** — needs a booking integration; `meeting_booked` is unobservable today |
| FR-30 learning | **DEFERRED UNTIL DATA EXISTS** — zero outcome rows |
| ZoomInfo / Crunchbase / RapidAPI adapters | **EXTERNAL DEPENDENCY** |
| Sales Navigator official integration | **EXTERNAL DEPENDENCY** — the extension bridge is the supported path and needs no new legal posture |
| AI control plane | **REQUIRED LATER** — after lifecycle contracts exist |

---

## 8. Validation status

| Gate | State |
|---|---|
| T1 | PASS for WS-A1 (54/54) and WS-B (179/179), each re-run by the orchestrator in its own worktree |
| T2-001 | **PASS** — 115 PI suites / 3299 tests, 0 failures; `check:authz`, `check:migrations`, `check:db-conventions`, `check:route-policy` all exit 0 |
| T2-002 | **PASS** (scoped to the schema gate and the enrichment/identity subsystems it touches) — 39 suites / 1098 tests, 0 failures; three static guards exit 0 |
| **REAL-SCHEMA** | **PASS** — 27 suites / 505 tests / 0 failures on a disposable PostgreSQL 17; 41 migrations replayed including both new ones |
| T2-005 | **PASS** (WS-C lifecycle, converged with WS-F) — 23 suites / 593 tests, 0 failures; four static guards exit 0 |
| T2-004 | **PASS** (WS-F governance/erasure) — 16 suites / 444 tests, 0 failures; `check:authz`, `check:migrations`, `check:db-conventions` exit 0 |
| T2-003 | **PASS** (scoped to offering, understanding, identity and governance) — 20 suites / 421 tests, 0 failures; `check:authz` and `check:db-conventions` exit 0 |
| **T3** | **CERTIFIED** at `1c0fef0c` — regressions found and fixed, then merged. *Previously "not run — not a release candidate".* |
| **GitHub CI at `af2fb6e9`** | **GREEN**, including an independent `Real-Schema CI` run (`.github/workflows/real-schema-ci.yml` — migration replay + canonical invariants on GitHub's own PostgreSQL service container). Evidence class: **CI-VERIFIED** |
| **Production migration apply** | **`APPLIED`** 2026-09-24 via the Studio SQL editor; **16/16 post-apply structural checks PASSED** read-only, no row drift. Ledger rows absent by `ACCEPTED` divergence (`§0.C`) |
| Production deploy | **DONE** — `af2fb6e9` auto-deployed to the Railway production worker, deployment `eec3a2ab`, SUCCESS. *Previously "not authorized, not attempted".* |
| Pushed | **yes** — `integrate/pi-t2-001` pushed and merged as PR #270; `origin/main` is `af2fb6e9`. *Previously "no — all four branches are local".* |

**PI baseline at `origin/main` for comparison:** 114 suites / 3239 tests with **2 failures**, both stale assertions that Apollo has no adapter. The integrated tree is +1 suite, +60 tests, 0 failures.

**GAP-A / GAP-B / GAP-C production verification: `VERIFIED against production`, 2026-09-23.** 187 checks across 40 tables — 68 BLOCKING, 100 WARN, 19 INFO — were evaluated read-only over the Supabase Management API: **155 present, 32 missing, 0 BLOCKING missing**, and not one of the 32 is a PI table (§2.3.1).

*Corrected 2026-09-24.* The sentence that stood here — *"None has ever been evaluated against production. This is not a PASS and must not be reported as one. It is gated entirely on PROD-1"* — was stale and is retracted. **What remains `NOT RUN` is narrower and still real:** the same manifest has never run over `predeploy-check.js`'s own direct `pg` connection, because the pooler credential is still rejected. So the gate has been *evaluated*, but never *exercised in the form a deploy exercises it*.

**The structural checks have now executed — `VERIFIED against production` and `PROVEN` on real PostgreSQL.** GAP-B/C added an index-introspection query over `pg_index`/`pg_class` and a declared-type comparison. Both were evaluated against production on 2026-09-23: all three index invariants present, `unique=true`, correct partiality, and `source_records.ingestion_run_id` declared `text` (§2.3.1). The DDL they check was separately replayed on a disposable PostgreSQL 17 (§3.17).

*Corrected 2026-09-24.* Two claims in the paragraph that stood here are retracted. First, *"the structural checks have never executed against a live Postgres … syntax-checked and unit-guarded, not runtime-proven"* — they have. Second, the justification: *"starting Docker is avoided here because this repo's compose brings up a worker pointed at production"*. §3.17 audited that and found it does not apply — the standing concern is about compose, while `scripts/ci/real-schema-ci.sh` manages a disposable `pgvector/pgvector:pg17` container on port 5433 with `POSTGRES_PASSWORD=w6`, no production credential, no production hostname, no worker container, destroyed on exit. Docker was subsequently available and the suite ran.

**What the structural checks provably do NOT guarantee** (recorded so nobody over-claims): the type check proves the *declared* type only, not that every stored row is convertible; the index check matches key names as a substring of `pg_get_indexdef`, so an index over the right columns in the **wrong order** passes; `indisvalid` is not read, so an index left by a failed `CREATE INDEX CONCURRENTLY` reports as present; and an index existing today says the constraint is enforced from now on, not that past ingestion was idempotent.

**The WS-A1 caveat, resolved and narrowed 2026-09-24.** It read: *"the extended schema gate has never been run against a real database. Once PROD-1 lands it may turn a currently-green predeploy red."* The manifest **was** evaluated against production, and the feared red did not occur — 0 BLOCKING missing (§2.3.1). The residual caveat is only that the evaluation went over the Management API, not over the `pg` connection `predeploy-check.js` uses, so the script's own connection path is still unproven in production. Nothing about the manifest's verdict is in doubt; the transport is.

---

## 9. Next actions, in dependency order

⚠ **Reconciled 2026-09-24.** Items 3, 4 and 5 are overtaken by PR #270 — the
contracts were frozen and those workstreams shipped (§3.13–§3.17). Items 2, 6
and 7 stand. Item 1 is narrowed below.

1. **Operator: PROD-1, residual only.** Production **reads** are available over the Supabase Management API and applied-migration state is no longer blocked on anything (§0.0, §2.3). What remains is a reissued `SUPABASE_POOLER_DB_URL`, so `predeploy-check.js` can run the 187-check gate over its own `pg` connection — the way a deploy runs it. *Previously: "Restore production read access. Everything about applied-migration state is blocked on it."*
2. **Operator: ARCH-1.** Decide whether the outcome ledger may inform intelligence. WS-E cannot start without it; WS-A, WS-B, WS-D, WS-F can.
3. **Orchestrator: freeze the contracts** in §6.
4. **WS-A, WS-B, WS-F** may begin immediately in parallel — none depends on a pending decision.
5. **WS-C, WS-D** begin after contract freeze.
6. **WS-E** begins after ARCH-1.
7. First real-data exercise only after WS-A closes and PROD-1 is resolved.

---

# PRE-APPLY GATE — 2026-09-23 · RESULT: **PASS**

> **Historical, and superseded.** This section records the state *before* the
> apply, and every reading in it is dated 2026-09-23. Both migrations were
> applied on **2026-09-24**; see `§0.0`, `§0.C` and the post-apply verification
> at the foot of this section. It is retained rather than rewritten so the
> sequence — gate, authorization, apply, verify — stays legible.

Run after owner ratification of J-1…J-6. **Nothing was applied at this gate. No production mutation of any kind occurred during it.**

## Repository

| | |
|---|---|
| Integration SHA | `e81816b92d229a8ecb5db5e22e2408ad1e3bd9ef` |
| Branch | `integrate/pi-t2-001` |
| Working tree | **clean** (0 changes) |
| Changed since real-schema verification | **documentation only** — zero implementation or schema files |
| Duplicate migration versions above the floor | **none** |

## Migrations — exact bytes proposed

| File | sha256 |
|---|---|
| `20261027000000_pi_wsf_governance_anchor_after_erasure.sql` | `c91a65719d85427e3c559068ca2324e6248f40806ec09c7ea97902ffc2f71b97` |
| `20261028000000_pi_prospect_lifecycle_state.sql` | `368e6f6125597cae1621de0116686bbde5e2e943b259b7faa37921ba613f35ab` |

**Verification linkage — PROVEN.** Both files are **byte-identical** to their content at `33fd761d`, the commit whose tree produced 27 suites / 505 tests / 505 passed with 41 migrations replayed. The real-schema evidence therefore corresponds to exactly these bytes.

**Re-hashed 2026-09-24 at `af2fb6e9`:** both files still produce the two sha256 values above. The bytes proposed at this gate, the bytes replayed on real PostgreSQL 17, the bytes applied to production, and the bytes on `main` are one and the same. Neither file has been touched since, and neither may be.

## Intended schema changes

**`20261027000000`** — two `ALTER TABLE` statements on `contact_governance_records`: drop and re-add `contact_governance_has_anchor`, widening it to admit a row whose anchors are gone **only when revoked**. Guarded by a fail-closed preflight that refuses if the table is missing, the constraint is absent, or the person FK is no longer `ON DELETE SET NULL (person_id)`.

**`20261028000000`** — creates `prospect_lifecycle_transitions` (1 table, 3 unique indexes, 2 indexes, 3 triggers, 1 function, RLS enabled + 1 policy), plus `uq_outreach_outcomes_id_company` on `outreach_outcomes`.

## Safety scan — clean

Neither migration contains `DROP TABLE`, `TRUNCATE`, `DELETE FROM`, `UPDATE … SET`, `DROP COLUMN`, `RENAME`, `DROP DATABASE` or `DROP SCHEMA`. The only `DROP CONSTRAINT` is the ratified J-3 CHECK swap, re-added in the same transaction. No unrelated schema change; every object is additive or the ratified constraint.

## Production preconditions — verified read-only

| Precondition | Observed |
|---|---|
| `contact_governance_records` exists | ✔ |
| `contact_governance_has_anchor` present | ✔ |
| person FK `confdeltype` | **`n`** (SET NULL) — the migration's premise holds |
| Rows affected by the CHECK swap | **0** |
| `canonical_leads`, `outreach_outcomes`, `source_records`, `companies`, `users` | all present |
| `prospect_lifecycle_transitions` | **absent** — as expected |
| `uq_outreach_outcomes_id_company` | absent — the migration creates it |
| `outreach_outcomes` rows (index build cost) | **0** |
| Either migration already recorded in the ledger | **0** — neither applied *as at this gate, 2026-09-23*. Both were applied on 2026-09-24 and the ledger still records neither, by `ACCEPTED` divergence — `§0.C`. **Do not read this row as current state** |

## Warnings — two, neither blocking

1. **`20261028000000` has no rollback file** (`20261027000000` does). Not a convention breach — 29 of 417 migrations have one. It is also defensible: a rollback would be `DROP TABLE` on an append-only audit ledger, which destroys the evidence the table exists to hold. **Recorded so the absence is a decision, not an oversight.**
2. **The repository's documented process specifies no backup/recovery step** — `docs/migration-discipline.md` mentions none. Both migrations are additive against zero affected rows, so the practical exposure is low, but the absence is stated rather than assumed away.

## Post-apply verification — **EXECUTED 2026-09-24, read-only**

**16/16 structural checks PASSED. No row drift.** Executed against production by
a SELECT-only verifier. Evidence class: **`VERIFIED against production`**. The
16 are the structural items below; item 1 is the `ACCEPTED` ledger divergence and
was not among them, and item 6 is not a structural check.

| # | Check as defined pre-apply | Outcome |
|---|---|---|
| 1 | Both versions recorded in `supabase_migrations.schema_migrations` | **NOT MET — and `ACCEPTED`, not a failure.** Studio does not write that table. This is the known divergence of `§0.C`, not drift, and **must not be repaired by hand** |
| 2 | `contact_governance_has_anchor` matches the new three-clause definition; the live-row requirement is **not** lost | **`VERIFIED against production`** |
| 3 | `prospect_lifecycle_transitions` exists with 3 unique indexes, 2 indexes, 3 triggers, RLS enabled, 1 policy | **`VERIFIED against production`** |
| 4 | `uq_outreach_outcomes_id_company` present, unique, valid | **`VERIFIED against production`** |
| 5 | No unexpected schema delta — re-run the 187-check gate | **`VERIFIED against production`** — no unexpected delta, no row drift |
| 6 | PI read paths still answer — `GET /api/prospects`, `GET /api/prospects/:id` | **`UNVERIFIED`** — not a structural check, and not recorded as exercised against production. Both migrations are additive against zero affected rows, so the expectation is that they answer unchanged; that expectation is **reasoned, not executed** |
| 7 | Tenant isolation intact — RLS and composite FKs unchanged | **`VERIFIED against production`** |

## Result

**PRE-APPLY GATE: PASS.** Stopped here on 2026-09-23, pending authorization.

**Superseded 2026-09-24.** The owner authorized the apply; the human operator
executed both migrations through the Supabase Studio SQL editor, each returning
"Success. No rows returned"; the post-apply verification above was then executed
read-only, 16/16 structural checks passing with no row drift. The work was
T3-certified at `1c0fef0c`, merged as PR #270, and `af2fb6e9` was auto-deployed
to the Railway production worker (`eec3a2ab`, SUCCESS).

The sentence that stood here — *"Stopped here. Production migration application
is NOT AUTHORIZED and has NOT been attempted"* — was true when written and is
now false. It is **retracted, not deleted**, because three separate readers took
this document's dated statements for current ones, and a deletion would leave no
trace of why.
