# PI-ADR-001 — Prospect Intelligence: Frozen Architecture and Execution Contract

**Status:** ACCEPTED (architecture) · roster INCOMPLETE (see §6)
**Programme:** Prospect Intelligence (PI)
**Supersedes:** nothing. This is the first committed record of decisions that
previously existed only in orchestration conversation.

---

## 1. Why this document exists

Until now the Prospect Intelligence architecture and its Phase-1 execution plan
lived entirely in orchestrator conversation. Nothing was committed. An
orchestration audit on 2026-09-02 established this concretely:

- `git log --all --grep='PI-ADR'` → **0 commits**; no file named `*PI-ADR*`.
- No committed document defines the Phase-1 agents **A3**, **B1** or **D1** —
  the three that have already shipped to production.

That is a real risk, not a bookkeeping gap. Work was executed against an
unwritten contract, and the contract could not be checked, reviewed, or handed
over. This document closes that gap for the architecture. It does **not** close
it for the agent roster, which remains recoverable only from the orchestrator —
see §6.

---

## 2. Source of Authority

**The `PI-*` identifiers defined in this programme are the authoritative
identifiers for Prospect Intelligence work.** Any bare `A2`, `B2`, `C1`, `D1`
found elsewhere in this repository refers to a *different* programme and carries
no authority here.

This matters because the bare identifiers are badly overloaded. The same tokens
mean at least six mutually incompatible things in committed documents:

| Document | What the letters mean there | Example |
|---|---|---|
| `docs/pmo/OMNIVYRA-PMO-001.md` | PMO **ownership zones** | `A2` = "Intelligence & Egress" zone |
| `docs/pmo/LEAD-INTELLIGENCE-PROGRAM-001-PHASE-A-canonical-architecture.md` | **gap IDs** and Understanding **facets** | `A2` = "Three scoring paradigms unmerged"; `D1`–`D8` = facets |
| `docs/pmo/COMPANY-INTELLIGENCE-PROGRAM-002-PHASE-A-canonical-architecture.md` | gap IDs for a different programme | `G1`–`G9` |
| `docs/pmo/COMPANY-UNDERSTANDING-IMPLEMENTATION-001-U3-*` | **consumers** | `C1`–`C8` |
| `docs/pmo/GTM-PROGRAM-001-*` | a further distinct set | `C1`–`C7`, `A1`–`A3`, `G1`, `G9` |
| `docs/pmo/LEAD-INTELLIGENCE-001-LC-000-certification.md` | facet/gap mix | `D1`–`D7`, `G1`, `G3`, `G4`, `G8` |

**Rule:** Prospect Intelligence identifiers are always written `PI-<letter><digit>`
(e.g. `PI-A2`, `PI-D3`). Never resolve a Prospect Intelligence agent from a bare
identifier, and never infer an agent's objective from its letter — the letter
records family lineage only, and lineage is not a specification.

---

## 3. Frozen architectural decisions

These are the decisions the programme is built on. They are **frozen**: work
extends them, and does not reinterpret or replace them.

### 3.1 Canonical identity

1. **A prospect is a canonical person — `unified_persons`.** There is one person
   spine. No parallel person model may be introduced.
2. **`prospect_accounts` is the optional account layer** for the external
   employer/organisation a person belongs to. Optional means a person is valid
   without one.
3. **`identity_claims` remains the identity-claim mechanism.** It is the
   canonical external-identity store. Claims are evidence, recorded with
   provenance.
4. **No duplicate external-key namespace.** Nothing may introduce a second
   namespace for external identifiers alongside `identity_claims`.
5. **Identity resolution is conservative.** Ambiguous evidence does not mint or
   merge a person. Where a social contact cannot be resolved, **no person is
   minted**.
6. **No historical identity backfill.** Existing source populations remain
   intact and are not retroactively rewritten into the canonical spine.

### 3.2 Storage boundaries

7. **Active Leads is a run-scoped denormalised snapshot.** It is a derived
   presentation surface. **`active_leads` is NOT canonical prospect storage** and
   must never be treated as the system of record.
8. **Existing source populations remain intact.** `leads`, `contacts`,
   `lead_signals` and the engagement tables keep their current ownership.

### 3.3 Social and engagement layering

9. **Social intelligence layers through the existing path:**
   `lead_signals → contacts → engagement_threads`. No replacement ingestion
   pipeline.

### 3.4 Outreach

10. **Outreach is tenant-safe and governed.** Tenant isolation is enforced by
    composite foreign keys, not by convention.
11. **Existing `mayContact` / governance machinery is reused.** Contact
    permission is decided by the existing governance path
    (`contact_governance_records` and the outreach governance service), never
    re-implemented.

### 3.5 ICP and qualification

12. **One tenant-owned, versioned ICP.** `prospect_icps` holds identity;
    `prospect_icp_versions` holds the versioned statement.
13. **AI may propose; a person ratifies.** A model has no user id, so
    `ratified_by` is the column a model cannot fill.
14. **Ratified ICP versions are immutable.** A ratified version may only
    transition to `superseded`; its content cannot be edited. Change happens by
    ratifying a new version.
15. **Exactly one ratified version per (tenant, ICP)** — enforced by a *partial*
    unique index, which `ON CONFLICT` cannot infer (`42P10`). Writers insert and
    catch `23505`.

### 3.6 Evidence discipline

16. **Missing evidence must abstain.** An engine that lacks evidence returns an
    abstention. It does not guess, and it does not emit a confident default.

### 3.7 Reuse over reinvention

17. **Existing enrichment/provider infrastructure must be reused.**
18. **Existing scoring/intelligence infrastructure must be reused.**
19. **No duplicate schema, API, function or identity system** where an existing
    capability can be extended. A new table is justified only when no existing
    table can carry the concept without corrupting its meaning.

---

## 4. What has shipped

Verified against production and `origin/main` on 2026-09-02.

| Item | State |
|---|---|
| W1–W5 identity foundation | live (`prospect_accounts`, `identity_claims`, `unified_persons.account_id`) |
| LI-1…LI-4C, P2A | live (`source_records`, `contact_governance_records`, `person_duplicate_candidates`, account firmographics) |
| **A3** outreach person anchor | live — `backend/services/leadOutreachExecution/personAnchor.ts` |
| **B1** social contact → canonical person | live — `backend/services/prospectIdentity/socialContactResolution.ts` |
| **D1** tenant ICP model | live — `backend/services/prospectIcp/**`, `pages/api/prospect-icp/{propose,ratify}.ts` |

**Spine occupancy:** `unified_persons` 23 · `identity_claims` 42 · `contacts` 10
· `leads` 18 · every other prospect table **0**, including `prospect_icps` and
`prospect_icp_versions`.

The spine is built and empty. Two consequences for planning: real-schema testing
is cheap and production collision risk is low, but nothing downstream can yet be
validated against live prospect volume.

---

## 5. Orchestration contract

### 5.1 Surfaces that require orchestrator serialisation

Any agent touching these must be serialised, whatever its objective:

| Surface | Why |
|---|---|
| `supabase/migrations/**` | ledger is desynced (48 recorded rows vs 420+ files); `check:migrations` enforces unique 14-digit prefixes. Two agents authoring migrations in one window collide on version ordering. |
| `config/env.schema.ts` | single environment contract; every new variable lands in one file |
| `backend/db/supabaseKeys.ts`, `lib/supabase/publishableKey.ts` | single credential seams |
| `backend/security/capabilityRegistry.ts`, `shared/contracts/security/SecurityCapabilities.ts` | every new capability edits the same two files |
| `backend/services/prospectIdentity/**`, `backend/services/prospectIcp/**` | canonical identity and ICP resolution |
| `backend/tests/unit/prospectIdentityIngestionBoundary.test.ts` | closed allow-list |
| `backend/tests/unit/supabaseApiKeyMigration.test.ts` | closed allow-list spanning **all** runtime files |

The last two are the specific mechanism by which two independently-green
branches fail *after* merge. This is demonstrated, not theoretical: it happened
during the A3/B1/D1 wave.

### 5.2 Reserved to the orchestrator

Canonical schema and migration **application**, identity resolution semantics,
cross-module contracts, shared APIs, security capabilities and governance, and
**all** production deployment.

Authoring a migration `.sql` is agent work. **Applying** it is not — application
goes through a committed `scripts/ops/<slug>-ddl-<date>.js` script, one file, one
transaction, with independent catalog verification.

### 5.3 Merge discipline

1. Clean worktree per agent, branched from current `origin/main` — never from
   another agent's branch.
2. **No agent deploys.** The predeploy gate requires `HEAD == origin/main`, which
   a feature branch cannot satisfy. This is by design.
3. **No agent applies a migration.**
4. **Verify the merged result, not the branch.** Merge locally, then run the
   affected suites plus `typecheck:ci` and `typecheck:certification` on the
   merged tree. A green branch is not evidence.
5. **One migration in flight at a time.**
6. Integration only through `main`, in orchestrator order. No cherry-picking.

### 5.4 Agent reporting format

Every agent returns exactly these sections, so results consolidate without
evidence loss:

```
## Verdict            COMPLETE | PARTIAL | BLOCKED
## Scope touched      files changed, with one line each on why
## Schema             migrations authored (never applied), or NONE
## Evidence           commands run and their actual output
## Contracts          any shared contract touched, and why it was unavoidable
## Non-regression     merged-result test + typecheck results
## Left undone        anything out of scope or blocked, stated explicitly
```

---

## 6. Phase-1 roster — INCOMPLETE

The twelve outstanding Phase-1 agents are enumerated in
[`prospect-intelligence/PHASE-1-ROSTER.md`](./prospect-intelligence/PHASE-1-ROSTER.md).

**All twelve are currently `BLOCKED — DEFINITION UNAVAILABLE`.** Their objectives
were never committed and are not recoverable from this repository. Per the
programme rule in §2, an objective must not be inferred from an identifier, so
the roster records the identifiers, the execution-field template, and the
specific input required to unblock each one — and nothing invented.

See that document for the unblocking procedure.
