# Prospect Intelligence — Phase-1 Agent Roster

**Parent:** [`../PI-ADR-001.md`](../PI-ADR-001.md)
**Status:** 12 of 12 agents `BLOCKED — DEFINITION UNAVAILABLE`
**Last verified:** 2026-09-02 against `origin/main` `9049215a`

---

## 1. Why every agent is blocked

The Phase-1 agent objectives were never committed. They existed only in
orchestration conversation, and that conversation is no longer available as a
source. Searching the repository does not recover them and actively misleads:

- `git log --all --grep='PI-ADR'` → **0 commits**; no `*PI-ADR*` file exists.
- No committed document defines **A3**, **B1** or **D1** in the Prospect
  Intelligence sense — and those three have already shipped. If the specs for
  *completed* work were never written down, the specs for pending work were not
  either.
- The bare identifiers resolve to unrelated programmes. `B2` in this repository
  is a blog-workflow audit finding ("Series/Relationships CRUD: Missing
  company_id"). `E1` is a data-flow-diagram mismatch, plus two font binaries.
  `F1` is a comment in `campaign-generation-contracts.yml` about content-memory
  independence. None is a Prospect Intelligence agent.

Per PI-ADR-001 §2, **an objective may not be inferred from an identifier.** So
this roster records identifiers, the required execution fields, and the exact
input needed to unblock — and invents nothing.

Writing a plausible objective here would be worse than leaving it blank. A
fabricated agent arrives at implementation time proposing schema the frozen
architecture already covers, and PI-ADR-001 §3.7 exists precisely to prevent
that. Twelve fabricated agents would seed that error into twelve parallel
branches at once.

---

## 2. What *is* known, and what it is not

Three Phase-1 agents shipped, so their identifiers carry **family lineage**.
Lineage tells you which part of the system a sibling touched. It is **not** a
specification and must not be used as one.

| Family | Shipped sibling | What that sibling did | Lineage evidence for pending agents |
|---|---|---|---|
| `PI-A*` | **A3** | bound outreach tasks to a canonical person (`personAnchor.ts`, `outreach_tasks.person_id`) | `PI-A2` is *likely* outreach-execution family. Objective unknown. |
| `PI-B*` | **B1** | resolved social contacts to canonical persons (`socialContactResolution.ts`) | `PI-B2`, `PI-B3` are *likely* social/contact-identity family. Objectives unknown. |
| `PI-D*` | **D1** | tenant-owned versioned ICP (`prospect_icps`, `prospect_icp_versions`) | `PI-D2`, `PI-D3`, `PI-D4` are *likely* ICP/qualification family. Objectives unknown. |
| `PI-C*`, `PI-E*`, `PI-F*`, `PI-G*` | none | — | **No lineage evidence whatsoever.** |

"Likely family" is a hint for whoever holds the original plan. It is not
authority to start work.

---

## 3. Required execution fields

Every agent specification must carry all of these before it may be scheduled.
An agent missing any field is not schedulable.

| Field | Meaning |
|---|---|
| **Objective** | one sentence: what changes in the system when this is done |
| **Existing implementation to reuse** | named modules/tables it must extend rather than replace (PI-ADR-001 §3.7) |
| **File/module scope** | the paths it may touch; anything outside is out of scope |
| **Schema scope** | tables/columns it may read and write; `NONE` is a valid and common answer |
| **API scope** | routes it may add or change; `NONE` is valid |
| **Upstream dependencies** | other `PI-*` agents whose output it consumes |
| **Acceptance / evidence criteria** | what proof of completion looks like |
| **Explicit non-goals** | what it must not do, especially adjacent temptations |
| **Parallelisation class** | `PARALLEL-SAFE` · `SERIAL` · `ORCHESTRATOR-ONLY` |
| **Collision surfaces** | which PI-ADR-001 §5.1 surfaces it touches |
| **Migration authoring required** | yes/no — authoring only; application is orchestrator work |
| **Deployment required** | yes/no — agents never deploy (PI-ADR-001 §5.3) |

---

## 4. The roster

All entries below are `BLOCKED — DEFINITION UNAVAILABLE`. Fields are left empty
deliberately; empty is honest, a guess is not.

| ID | Status | Family lineage | Objective | Deps | Class |
|---|---|---|---|---|---|
| `PI-A2` | BLOCKED | outreach execution (from A3) | *unavailable* | *unknown* | *undetermined* |
| `PI-B2` | BLOCKED | social/contact identity (from B1) | *unavailable* | *unknown* | *undetermined* |
| `PI-B3` | BLOCKED | social/contact identity (from B1) | *unavailable* | *unknown* | *undetermined* |
| `PI-C1` | BLOCKED | none | *unavailable* | *unknown* | *undetermined* |
| `PI-C2` | BLOCKED | none | *unavailable* | *unknown* | *undetermined* |
| `PI-D2` | BLOCKED | ICP / qualification (from D1) | *unavailable* | *unknown* | *undetermined* |
| `PI-D3` | BLOCKED | ICP / qualification (from D1) | *unavailable* | *unknown* | *undetermined* |
| `PI-D4` | BLOCKED | ICP / qualification (from D1) | *unavailable* | *unknown* | *undetermined* |
| `PI-E1` | BLOCKED | none | *unavailable* | *unknown* | *undetermined* |
| `PI-E2` | BLOCKED | none | *unavailable* | *unknown* | *undetermined* |
| `PI-F1` | BLOCKED | none | *unavailable* | *unknown* | *undetermined* |
| `PI-G1` | BLOCKED | none | *unavailable* | *unknown* | *undetermined* |

**Dependency graph:** cannot be derived. A dependency graph is a function of
objectives and schema scopes; with neither, any graph drawn here would be
decoration.

**Parallel grouping:** cannot be derived, for the same reason. Under
PI-ADR-001 §5.1 all twelve are provisionally `SERIAL` until proven otherwise —
the safe default, not a finding.

---

## 5. Unblocking procedure

For each agent, the orchestrator supplies the **Objective** and **Schema scope**.
Everything else in §3 is then derivable from the repository, and the dependency
graph, parallel groups and collision analysis follow deterministically.

The minimum viable input per agent is two lines:

```
PI-XX  Objective: <one sentence — what changes in the system>
PI-XX  Schema:    <tables it reads / writes, or NONE>
```

Objective plus schema scope is sufficient because file scope follows from the
architecture, collision surfaces follow from file scope, and parallelisation
class follows from collision surfaces.

An agent whose objective genuinely cannot be recovered should be **retired**
rather than carried as a permanently blocked row. A roster entry that no one can
define is not work; it is an unresolved question wearing an identifier.

---

## 6. Constraints that apply to every agent once defined

From PI-ADR-001 §3, restated here because these are the rules agents most often
break:

- Extend `unified_persons`, `prospect_accounts`, `identity_claims` — never
  parallel them.
- No second external-key namespace.
- No historical identity backfill.
- `active_leads` is a derived snapshot, never canonical storage.
- Social intelligence flows `lead_signals → contacts → engagement_threads`.
- Reuse `mayContact` / governance; never re-implement contact permission.
- Ratified ICP versions are immutable; supersede, never edit.
- Missing evidence abstains.
- Reuse existing enrichment, provider and scoring infrastructure.
- A new table is justified only when no existing table can carry the concept
  without corrupting its meaning.
