# OMNIVYRA PROSPECT INTELLIGENCE — PHASE 0.5
## Architecture Decision Record: Canonicalisation & Verification

**Status:** DECISION RECORD. No code written, no schema changed, no migration created or applied, no production data modified.
**Date:** 2026-08-12
**Supersedes/extends:** `OMNIVYRA_PROSPECT_INTELLIGENCE_PHASE0_AUDIT.md`
**Repository:** `c:\virality` @ `main`, HEAD `d15f00ab`

### Method of verification

Phase 0 could not verify production. This ADR could. The Supabase MCP connector again failed to attach, and `scripts/verify-schema-parity.js` still fails (`information_schema` not exposed to `service_role`), so verification was performed **through the application's own service-role PostgREST client** using:

- **Existence probes** — `select('*', { head: true })`: HTTP HEAD, returns no rows. A missing relation surfaces as `PGRST205`; a missing column as `42703`.
- **Cardinality probes** — `select('*', { head: true, count: 'exact' })`: returns a count only, no rows.
- **Column probes** — `select('<col>').limit(0/1)`.

**No INSERT, UPDATE, DELETE, DDL or RPC was issued. No PII was read.** All evidence below is reproducible from the probe scripts retained in the session scratchpad.

---

# 1. EXECUTIVE DECISION

**Production verification succeeded, and it changes the program materially. Three Phase 0 conclusions are superseded, two hard blockers dissolve, and the risk profile of the whole programme drops by an order of magnitude — but one previously unknown **live production defect** was discovered.**

The four decisive facts:

1. **Every program-critical table exists in production — 61/61 probed, plus all 269 tables defined *only* in the ungoverned `database/*.sql` files.** The `database/` directory is not dead schema; it is *applied* schema outside migration governance. Zero table-level drift.
2. **`suppression_entries` contains ZERO rows.** There are no global suppression records anywhere. Blocker B-3 — which Phase 0 rated a hard legal/product gate — **dissolves**. The global-scope defect can be removed by constraint change with no data migration, no legal interpretation and no risk. This is only true while the table is empty.
3. **WhatsApp has never run in production.** 0 WhatsApp `social_accounts`, 0 threads, 0 messages, 0 templates, 0 broadcasts. Phase 0 stated WhatsApp "reaches real people today" — **that was wrong about production reality** and is corrected below. Bringing WhatsApp under governance is therefore *pre-activation gating*, not incident remediation: no dual path, no parity window, no legacy retirement.
4. **The platform is pre-scale.** 39 companies, 131 users, 18 `leads`, 10 `contacts`, 23 `unified_persons`, 0 `active_leads`, 0 `outreach_tasks`, 0 `lead_intelligence_profiles`. Canonicalisation that would be a multi-quarter migration at scale is, today, close to a greenfield definition exercise.

**The newly discovered defect:** `engagement_threads.window_open` and `window_expires_at` **do not exist in production**, yet `pages/api/engagement/threads.ts:60` selects them and `backend/queue/jobProcessors/whatsappWebhookProcessor.ts:109-110` writes them. `GET /api/engagement/threads` therefore fails with `42703` for **every tenant, right now** — verified by executing that route's exact select string against production. This also explains fact 3: the WhatsApp inbound path cannot write a thread, so it has never ingested a message.

**Decision: GO for Phase 1**, conditional on one mandatory sequencing item (§11, W0). Every hard blocker Phase 0 identified is now resolved, dissolved, or decided in this record. Phase 1 as scoped contacts nobody, so the unresolved lawful-basis question (B-4) gates Phase 5, not Phase 1.

**The window is time-boxed.** Three of the cheapest, highest-value corrections available — removing global suppression scope, retyping `company_id` on the WS-3 tables, and gating WhatsApp before its first account is connected — are cheap *only because the relevant tables are empty*. Each becomes materially harder the day a row appears.

---

# 2. PRODUCTION VERIFICATION RESULT

## 2.1 Program-critical tables — all present

61/61 probed tables returned HTTP 200. Zero absent.

| Group | Tables verified present in production |
|---|---|
| Prospect / identity | `leads`, `forms`, `contacts`, `active_leads`, `canonical_leads`, `canonical_users`, `lead_intelligence`, `lead_intelligence_events`, `lead_intelligence_profiles`, `unified_persons`, `unified_person_merges`, `unified_touchpoints`, `buyer_intent_accounts`, `lead_signals`, `opportunity_feed_items`, `lead_understanding_shadow` |
| Suppression / governance | `suppression_entries`, `outreach_suppressions`, `outreach_governance_config`, `execution_controls`, `consent_records` |
| WS-3 execution | `outreach_tasks`, `outreach_approvals`, `outreach_attempts`, `outreach_outcomes`, `outreach_decisions`, `outreach_delivery_evidence`, `outreach_internal_work_items`, `outreach_plans`, `lead_outreach_plans` |
| WhatsApp / engagement | `whatsapp_templates`, `whatsapp_broadcasts`, `whatsapp_broadcast_recipients`, `social_accounts`, `engagement_threads`, `engagement_messages`, `engagement_authors`, `engagement_sources`, `engagement_thread_events`, `engagement_identity_candidates` |
| Email | `email_jobs`, `email_events` |
| Attribution / campaigns | `campaigns`, `campaign_touchpoints`, `lead_attributions`, `attribution_handoffs`, `external_landing_pages`, `embedded_form_lineage`, `lead_capture_topologies`, `form_conversions` |
| Credit | `credit_cost_config`, `credit_transactions`, `action_registry`, `credit_usage_log` |
| Infrastructure | `companies`, `users`, `user_company_roles`, `domain_events`, `canonical_events`, `rpa_sessions`, `marketpulse_signals` |

## 2.2 The 312 ungoverned `database/*.sql` files — RESOLVED

- `database/*.sql` defines **317 distinct tables**; **269** of them appear in **no** file under `supabase/migrations/`.
- **All 269 exist in production.** Zero absent.

**Conclusion: table-level parity is complete. The `database/` directory is applied, not dead.** The defect is governance (no ordering, no ledger, no replay, no review gate), not divergence.

**Column-level parity is NOT complete.** Of 566 `ALTER TABLE … ADD COLUMN` pairs extracted from `database/*.sql`:

| Outcome | Count | Share |
|---|---|---|
| Column present in production | 451 | 80.1% |
| **Column MISSING in production** | **112** | **19.9%** |
| Parent table absent (parse artifacts: `12_week_plan`, `plan_features`, `twelve_week_plan`) | 3 | — |

A heuristic cross-reference against 4,400 non-test source files found **68 of the 112 missing columns referenced by code that also names the same table**. That heuristic produces both true and false positives — both confirmed by direct probe:

- **TRUE POSITIVE:** `CampaignAutoOptimizationGuard.ts:39-40` runs `.from('campaigns').select('id, execution_status, …')`; `campaigns.execution_status` does not exist → `42703`.
- **FALSE POSITIVE:** `users.company` matched `usersShared.ts` only because that file names `user_company_roles`; it never queries `users.company`.

The 68 are therefore **candidates requiring targeted verification**, not 68 confirmed defects. Sizing that set is a follow-up audit (§13, F-1), **not** Phase 1 scope.

## 2.3 Disposition table

| Repository file / migration | Table(s) | Repo definition | Production state | Applied migration | Classification | Disposition |
|---|---|---|---|---|---|---|
| `database/leads.sql` | `leads`, `forms` | Yes | **PRESENT** (18 / n rows) | No — ungoverned | Canonical (form capture) | Promote to migrations (idempotent no-op) |
| `database/whatsapp_system.sql` | `whatsapp_templates`, `whatsapp_broadcasts`, `whatsapp_broadcast_recipients`, `whatsapp_media_cache` + ALTERs | Yes | **Tables PRESENT (0 rows); ALTERs PARTIAL** | No — ungoverned | Canonical but **incompletely applied** | Promote **and** reconcile missing columns — see W0 |
| `database/engagement_unified_model.sql` | `engagement_threads/messages/authors/sources` | Yes | **PRESENT** (126 / 125 rows) | No — ungoverned | Canonical | Promote; add tenant column to messages (Phase 2) |
| `database/buyer_intent_accounts.sql` | `buyer_intent_accounts` | Yes | **PRESENT (0 rows)** | No — ungoverned | Legacy / superseded | Do not extend. Superseded by `prospect_accounts` |
| `database/clean-unified-schema.sql` | `social_accounts`, others | Yes | **PRESENT** (7 rows) | No — ungoverned | Canonical | Promote |
| `supabase/migrations/20260621_unified_person_identity_spine.sql` | `unified_persons` | Yes | **PRESENT (23 rows)** | Yes | **CANONICAL SPINE** | Extend (§3) |
| `supabase/migrations/20260910000000_ws3_lead_outreach_execution.sql` | `outreach_*` | Yes | **PRESENT (0 rows)** | Yes | Canonical execution | Retype `company_id` while empty (W2) |
| `supabase/migrations/20260912000000_ws3_governance_state.sql` | `outreach_suppressions`, `outreach_governance_config` | Yes | **PRESENT (0 rows)** | Yes | **CANONICAL suppression** | Adopt as sole DNC model |
| `supabase/migrations/20260727030000_guarded_execution.sql` | `suppression_entries`, `execution_controls` | Yes | **PRESENT (0 rows)** | Yes | **Legacy — conflicting** | Remove global scope while empty (W1) |
| `supabase/migrations/20260907000000_lead_intelligence_profiles.sql` | `lead_intelligence_profiles` | Yes | **PRESENT (0 rows)** | Yes | Projection | Keep; retype `company_id` |
| `archive/legacy-lead-signals/…` | `lead_outreach_plans` | Yes | **PRESENT (0 rows)** | Yes | **DECOMMISSIONED** | Leave untouched; never read/write |

## 2.4 Production cardinality (evidence for every decision below)

| Table | Rows | Interpretation |
|---|---|---|
| `companies` / `users` | 39 / 131 | Pre-scale tenant base |
| `leads` | 18 | Only model with real email+phone |
| `contacts` | 10 | Social identity; **0 linked to spine** |
| `active_leads` | **0** | Never used — free to redefine |
| `canonical_leads` | 18 | **18/18 linked to spine (100%)** |
| `lead_intelligence` | 18 | **18/18 linked to spine (100%)** |
| `lead_intelligence_profiles` | **0** | INT-001 never produced an envelope |
| `unified_persons` | 23 | Spine already exists and is populated |
| `unified_person_merges` / `unified_touchpoints` | 0 / 0 | Defined, never written |
| `buyer_intent_accounts` | **0** | Never used |
| **`suppression_entries`** | **0** | **B-3 dissolves** |
| `outreach_suppressions` | 0 | Canonical model, unused |
| `outreach_governance_config` | **0** | **No tenant is enabled for outreach** |
| `outreach_tasks` / `attempts` / `outcomes` | 0 / 0 / 0 | WS-3 has never executed |
| `outreach_plans` / `lead_outreach_plans` | 0 / 0 | Both empty; decommission holds |
| `execution_controls` | 0 | Default-OFF, never configured |
| `whatsapp_templates` / `broadcasts` / `recipients` | 0 / 0 / 0 | **WhatsApp never used** |
| `social_accounts` total / `platform='whatsapp'` | 7 / **0** | **No WhatsApp account has ever been connected** |
| `engagement_threads` total / whatsapp / **org_id NULL** | 126 / **0** / **0** | Tenant column populated on every row |
| `engagement_messages` total / whatsapp | 125 / **0** | |
| `email_jobs` / `email_events` | 8 / **0** | Transactional only; zero delivery events |
| `credit_cost_config` | 45 | Catalog live |

## 2.5 Column-level findings in production

| Probe | Result |
|---|---|
| `engagement_threads.window_open` | **MISSING — `42703`** |
| `engagement_threads.window_expires_at` | **MISSING — `42703`** |
| `engagement_threads.social_account_id` / `raw_payload` / `organization_id` / `contact_id` / `unified_person_id` | PRESENT |
| `engagement_messages.organization_id` | **MISSING — `42703`** |
| `engagement_messages.company_id` | **MISSING — `42703`** |
| `engagement_messages.direction` / `status` / `status_at` | PRESENT |
| `social_accounts.company_id` / `phone_number_id` / `waba_id` / `messaging_tier` / `is_system_user` | PRESENT |
| `unified_persons.primary_email` / `primary_phone` / `external_keys` | PRESENT |
| `suppression_entries.scope` / `company_id` / `target` / `active` | PRESENT |
| `outreach_suppressions.value` / `revoked_at` | PRESENT |
| `outreach_tasks.company_id` / `lead_id` | PRESENT |

**Phase 0 finding R6 is CONFIRMED IN PRODUCTION:** `engagement_messages` has no tenant column of any kind.

## 2.6 AUDIT FINDINGS SUPERSEDED

> ### AUDIT FINDING SUPERSEDED — Phase 0 §16 and R2: "WhatsApp outbound reaches real people today"
> **Evidence:** 0 `social_accounts` with `platform='whatsapp'`; 0 `whatsapp_templates`; 0 `whatsapp_broadcasts`; 0 `whatsapp_broadcast_recipients`; 0 `engagement_threads` with `platform='whatsapp'`; 0 `engagement_messages` with `platform='whatsapp'`.
> **Correction:** the WhatsApp code path is complete and *capable* of contacting people, but **no WhatsApp account has ever been connected and no WhatsApp message has ever been sent or received in production**. The severity claim ("compliance exposure today") was wrong. The architectural conclusion — WhatsApp must not go live outside WS-3 governance — is **unchanged and strengthened**, because gating an unactivated channel is free.

> ### AUDIT FINDING SUPERSEDED — Phase 0 R1 / B-3: global suppression rows are a hard legal gate
> **Evidence:** `suppression_entries` total rows = 0; `scope='global'` = 0; `company_id='__global__'` = 0.
> **Correction:** no global suppression record has ever been written. The legal/product decision matrix Phase 0 demanded is **moot**. The defect is now purely a schema-constraint decision (§6) executable at zero risk — *while the table remains empty*.

> ### AUDIT FINDING SUPERSEDED — Phase 0 §24 / R5: 312 ungoverned files imply unverifiable, possibly-divergent production schema
> **Evidence:** all 269 tables unique to `database/*.sql` exist in production; 80.1% of their `ADD COLUMN` statements are applied.
> **Correction:** there is **no table-level divergence**. The real, narrower defect is **19.9% column-level drift** plus the absence of migration governance. Severity moves from "unknown divergence" to "known, bounded, partially code-reachable drift."

> ### NEW FINDING — not present in Phase 0: live production defect in `GET /api/engagement/threads`
> **Evidence:** executing the exact select string from `pages/api/engagement/threads.ts:60` against production returns `42703: column engagement_threads.window_open does not exist`. The same select minus the two window columns succeeds.
> **Impact:** the engagement threads API fails for **all 39 tenants**, not only WhatsApp users. `whatsappWebhookProcessor.ts:109-110` upserts the same two columns, so WhatsApp inbound ingestion cannot succeed either. `pages/whatsapp/inbox.tsx` consumes both fields.
> **Classification:** pre-existing P0, unrelated to this programme's design, but it sits on a table Phase 1 touches. Sequenced as W0.

---

# 3. CANONICAL PROSPECT SPINE DECISION

## DECISION 3.1 — `unified_persons` is the canonical prospect identity. ADOPTED.

No alternative is created. Rationale, in evidence order:

1. It already exists in production with 23 rows and a purpose-built design (`primary_email`, `primary_phone`, `external_keys`, `company_id UUID` FK to `companies`).
2. Adoption is already 100% where it matters most: `canonical_leads` 18/18 linked, `lead_intelligence` 18/18 linked.
3. Five of the six lead models already carry a `unified_person_id` column.
4. Creating any new spine would produce the seventh lead model this programme exists to prevent.

**Rejected alternatives:** a new `prospects` table (creates model #7); `lead_intelligence` as spine (ingestion-shaped, `text` keys, dedupe-keyed not identity-keyed); `contacts` as spine (no email, no phone, platform-bound).

## DECISION 3.2 — Canonical tenant key type is **`UUID`**. ADOPTED.

| Surface | Today | Target |
|---|---|---|
| `companies.id`, `unified_persons.company_id`, `leads`, `contacts`, `active_leads`, `canonical_leads` | `uuid` | `uuid` (unchanged) |
| `lead_intelligence.company_id`, `lead_intelligence_profiles.company_id` | `text` | **→ `uuid`** |
| All WS-3 tables (`outreach_*`) `company_id`, `lead_id` | `text` | **→ `uuid`** |

**Rationale:** `uuid` is the type of the referent (`companies.id`). Only `uuid` permits a real foreign key; `text` permanently forecloses referential integrity between WS-3 and the tenant table. `uuid` is already the majority type.

**Why now, and only now:** every table requiring conversion is **empty in production** — `lead_intelligence_profiles` 0, `outreach_tasks` 0, `outreach_attempts` 0, `outreach_outcomes` 0, `outreach_suppressions` 0, `outreach_governance_config` 0. The single exception is `lead_intelligence` (18 rows), whose values are already UUID-shaped strings. **This conversion is free today and expensive the day WS-3 executes.** No mixed type may remain in the target architecture.

## DECISION 3.3 — Identity uniqueness is **TENANT-SCOPED**, not platform-global. ADOPTED.

Every uniqueness constraint on identity is `(company_id, <normalized value>)`.

**Rationale:** the brief's §4 rule — *"a person/company may exist in multiple tenants; tenant-owned intelligence must NEVER cross tenant boundaries"* — is unsatisfiable under global uniqueness. A globally-unique person row is a **shared mutable object**: two tenants enriching, scoring, suppressing and remembering the same row would leak intelligence by construction. The same human known to two tenants is therefore **two `unified_persons` rows**, deliberately. Cross-tenant linkage is not a feature this platform may offer.

## DECISION 3.4 — Normative normalized identity fields

Added to `unified_persons`, all **nullable and additive** (Phase 1 creates columns; population is the shadow resolver's job):

| Field | Type | Normalization rule | Constraint |
|---|---|---|---|
| `email_normalized` | `citext`/`text` | lowercase, trim; no plus-address stripping (`a+x@` ≠ `a@` — provider-dependent, must not be assumed) | `UNIQUE (company_id, email_normalized) WHERE email_normalized IS NOT NULL` |
| `phone_e164` | `text` | E.164 (`+` + digits, ≤15) | `CHECK (phone_e164 ~ '^\+[1-9]\d{1,14}$')`; `UNIQUE (company_id, phone_e164) WHERE NOT NULL` |
| `linkedin_urn` | `text` | canonical member/organization URN or vanity slug, lowercased; never a full profile URL | `UNIQUE (company_id, linkedin_urn) WHERE NOT NULL` |
| `account_id` | `uuid` | FK → `prospect_accounts(id)` | nullable; `ON DELETE SET NULL` |
| `identity_confidence` | `numeric` | 0–1 | `CHECK (BETWEEN 0 AND 1)` |

`external_keys JSONB` is **retained but demoted** to non-authoritative provider scratch. It may never be the basis of a uniqueness or join decision — it has no shape constraint beyond `jsonb_typeof = 'object'` and cannot be indexed reliably.

**Scale convention (resolves a Phase 0 §11 defect):** every confidence and score in the target architecture is `numeric` in **`[0,1]`**. `canonical_leads.qualification_score` (0–100) stays as-is and is treated as a legacy projection, never a spine input.

## DECISION 3.5 — Merge, conflict and history

- **Merge** is recorded in `unified_person_merges` (exists, 0 rows). Merges are **append-only and non-destructive**: the losing row is marked superseded and retained, never deleted.
- **Conflict resolution precedence** for a field value: `verified provider evidence` > `first-party observed` > `provider asserted` > `AI inference`. Within a tier: higher `confidence`, then more recent `observed_at`. Ties are **unresolved**, not silently picked — the field keeps its prior value and a conflict fact is recorded.
- **Historical preservation:** identity assertions are never overwritten. Every assertion is an append-only `identity_claims` row (§9); `unified_persons` holds only the *currently resolved* projection.

---

# 4. EXISTING LEAD MODEL DISPOSITION

Each of the six is classified **SOURCE** (asserts facts, writes claims), **PROJECTION** (derives from the spine, never asserts identity), or **RETIRE**.

| Model | Rows | Class | Owns | Must no longer own | Writable | Readable | Endstate |
|---|---|---|---|---|---|---|---|
| `leads` | 18 | **SOURCE** | Form/webhook submission payload, `form_id`, capture attribution | Identity resolution; being read as "the lead list" | Yes — capture path only | Yes | Permanent capture source; emits `identity_claims` |
| `contacts` | 10 | **SOURCE** | Social platform identity `(platform, platform_user_id)` | Standing in for a prospect | Yes — ingestion only | Yes | Permanent social-identity source. **0/10 linked → backfill required** |
| `active_leads` | **0** | **PROJECTION** | User-owned workflow state (status, owner, snooze, notes) | `contact_id` as its identity anchor; score rollups as truth | Yes — workflow fields only | Yes | Re-anchor to `unified_persons`. **Zero rows = free to redefine** |
| `canonical_leads` | 18 | **PROJECTION** | Analytics lead fact + `qualification_score` (0–100 legacy) | Asserting identity | Analytics writer only | Yes | Already 100% spine-linked; leave alone |
| `lead_intelligence` | 18 | **SOURCE** | Ingestion envelope + `dedupe_key` | `company_id text`; `unified_person_id text` as a pseudo-FK | Yes — ingestion only | Yes | Retype to `uuid`; promote link to real FK |
| `lead_intelligence_profiles` | **0** | **PROJECTION** | Generated intelligence envelope, regenerated from fingerprint | Being confused with accumulated memory | Engine only | Yes | Retype `company_id`; becomes the **prospect memory carrier** (§9) |

**Nothing is RETIRED in Phase 1.** Two standing decommissions are reaffirmed by evidence (both 0 rows): `lead_outreach_plans` (per `docs/WS3-ARCHITECTURE.md` §6) and `buyer_intent_accounts` — superseded by `prospect_accounts`, never extended.

**The invariant:** after Phase 1, exactly one table asserts prospect identity (`unified_persons`, via `identity_claims`). Sources propose; the resolver disposes; projections read.

---

# 5. ACCOUNT ENTITY DECISION

## DECISION 5.1 — Create `prospect_accounts`. `companies` may NEVER represent a prospect company.

`companies` = the Omnivyra **tenant** (39 rows, FK target of every `company_id`). `prospect_accounts` = a **third-party organisation** being researched, enriched, contacted or qualified. Conflating them would make every prospect a tenant and destroy the isolation model.

**Normative shape** (specification only — not a migration):

| Field | Type | Rule |
|---|---|---|
| `id` | `uuid` PK | |
| `company_id` | `uuid NOT NULL` | FK → `companies(id)` `ON DELETE CASCADE` — the owning tenant |
| `domain_normalized` | `text` | lowercase, strip scheme/`www`/trailing dot, registrable domain | 
| `legal_name`, `display_name` | `text` | |
| `external_ids` | `jsonb` | provider ids; non-authoritative, mirrors §3.4's demotion of `external_keys` |
| `status` | `text` | `active` / `merged` / `suppressed` / `archived` |
| `merged_into_id` | `uuid` | self-FK; set when merged, row retained |
| `identity_confidence` | `numeric [0,1]` | |
| `first_seen_at`, `last_verified_at`, `next_refresh_at` | `timestamptz` | freshness contract (§9) |

**Uniqueness — tenant-scoped, per Decision 3.3:**
```
UNIQUE (company_id, domain_normalized) WHERE domain_normalized IS NOT NULL AND status = 'active'
```
Two tenants may each hold their own account row for the same domain. They are distinct objects with distinct intelligence.

**Account ↔ person:** one-to-many via `unified_persons.account_id` (nullable). A person may exist without an account (Company Required readiness, §8). An account may exist with zero people (Contact Required).

**Duplicate detection** is by `domain_normalized` first, then name similarity as a *suggestion only* — never an automatic merge. Account merges follow §3.5: append-only, non-destructive, reversible.

---

# 6. SUPPRESSION / DNC DECISION

## DECISION 6.1 — `outreach_suppressions` is the sole canonical DNC model. `suppression_entries` global scope is removed.

| Property | `outreach_suppressions` (CANONICAL) | `suppression_entries` (LEGACY) |
|---|---|---|
| Rows in production | 0 | **0** |
| Tenant scope | `company_id` required, tenant-only | `company_id` defaults `'__global__'`; `scope IN ('global','tenant')` |
| Withdrawal | `revoked_at` — revoke-never-delete | `released_at` + `active` boolean |
| Immutability | DB trigger `ws3_suppression_guard`: DELETE refused; UPDATE permitted only on `revoked_at`/`revoked_by` | None |
| Scopes | `recipient` / `channel` / `task` / `lead` | `channel` + `target` |
| Verdict | **Adopt** | **Constrain now, retire later** |

**Rationale:** the canonical model is tenant-scoped by construction, append-only by database trigger rather than convention, and already integrated into the WS-3 governance engine's frozen gate order. The legacy model's global scope directly violates the brief.

## DECISION 6.2 — The global-record decision matrix is MOOT

Phase 0 demanded a legal/product matrix for existing `scope='global'` rows. **Production contains zero suppression rows of any scope.** The matrix is recorded as resolved-by-absence:

| Existing global record | Interpretation | Risk | Treatment | Approval required |
|---|---|---|---|---|
| *(none exist — 0 rows verified)* | n/a | **None** | Remove `'global'` from the `scope` CHECK and drop the `'__global__'` default **before any row is written** | **None** — no data is reinterpreted |

The two dangerous outcomes Phase 0 named — accidental cross-tenant suppression, and accidental release of someone who asked for no contact — **cannot occur**, because no record exists to migrate. This is the entire reason the correction must happen now: the moment the first suppression row is written under the current constraint, this becomes a legal question again.

## DECISION 6.3 — `isSuppressed()` contract

```
isSuppressed(tenantId: uuid, subject: {email?, phoneE164?, handle?, personId?, accountId?}, channel: string) → SuppressionVerdict
```

- **Lookup order:** canonical `outreach_suppressions` first (scopes evaluated `task` → `lead` → `recipient` → `channel`), then legacy `suppression_entries` **for the same tenant only**.
- **Conflict resolution:** **union — any active match in either store suppresses.** A revocation in one store never overrides an active suppression in the other.
- **Legacy reads are tenant-filtered unconditionally.** Even after the constraint change, the dual-read must never accept a row whose `company_id` is not the caller's tenant.
- **Fail-safe:** an error, timeout or unreadable store returns **suppressed**, matching WS-3's existing principle that absent or unreadable evidence blocks rather than permits.
- **Audit:** every verdict records which store answered, which scope matched, and the evidence — reusing the existing WS-3 governance decision record. No new audit surface.
- **Revoke semantics:** revocation is `revoked_at`/`revoked_by` only. Deletion is refused by trigger and must remain so.

**Endstate:** all writes go to `outreach_suppressions`. `suppression_entries` becomes read-only, then is retired once proven empty and unreferenced (post-Phase 1).

---

# 7. WHATSAPP GOVERNANCE DECISION

## DECISION 7.1 — WhatsApp is gated BEFORE activation, not migrated after it.

Because production has 0 WhatsApp accounts, 0 threads, 0 messages, 0 templates and 0 broadcasts, there is **no live path to preserve**. Phase 0 prescribed a dual-path parity migration; that is now unnecessary complexity.

**Target:**
```
Prospect → policy/governance → WS-3 evaluateGovernance() → transport registry → WhatsAppProvider → Meta Cloud API
```

| Concern | Decision |
|---|---|
| `WhatsAppProvider` location | `backend/services/leadOutreachExecution/whatsappTransport.ts`, mirroring `emailTransport.ts`: a `WhatsAppProviderPort { name, send() }` with an injectable default that delegates to the existing `whatsappBroadcastService` internals. **No Meta SDK, no `fetch`, no credentials in the transport.** |
| Transport registration | Explicit, caller-driven in `registerDefaultTransports()` — never an import side effect, preserving the existing registry guarantee |
| Governance invocation | `evaluateGovernance()` in its **frozen order** — `kill_switch → suppression → region → approval → rate_limit` — unchanged and unextended in Phase 1 |
| Suppression | Via `isSuppressed()` (§6.3), inside the suppression gate |
| Tenant resolution | Existing `social_accounts.phone_number_id → company_id`; retained and made an explicit precondition |
| Consent | **Deferred to Phase 4.** Phase 1 adds no consent gate. Until then, WhatsApp outbound remains disabled — see 7.2 |
| Rate limiting | Reuse `whatsappRateLimiter` (durable two-layer) **behind** the WS-3 rate-limit gate. Not a second authority — the WS-3 gate decides; the limiter supplies the count |
| Idempotency | Existing `buildIdempotencyKey(companyId, taskId, attemptNumber)` — sha256 of identity, no clock, no randomness |
| Audit / outcomes | Existing append-only `outreach_attempts` / `outreach_outcomes`. Provider acceptance records `sent_unverified`, **never** `confirmed` |
| Kill switch | The existing WS-3 global + tenant switches. **No new switch is created** — Phase 0 already flagged three switches as a defect |
| Rollback | Unregister the transport; the dispatcher then has no route for `channel='whatsapp'` and skips it |

## DECISION 7.2 — Legacy path: gated, not dual-run

`whatsappBroadcastService` remains in the tree and remains **the implementation** the provider port delegates to. What changes is **who may invoke it**:

- Direct invocation from `pages/api/whatsapp/broadcasts/*` is placed behind `WHATSAPP_OUTBOUND_ENABLED` (**default false**), independent of WS-3's transport flag.
- There is never more than one authoritative send path, because with the flag false there is exactly **zero** enabled send path until the WS-3 route is proven.
- **Cutover condition:** the kill-switch drill (7.3) passes.
- **Retirement condition:** the direct route is deleted once the WS-3 path has dispatched successfully in a non-production environment.
- **No parity window is required** — there is no production traffic to compare.

**Inbound** is separate and must be fixed first: the webhook processor cannot write a thread until W0 restores the missing columns. Inbound ingestion is **not** governed by WS-3 (governance gates *outbound contact*), but it must record a touchpoint and must never auto-reply without passing outbound governance.

## DECISION 7.3 — Kill-switch drill (specification; not implemented here)

Executed in a non-production environment against a test WABA:

1. Tenant row exists in `outreach_governance_config` with `enabled=true`, `kill_switch=false`, `enabled_channels` including `whatsapp`; WhatsApp transport registered; `WHATSAPP_OUTBOUND_ENABLED=true`.
2. Dispatch a WhatsApp `outreach_task` → assert `outreach_attempts` row with `delivery_status='sent_unverified'` and a provider message id.
3. Set `outreach_governance_config.kill_switch=true`.
4. Dispatch the **same** task shape again.
5. **Assert: no provider call occurred** — proven by a provider-port spy recording zero invocations, not by absence of a message.
6. Assert an `outreach_decisions` row exists with `blocked_by='kill_switch'`, `rule='tenant.kill_switch'`, and the task did **not** transition to `sent`.
7. Set `kill_switch=false`; dispatch again; assert normal dispatch resumes.

Repeat steps 3–7 for the **global** kill switch and for an active `outreach_suppressions` recipient match. Each gate must be independently provable, per the WS-3 milestone discipline that governance is proven before capability.

---

# 8. READINESS TAXONOMY

## DECISION 8.1 — Seven categories, first-match-wins, single evaluator, materialized

Evaluated **in order**; the first match wins and evaluation stops. Exactly one category per prospect.

| # | Category | Condition | Inputs | Enrichment can change? | Tenant-configurable in v1? |
|---|---|---|---|---|---|
| 1 | **Excluded / DNC** | `isSuppressed(tenant, subject, '*')` returns suppressed for **any** channel, or `status='suppressed'` | `outreach_suppressions`, `suppression_entries` (tenant-filtered) | No | No |
| 2 | **Email Required** | Not excluded **and** `email_normalized IS NULL` | `unified_persons` | **Yes** | No |
| 3 | **Phone Required** | Not above **and** `phone_e164 IS NULL` **and** tenant's channel policy requires phone | `unified_persons`, `outreach_governance_config.enabled_channels` | **Yes** | No |
| 4 | **Contact Required** | Not above **and** the linked `prospect_accounts` row has zero active `unified_persons` | `prospect_accounts`, `unified_persons` | **Yes** | No |
| 5 | **Company Required** | Not above **and** `account_id IS NULL` | `unified_persons.account_id` | **Yes** | No |
| 6 | **Other** | Not above **and** any blocking condition outside 1–5 (e.g. `region` in `restricted_regions`, identity confidence below floor) | governance config, `identity_confidence` | Sometimes | No |
| 7 | **Ready** | None of the above | — | — | No |

**Note on ordering:** Phase 0 reproduced the brief's ordering, in which *Phone Required* precedes *Contact Required* and *Company Required*. That ordering is preserved exactly as specified. It has a consequence worth stating: a person with no account and no phone classifies as **Phone Required**, not *Company Required*. If the intent is that account-level gaps outrank channel-level gaps, the order must change — that is a product decision (§13, O-1), not one this ADR will make unilaterally.

## DECISION 8.2 — Reconciliation obligation

```
SUM(count(category_i) for i in 1..7) = count(eligible prospects)
```
with **zero** double counting, **zero** unclassified, **zero** multi-category records. Guaranteed structurally by: a **single evaluator** function; a **single writer** to a materialized `prospect_readiness` row per person; and category 7 defined as the negation of 1–6, so no prospect can escape classification.

**Readiness is derived and materialized, never recomputed per view.** Per-view recomputation is how reconciliation failures enter a system.

## DECISION 8.3 — Tenant-configurable priority: **NOT in v1**

Phase 0 left this open (B-8). **Decision: v1 ships a compile-time constant ordering.** The resolver reads the order from a single exported constant, and the reconciliation test asserts against that constant.

**Rationale:** a configurable priority multiplies the reconciliation proof obligation by the number of distinct tenant configurations, and there is no evidence of demand — 39 tenants, 0 rows in `active_leads`, 0 in `lead_intelligence_profiles`. The constant is deliberately placed in one module so a future config table can replace it without touching the evaluator. Revisit when a tenant asks.

---

# 9. PROSPECT FACT CONTRACT

## DECISION 9.1 — Mandatory fields on every durable prospect fact

The Phase 0 six are **necessary but not sufficient**. The normative set:

| Field | Required | Purpose |
|---|---|---|
| `tenant_id` (`company_id uuid`) | **Yes** | Isolation |
| `subject_type` + `subject_id` | **Yes** | `person` \| `account`; without it a fact cannot be attached |
| `fact_type` | **Yes** | Closed vocabulary (`email`, `phone`, `role`, `pain_point`, `competitor`, `objection`, `timing`, …) |
| `value` | **Yes** | |
| `source` | **Yes** | Origin system/table |
| `provider` | **Yes (nullable)** | Vendor identity when provider-supplied; NULL for first-party |
| `evidence` | **Yes** | Verbatim excerpt / payload reference / URL. A fact without evidence is an opinion |
| `confidence` | **Yes** | `numeric [0,1]` |
| `observed_at` | **Yes** | When the world showed this |
| `recorded_at` | **Yes** | When we wrote it |
| `verified_at` | No | Last independent confirmation |
| `expires_at` / `next_refresh_at` | No | Freshness contract |
| `extraction_method` | **Yes** | `observed` \| `provider` \| `ai_inference` \| `derived` \| `human` |
| `model_version` | **Conditional** | **Mandatory when `extraction_method='ai_inference'`** |
| `provenance_ref` | **Yes** | Pointer to the originating claim/attempt/message |

## DECISION 9.2 — Four kinds, never collapsed

| Kind | Definition | Durable as fact? | Feeds scoring? |
|---|---|---|---|
| **Observed fact** | The platform saw it (form submission, inbound message) | Yes | Yes |
| **Provider-enriched fact** | A vendor asserted it, with its own confidence | Yes, with `provider` + `confidence` | Yes |
| **AI inference** | A model concluded it from evidence | **Only with `evidence` + `confidence` + `model_version`** | Yes, discounted by confidence |
| **Derived score** | Computed from facts | **No** — a score is not a fact; it lives in `prospect_scores` | It *is* the output |
| **Recommendation** | Proposed action | **No** — never durable as a fact | No |

## DECISION 9.3 — The inference rule (normative)

> **AI inference must never become a durable prospect fact without `source`, `evidence`, `confidence`, `timestamp`, `tenant` and `model_version`.** A model output lacking any of these is discarded, not stored with defaults. Defaulting a missing confidence to 1.0 — or a missing evidence to the prompt — converts a guess into a record, which is the specific failure this contract exists to prevent.

**Carried forward unchanged from WS-3 §8.4:** outcomes are **one-way**. No outcome, and no fact derived from an outcome, may enter any scoring path or the regeneration fingerprint.

**Storage:** `lead_intelligence_profiles` (0 rows, already keyed `(company_id, lead_id)`) becomes the prospect memory carrier. Its `intelligence` JSONB holds the generated envelope; accumulated facts live in a dedicated append-only store defined in Phase 4. Phase 1 defines the contract only.

---

# 10. SECURITY / TENANT ISOLATION DECISION

## DECISION 10.1 — RLS is not the tenant boundary and must not be claimed as one

Verified: the backend uses one service-role client (`backend/db/supabaseClient.ts:6`) that bypasses RLS; of 151 policies in migrations, 96 name `service_role` and 4 use `auth.uid()`. **Every new table still enables RLS** (defence for any future anon/authenticated path), but **no isolation claim may rest on it.** Isolation is proven by application-layer guards plus an explicit cross-tenant negative test per surface.

## DECISION 10.2 — Gates for every new Phase 1 surface

| Gate | Requirement |
|---|---|
| Tenant column | `company_id uuid NOT NULL` |
| FK | → `companies(id)` `ON DELETE CASCADE` |
| RLS | Enabled + service-role policy (parity with existing tables) |
| App guard | `withTenantGuard` / `enforceCompanyAccess`; all access via `ownedDbTable` |
| Negative test | **Mandatory** — tenant A cannot read/write tenant B's row; asserted per table |
| Uniqueness | Tenant-scoped (§3.3) |
| Cache keys | Any new cache key **must** include `company_id`; no new caches in Phase 1 |
| Gate script | `scripts/check-tenant-authz.js` must not exceed its 47-route baseline |

## DECISION 10.3 — Known deficiencies: fix now vs. audit separately

| Deficiency | Verified state | Decision |
|---|---|---|
| `engagement_messages` has no tenant column | **CONFIRMED in production** (`organization_id` and `company_id` both `42703`); 125 rows; tenant reachable only by joining `thread_id` | **Phase 2, not Phase 1.** Additive column + backfill from `engagement_threads` (whose `organization_id` is non-null on all 126 rows). Phase 1 adds no reader of this table, so deferring adds no new exposure. Deferring it *past* Phase 2 does. |
| 47 grandfathered tenant-authz routes | Gate PASSes; baseline unchanged | **Separate follow-up.** Phase 1 must not increase the baseline. Not a Phase 1 blocker — the debt predates this programme and none of the 47 is on a Phase 1 path. |
| Cache tenant-scoping unverified | Unknown — `aiResponseCache`, `competitor_enrichment_cache`, `image_search_cache`, `domain_eligibility_cache` | **Follow-up audit (F-2), mechanical and small.** Not a Phase 1 blocker because Phase 1 introduces no cache and reads none. It **is** a blocker for Phase 3 (enrichment), which is cache-heavy. |
| 19.9% column drift; 68 candidate code-reachable | Partially confirmed (2 true positives, 1 false positive verified) | **Follow-up audit (F-1)**, except the `engagement_threads` window columns, which are **W0** because they are a confirmed live failure on a table Phase 1 touches. |

---

# 11. PHASE 1 WORK BREAKDOWN

All items additive, flag-dark, reversible. **Nothing contacts anyone.**

| # | Work item | Files / services | Schema change | Feature flag | Read/write behaviour | Rollback | Acceptance test | Cross-tenant guard test |
|---|---|---|---|---|---|---|---|---|
| **W0** | **Reconcile `engagement_threads` window columns** (mandatory first) | `database/whatsapp_system.sql` → new migration; `pages/api/engagement/threads.ts`; `whatsappWebhookProcessor.ts` | **Additive**: `ADD COLUMN IF NOT EXISTS window_open boolean DEFAULT false`, `window_expires_at timestamptz` + partial index | None — a fix, not a feature | Restores an already-broken read path | Drop the two columns | `GET /api/engagement/threads` returns 200 for a seeded tenant; the exact select string from line 60 succeeds against a live schema | Route returns only the caller tenant's threads |
| **W1** | **Remove global suppression scope** | migration on `suppression_entries` | Drop `'global'` from `scope` CHECK; drop `'__global__'` default; make `company_id` `NOT NULL` | None | No data touched — **table is empty** | Restore prior CHECK | Inserting `scope='global'` is rejected by the DB | Legacy read path is tenant-filtered unconditionally |
| **W2** | **Retype `company_id` to `uuid`** | `lead_intelligence`, `lead_intelligence_profiles`, all `outreach_*` | `ALTER … TYPE uuid USING company_id::uuid` + add FKs | None | 5 of 6 tables empty; `lead_intelligence` 18 rows already UUID-shaped | Revert type to `text` (safe while row counts remain trivial) | All 18 `lead_intelligence` rows survive; FK to `companies` enforced | Orphan `company_id` insert is rejected by FK |
| **W3** | **Create `prospect_accounts`** | new migration | New table per §5 | `PROSPECT_ACCOUNTS_ENABLED` (default off) | Created **empty**; no reader | `DROP TABLE` | Table exists; tenant-scoped domain uniqueness enforced | Tenant A cannot read tenant B's account |
| **W4** | **Create `identity_claims`** | new migration | New append-only table per §9 | `IDENTITY_CLAIMS_ENABLED` (default off) | Created **empty** | `DROP TABLE` | Append-only: UPDATE/DELETE refused by trigger | Claims filtered by `company_id` |
| **W5** | **Normalized identity columns on `unified_persons`** | new migration | Additive nullable columns + partial unique indexes per §3.4 | None (columns nullable) | 23 existing rows unaffected — all new columns NULL | Drop columns/indexes | Existing 23 rows unchanged; E.164 CHECK rejects malformed input | Uniqueness is `(company_id, value)`, proven by inserting the same email under two tenants |
| **W6** | **Shadow identity resolver** | new `backend/services/prospectIdentity/` | None | `PROSPECT_RESOLVER_SHADOW` (default off) | Reads all six sources; writes **only** `identity_claims` + `unified_persons` link columns. **No existing reader observes any change** | Stop the job; truncate claims | ≥99% of the 18+10+18 source rows resolve or record an explicit unresolved reason | **Zero cross-tenant links** — asserted, not sampled |
| **W7** | **Suppression dual-read `isSuppressed()`** | new module; called by every send path | None | `SUPPRESSION_DUAL_READ` (default **on** — fail-safe) | Union of both stores, tenant-filtered; fail-safe suppress | Flag off → canonical store only | Active suppression in **either** store blocks a send, per channel | A tenant-B suppression never affects a tenant-A send |
| **W8** | **WhatsApp under WS-3 governance** | `leadOutreachExecution/whatsappTransport.ts`; `transportRegistry.ts`; broadcast routes | None | `WHATSAPP_OUTBOUND_ENABLED` (default **false**) + transport registration | Provider port; no direct Meta call outside it | Unregister transport → channel unroutable | Kill-switch drill §7.3 passes in non-prod | Tenant resolution via `social_accounts.company_id` proven; cross-tenant dispatch rejected |
| **W9** | **Promote program-critical `database/*.sql` into migrations** | `leads.sql`, `whatsapp_system.sql`, `engagement_unified_model.sql`, `clean-unified-schema.sql` | Idempotent `IF NOT EXISTS` — **no-op in production** | None | Governance only; production already has these tables | Delete the migration files | Applying against production is a verified no-op; applying to an empty DB reproduces the schema | n/a |
| **W10** | **Parity reports** | `scripts/` | None | n/a | Read-only | n/a | Resolver parity + suppression parity reports produced and reviewed | Reports are per-tenant, never aggregate across tenants |

**Sequencing:** W0 → W1, W2 (while empty) → W3–W5 → W6, W7 → W8 → W9, W10. W1 and W2 are ordered early **specifically** because their cost is a function of row count, which is currently zero.

---

# 12. EXPLICIT NON-GOALS

Out of Phase 1, restated and binding: phone/voice · new discovery vendors · new enrichment vendors · marketing-email implementation · readiness **live** rollout (the taxonomy is specified in §8; nothing is built) · prospect memory implementation · campaign CTA landing page · natural-language prospect selection · executive cross-channel analytics · destructive migrations · WS-2 redesign · MarketPulse redesign · billing/credit-ledger redesign · `outreach_plans` changes.

**Additionally not touched:** WS-2 engines, scores, envelopes, versions · `communityAiActionExecutor*`, `automationService`, `automationConstants`, `AUTOMATABLE_ACTION_TYPES` · `lead_outreach_plans` (decommissioned, 0 rows) · `buyer_intent_accounts` (superseded, 0 rows) · `customerOperationsService` · the WS-3 frozen dispatch order · the one-way outcome rule · applied migration files · the 44 non-code-reachable drifted columns.

---

# 13. OPEN DECISIONS / BLOCKERS

| ID | Item | What is unknown | Why it matters | Resolver | Class |
|---|---|---|---|---|---|
| **B-4** | Lawful basis / consent model | Target jurisdictions (GDPR / DPDP / CAN-SPAM / TCPA) and permissible cold-contact basis per channel | Determines whether outbound is lawful at all, and the contents of `restricted_regions` | Legal | **Hard blocker for Phase 4–5. NOT a Phase 1 blocker** — Phase 1 contacts nobody |
| **B-5** | WhatsApp Business Platform posture | Cloud vs on-prem, approved templates, opt-in capture, per-tenant vs shared WABA | Determines whether WhatsApp outreach to non-opted-in prospects is possible | Ops + legal | **Hard blocker for WhatsApp activation.** Not a Phase 1 blocker — W8 ships with the channel disabled |
| **B-6 / F-2** | Cache tenant-scoping | Key construction in `aiResponseCache`, `competitor_enrichment_cache`, `image_search_cache`, `domain_eligibility_cache` | A tenant-blind key leaks intelligence across tenants | Follow-up audit | **Hard blocker for Phase 3.** Soft for Phase 1 (no cache introduced or read) |
| **B-7** | `ENTRY_CONSUMPTION` hold; catalog migration `20260822` unapplied | Whether consumption is live and whether new actions can be priced | New `CreditAction`s cannot be priced | Ops | **Soft blocker** — Phase 1 adds no credit action |
| **O-1** | Readiness ordering: should account-level gaps outrank channel-level gaps? | Whether *Phone Required* correctly precedes *Company Required* | Changes every prospect's category and therefore every funnel number | Product | **Soft blocker for Phase 2.** §8.1 ships the brief's order as specified until overridden |
| **F-1** | Column drift: 68 candidate code-reachable missing columns | Which are true positives (2 confirmed) vs false (1 confirmed) | Each true positive is a latent `42703` in production | Follow-up audit | **Follow-up.** W0 covers the one confirmed to break a live route |
| **F-3** | `engagement_messages` tenant column | Confirmed missing; backfill source confirmed available | Message-level isolation rests entirely on a join | Phase 2 | **Follow-up, scheduled** |
| **F-4** | 47 grandfathered tenant-authz routes | Which are genuinely unsafe vs. pattern-only mismatches | Cross-tenant read risk | Separate remediation | **Follow-up.** Baseline must not grow |

**Every Phase 0 hard gate is now closed:** B-1 **RESOLVED** by production verification (§2); B-2 **RESOLVED** by Decision 3.1 (§3); B-3 **DISSOLVED** by evidence of zero rows (§6.2).

---

# 14. NORMATIVE ARCHITECTURE OWNERSHIP

| Concern | Single owner |
|---|---|
| Tenant | `companies` |
| Prospect identity | `unified_persons` |
| Prospect account | `prospect_accounts` |
| Identity claims (assertions) | `identity_claims` |
| Identity resolution (the only writer of spine links) | `prospectIdentity` resolver |
| Prospect readiness | `prospect_readiness` (single evaluator, materialized) |
| Prospect scores | `prospect_scores` — six declared axes, all `[0,1]` |
| Prospect memory / facts | `lead_intelligence_profiles` + the Phase-4 fact store |
| Cross-channel journey | `unified_touchpoints` |
| Suppression / DNC | `outreach_suppressions` — **tenant-scoped only** |
| Suppression read contract | `isSuppressed()` — the only reader of either store |
| Governance / policy | WS-3 `evaluateGovernance()` — frozen gate order |
| Transport routing | WS-3 transport registry |
| WhatsApp egress | `WhatsAppProvider` port |
| Email egress | `EmailProviderPort` |
| Enrichment egress | `companyIntelligence/providers` registry + adapters |
| AI egress | `aiGateway` |
| Outbound HTTP egress | `lib/security/safeFetch` |
| DB writes | `ownedDbTable` |
| Tenant authorization | `withTenantGuard` / `enforceCompanyAccess` |
| Billing / usage | existing credit execution runtime |
| Execution outcomes | WS-3 outcome contract (`lead.outreach.outcome.recorded`) |
| RPA / browser execution | extension command bus + `rpaWorker` |
| Schema governance | `supabase/migrations/` — **sole** location after W9 |
| Tenant key type | `uuid`, universally |
| Confidence/score scale | `numeric [0,1]`, universally |

---

# 15. FINAL GO / NO-GO DECISION

## `GO — PHASE 1 MAY START`

**Conditional on W0 executing first.**

Justification, strictly on evidence:

- **B-1 resolved.** Production verified directly: 61/61 program-critical tables present; 269/269 ungoverned tables present; column-level drift measured at 19.9% and bounded.
- **B-2 resolved by decision.** `unified_persons` adopted, `uuid` adopted, tenant-scoped uniqueness adopted, all six models dispositioned. No seventh model is created.
- **B-3 dissolved by evidence.** Zero suppression rows exist. Nothing is reinterpreted; no legal decision is required to proceed.
- **Phase 1 contacts nobody.** W0–W10 comprise additive schema, a shadow resolver that no existing reader observes, a fail-safe suppression read, and a WhatsApp transport that ships **disabled**. B-4 and B-5 therefore gate Phases 4–5 and WhatsApp activation — not Phase 1.
- **Risk is at its structural minimum.** 39 tenants, 18 leads, and zero rows in every table requiring a type or constraint change.

**The single condition — W0.** `GET /api/engagement/threads` is failing in production for all 39 tenants with `42703`, and `whatsappWebhookProcessor` cannot write a thread. Phase 1 touches that table (W8) and that route. Building on a table with a confirmed live schema defect would make every subsequent failure ambiguous. W0 is small, additive, and reversible.

**Two decisions are time-boxed and must not slip.** W1 (remove global suppression scope) and W2 (retype `company_id` to `uuid`) are free **only while the affected tables hold zero rows**. The first suppression row written under the current constraint reopens B-3 as a legal question. The first `outreach_task` written under `company_id text` makes the retype a data migration across an append-only, trigger-protected audit surface that by design refuses UPDATE. Neither is reversible in the cheap direction.

**No GO is granted for:** any outbound send on any channel; WhatsApp activation; enabling any tenant in `outreach_governance_config`; enabling `LEAD_OUTREACH_EMAIL_ENABLED`; or any destructive migration. Those require Phases 2–5 and the resolution of B-4, B-5 and B-6.

---

**END OF PHASE 0.5 ADR — decision record only. No implementation performed. Phase 1 awaits approval of this record.**
