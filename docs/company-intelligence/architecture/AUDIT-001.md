# COMPANY-PROFILE-AUDIT-001 — Architecture & System Discovery

**Scope:** Read-only architectural audit of the Company Profile implementation. Certified baseline for all subsequent audits. All claims anchored to `file:line`.

**Verdict: Highly Coupled** (with well-designed islands).

---

## 1. Executive Summary

The Company Profile is one of the largest single features in the codebase: ~8,600 lines of frontend across 13 files, 23 API routes under `pages/api/company-profile/` (plus 2 onboarding routes that seed profiles), a ~3,265-line backend service fragmented across a 5-file barrel chain, an 18-file sub-module directory (`backend/services/companyProfile/`, ~4,900 lines), and one wide table (`company_profiles`) that also serves — via `report_settings` JSONB — as the storage substrate for website fingerprints, knowledge versions, crawl metadata, and provenance.

The dominant pattern is **"one giant object, threaded everywhere"**:
- **Frontend:** a 2,384-line data hook (`useCompanyProfileState.tsx`) with ~60 `useState`s returns a ~230-key object, which a 789-line controller hook re-expands to ~290 keys, prop-drilled and fully destructured in every section component.
- **Backend:** a service barrel split by line count, not responsibility, with near-circular imports resolved only through the barrel, and a read function (`getProfile`) that can silently invoke the LLM and write the database.
- **Data:** a table with no foreign key to the tenant root, a TEXT/UUID type mismatch on the tenant key, and a multi-writer JSONB grab-bag with no concurrency control.

The system is mid-migration toward a canonical read model; the newly landed Company Knowledge Graph (commit 52305785) is a third "source of truth" adopted so far by one endpoint.

## 2. Frontend Architecture

- **Route:** `/company-profile` (`pages/company-profile.tsx`, 307 lines) + a barrel route `/company-profile-form`. Onboarding deep-links via `?companyId&onboarding=company-profile`; `?ai_refine=1` auto-starts refinement.
- **Component hierarchy:** route → `CompanyProfileForm` (`companyProfileFormMain.tsx`, 455) → `useCompanyProfileFormController(d)` → SectionsA (543) / SectionsB (526) / SectionsC (792) + `CompanyStrategyProfileCard` (678, self-contained state+fetches) + 6 `GuidedChatPanel`s. Seven files exceed 500 lines; the data hook is 2,384.
- **State:** `useCompanyProfileState` — ~60 `useState`s, no reducer, ~230-key return; six guided-chat threads (4 states each); a security effect clears all server state on `user.userId` change (:174-210). `CompanyContext` (742 lines) owns auth lifecycle, roster fetch (single-flight+retry), auth FSM, permission matrix. No SWR/react-query/Redux. Cross-feature signaling via localStorage + `company-profile-updated` CustomEvent (:278-299).
- **Data fetching (mount order):** roster → profile (`?companyId&includeCompleteness=1`) → intelligence-context → intelligence-enrichment → refinements; strategy card fetches independently.
- **Save:** pessimistic, full-object, button-driven (`saveProfile` POSTs the entire profile). Partial saves for brand assets, guidance, intelligence-context, PT, onboarding-presence. Guided chats stage optimistically then confirm. AI refine strips competitors from payload and shows a timer-driven fake progress bar decoupled from the request.
- **Loading/errors/validation:** plain "Loading profile…" text (no skeletons); single shared error banner; several fetches fail silently to `console.warn`; retry only in `CompanyContext`. Validation limited to website canonicalization + URL normalization + brand-asset checks — no schema/form library.
- **Six AI chat surfaces** each hit their own endpoint (target customer, campaign purpose, marketing intel, competitor, context intel, problem-transformation).

**Smells:** god hook (2,384 lines); mega-object prop-drilling (identical ~70-line destructures across SectionsA/B/C); double hook instantiation across page + form; mechanical babel line-range splits; a dead `CompanyProfileChatPanel`; duplicated fetch/save logic; fake progress decoupled from request; hidden coupling via localStorage/CustomEvent; captured-but-unused diagnostics; auth logic split between context and hook.

## 3. Backend Architecture

- **API layer:** every route wraps `createApiRoute` (observability + error-classification only; no auth/rate-limit/validation). Dominant guard `resolveCompanyAccess`; a stronger `enforceCompanyAccess` used by only one endpoint. No route-level rate limiting, credit checks, or `aiRequestGuard` on any company-profile AI endpoint.
- **23 endpoints + 2 onboarding.** No shared conversational engine — the six `define-*`/chat endpoints each hand-roll auth/AI/parse/loop. KG adoption 1-of-6. Three apparently dead endpoints: `completeness`, `mission-context`, `forced-context`.
- **Service layer:** a 5-file barrel chain (~3,265 lines) split by line count; each real file repeats a ~130-line preamble; near-circular imports through the barrel; 60+ aggregate importers. Genuine sub-modules in `backend/services/companyProfile/` (18 files) — types, normalization, extraction schema, refinement prompts, classification (817 lines), archetype, PT, strategy/marketing drafts, governance, provenance, competitor filter, and `companyKnowledgeGraph.ts` (317, one caller).
- **Read paths (three coexist):** legacy `getProfile` (Pulse.ts:720, with hidden autoRefine/languageRefine side effects); canonical `getCanonicalProfile` (adapter:300, 3-mode flag, default off); raw `supabase.from('company_profiles')` across ~52 files.
- **Write paths (four seams):** `saveProfile`→upsert (guarded, 8-attempt column-drop retry); AI refine `runProfileRefinement`; field-specific writers; raw-supabase deterministic writers (bootstrap, incremental-metadata) that bypass `saveProfile`.
- **AI seam:** single gateway `runCompletionWithOperation` (gpt-4o-mini, temp 0, JSON mode). Crawl pipeline: `crawlWebsiteSources` → fingerprint → refresh gate → LLM chain. Background: no cron re-refresh; lazy staleness + event-driven.

## 4. Database Architecture

- **Tables:** `company_profiles` (one row/company, ~60 columns + `report_settings` JSONB); `company_profile_refinements` (append-only audit, write-only); `companies` (tenant root, UUID); `company_context_*` satellites (real FKs + CHECKs + triggers).
- **No dedicated tables** for confidence/provenance/fingerprints/snapshots — all in `company_profiles`: `field_confidence` JSONB, `user_locked_fields` JSONB, `report_settings` (a multi-writer grab-bag: report inputs, `website_fingerprint`, `knowledge_version`, `discovered_metadata.provenance`, `company_facts`). ≥5 read-modify-write writers, no lock.
- **Constraints/RLS:** schema split between untimestamped `database/*.sql` and timestamped `supabase/migrations/`. RLS enabled but service-role-bypass only — no runtime tenant isolation; `company_id` is TEXT with no FK to `companies.id` (UUID). `recommendation_context` declared TEXT but holds JSON. Hand-maintained `COMPANY_PROFILE_FALLBACK_COLUMNS` mirror. No fully-unreferenced columns; the clearest unused surface is the write-only refinements table.

## 5. End-to-End Data Flow

Five flows traced: **Page load** (roster → profile with possible read-triggered LLM refine → parallel context/enrichment/refinements → sections render); **Manual save** (full-object POST → business reclassification → competitor engine → column-drop retry → localStorage/CustomEvent broadcast); **AI refine** (crawl → fingerprint → refresh gate [SKIP/METADATA/AI] → clean → extract → classify → competitor discovery → strategy/marketing drafts → upsert → audit → knowledge version + orchestration event, with a client-side fake progress bar); **Guided conversation** (×6, KG grounding only for target-customer, staged then confirmed); **Profile creation** (setup-company → seed rows → crawl → bootstrap → eager refine → redirect).

## 6. Dependency Map

Inbound: auth (four models), AI gateway (single), internal crawler, Wikidata, no profile-owned storage, Supabase service-role. Outbound: the profile is the grounding substrate for nearly all generation — `getCanonicalProfile`/grounding in 103 files; 96 registered grounding consumers; major consumers include buildContentContext, blog/post/thread/newsletter pipelines, unified engines, recommendation/campaign services, creator resolvers, mission context, scheduler, and 40+ API routes.

## 7. Responsibility Matrix

Leaky at the page (dead prop extraction), god hook (server I/O + state + roles + onboarding + six chat state machines + broadcasting), mixed controller (derived state + image processing + JSX helpers), acceptable-but-coupled sections, mixed API routes (transport + direct DB + hand-rolled AI), mixed barrel service (reads that write and call LLMs). Good: focused `companyProfile/` sub-modules, canonical adapter, refresh orchestrator, bootstrap. Weak: the database delegates integrity to app code.

## 8. Strengths (preserve)

Canonical adapter rollout pattern; refresh gate / change-detection cost-engineering; single AI seam; `user_locked_fields` + fill-empty discipline; deterministic idempotent bootstrap; provenance without schema; frontend per-user state clearing; competitor read/write scrub; the `company_context_*` schema discipline; role-based redaction concept; uniform route observability.

## 9. Initial Architecture Concerns (list only)

God hook; mechanical line-count splits; opaque barrels; reads with side effects; hidden localStorage/CustomEvent signaling; silent column-dropping upsert; fake progress; three competing "source of truth" models; six conversational endpoints with no shared engine; competitor logic across four files; three dead endpoints; four auth models; role gating on 2 of ~12 write endpoints; no rate/credit guard on ~10 AI endpoints; `company_id` TEXT no-FK; non-isolating RLS; `report_settings` lost-update races; two write regimes; split schema sources; unbounded refinements table; full-object last-writer-wins saves; no retry/error surfacing.

## 10. Final Assessment

**Highly coupled**, with deliberate decoupling islands. Frontend: one state object through three layers touching 5+ files per change. Backend: mutual imports, 60+ importers, reads with write/AI side effects, a ~250-line function coupling crawl+gating+AI+classification+persistence. Data: one table as profile+fingerprint+knowledge+provenance+settings store with five writers and no concurrency control — the strongest coupling, because ~96 grounding consumers transitively depend on its shape. Cross-cutting: tenancy/roles/errors decided per-endpoint. Not "requires deeper investigation" — the discovery converged; the load-bearing seams are identified. A system captured mid-consolidation where new authorities are built but adoption is incomplete.

---
**Related:** [AUDIT-002](AUDIT-002.md) · [DESIGN-001](DESIGN-001.md) · **Depends on:** — · **Related ADRs:** — · **Amendments:** none · **Editions:** Reference (this) · Full: [`../full/AUDIT-001-FULL.md`](../full/AUDIT-001-FULL.md) · **Certification:** Highly Coupled. See [`../appendices/relationships.md`](../appendices/relationships.md).
