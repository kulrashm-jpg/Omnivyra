# Programme Execution Register

The single, version-controlled record of what is done, verified, blocked and next. Jira/JEV governance automation is suspended (founder, 2026-11-02) and is not a dependency of engineering.

- **Source of truth:** `docs/programme/milestones.json` (milestones, acceptance criteria and their states, evidence).
- **Generated block:** `node scripts/programme/register.js` validates the rules and rewrites the section between the GENERATED markers. `--check` validates only.
- **Rules enforced by the script:** a criterion at T1 or above needs an evidence reference; a milestone is Accepted only when every criterion is accepted with evidence; Blocked needs a named blocker; a status above Not Started needs an actual start date.
- **Effort:** `docs/programme/effort-log.csv`. Only rows with method `recorded` (start and end captured) count as recorded time; earlier rows are inferred and labelled so.
- **Reports:** daily in `docs/programme/reports/daily/`, weekly in `docs/programme/reports/weekly/`.
- **Update mechanism:** every change that moves a criterion edits `milestones.json` in the same commit as the code or evidence, then runs the script.

## Baseline (2026-11-02)

| Item | State |
| --- | --- |
| main | `5025f51d` (unchanged since the audits) |
| Release candidate | `7bdd76ae`, 68 ahead / 0 behind, merges clean, 8 migrations, **not merged** |
| Integration branch | `d682ab13`, 139 ahead, merges clean with main and the RC, 23 migrations (22 to renumber), T2 last run at `21f62238` (stale), **not merged** |
| Typecheck gate fix | `a27ff537` on `fix/typecheck-gate-run-validity`, T1 verified, local |
| Migration controls | `51d43e98` on `ci/migration-controls`, T1 verified, local, awaiting human review |
| gov2 actor contract | preserved only; conflicts with migration controls (3 tests) |
| Ranked list `6a6c3d9b` | local; lands after the integration branch |
| Production | ledger 93 rows, max `20270111000003` (2026-11-01); current schema, flags, jobs and holds unmeasured |
| Security exposure | repository still **PUBLIC**; leaked branch still on GitHub; no rotation done; revoke8 log export not run (decision by 2026-11-04 12:00 UTC) |
| Preservation | 26 worktrees archived + 812-ref bundle verified locally; no off-machine copy |

New local work since the audits (none pushed):

| Branch | Commit | Milestone |
| --- | --- | --- |
| `sec/governance-release-lock` | `ce1d6e15` | SEC-05 |
| `sec/creator-upload-secret-fail-closed` | `a0c67c55` | SEC-06 |
| `sec/encryption-key-rotation` | `88b9378b` | SEC-03 |
| `sec/log-redaction-secret-scan` | `73396d96` | SEC-04 |
| `programme/execution-register` | this register | FND / SF |

### Discrepancies with earlier audit evidence

- The creator-upload literal secret (audit E.1) is **not live**: `verifyUploadSession` has no production caller. Fixed anyway (SEC-06).
- A secret scanner (`scripts/check-secrets.js`) already existed in CI; the targeted review said "no secret scanning". It now covers three more token families (SEC-04).
- Release-candidate migrations: 8, not 7 (corrected in the readiness package).
- Typecheck baseline is 0, not above 0 (corrected in the readiness package).
- Encryption-key rotation cannot be completed by the dual-key change alone: WhatsApp phone encryption is on the unmerged integration branch and must adopt the key ring first, and re-encryption repositories are not bound yet.

## Shared-foundation dependency map

Contracts are in `docs/programme/SHARED-CONTRACTS.md`. Arrows read "is needed by".

```
SF-02 tenant identity ──► every contract
SF-01 prospect identity ──► PI-01..05 ──► AIO-02 enrollment ──► VS-01
SF-04 suppression ──► OUT-03 egress gate ──► VS-01 (AS-5)
SF-03 consent (counsel K-1) ──► PI-07 ──► VS-02 (T3) and every non-email channel
SF-05 per-send approval (GD-1) ──► AIO-03 ──► VS-01 (AS-4)
SF-06 correlation ids ──► AIO-04 ──► OUT-05..07 ──► VS-01 (AS-6..8)
SF-07 outcome / lifecycle (GD-2) ──► OUT-08, PI-06 ──► VS-01 (AS-9)
SF-08 credits (K-8) ──► OUT-04 metering ──► VS-01 (AS-5)
SF-09 handoffs ──► AIO-04, OUT-05..07
SF-10 migrations (GD-4) ──► REL-07 renumber ──► AIO-01 ──► AIO-02..06, OUT-01..08, PI-06, PI-09, PI-10
SF-11 security/audit ──► everything that changes eligibility, approval or credits
```

**Hard dependencies:** REL-07 (integration renumber + fresh T2) needs GD-4 **and** production P1/P3; most of Tracks 2 and 3 build on the integration code and wait for it. REL-04 (release candidate) needs the L-1 probe and push approval. REL-05 (reapers) needs P11.

**Can proceed in parallel now (no cross-track decision):** SEC-03/04/05/06 (done locally), REL-06 backport, PI-08 single suppression store, OUT-03 egress gate (local build; merge needs GD-3), OUT-09 DM containment (scope needs J-5), PI-01..05 T2 runs at main, SF contract tests that do not need the integration code.

**Independent track acceptance:** Track 1 (PI) can reach T2 on main for AS-1/AS-2 before the integration branch lands. Tracks 2 and 3 cannot reach T2 until REL-07.

## Cadence

- Daily report: what changed (with evidence), what is blocked, who waits on whom, next critical milestone, founder decisions needed.
- Weekly: milestone and resource review from the generated block.
- Immediate escalation: security exposure, blocked dependency, migration risk, schedule-critical decision.

<!-- GENERATED:BEGIN (scripts/programme/register.js) -->
_Generated 2026-11-02 from docs/programme/milestones.json. Percentages count acceptance criteria; columns are exclusive (each criterion is counted once, at its current state)._

### Progress

| Scope | Criteria | Accepted | T2 verified | T1 verified | Implemented, unverified | Open |
| --- | --- | --- | --- | --- | --- | --- |
| Containment, baseline and release foundations (Stages 0-2) | 56 | 0% | 0% | 23% | 4% | 73% |
| Shared-foundation contracts | 23 | 0% | 0% | 9% | 48% | 43% |
| Track 1 - Prospect Intelligence | 17 | 0% | 0% | 0% | 29% | 71% |
| Track 2 - AI Intelligence and Orchestration | 11 | 0% | 0% | 0% | 18% | 82% |
| Track 3 - Outreach Engines | 13 | 0% | 0% | 0% | 15% | 85% |
| Integrated vertical slice (AS-1..AS-9) | 10 | 0% | 0% | 0% | 0% | 100% |
| **Overall programme** | 130 | 0% | 0% | 12% | 17% | 72% |

### Milestones by status

Not Started: 20 · In Progress: 1 · Implemented: 19 · T1 Verified: 7 · T2 Verified: 0 · Accepted: 0 · Blocked: 8 · Deferred: 3

### Milestone register

| ID | Title | Status | Owner | Target window | Age (days) | Variance | Tier | Blockers | Next action | Approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **FND** | **Containment, baseline and release foundations (Stages 0-2)** | | | | | | | | | |
| SEC-01 | Repository and public-branch containment | Not Started | Founder | 2026-11-02..2026-11-03 | — | on window | T3 | Founder action (FA-02, FA-03, FA-05) | Founder: gh repo edit --visibility private; list Actions secret names; delete preserve/creator-canonical-template-pool after archive verified | Founder executes |
| SEC-02 | Credential rotation phases A-E | Not Started | Founder | 2026-11-03..2026-11-10 | — | on window | T3 | Founder action; phase E needs a maintenance window | Phase A control-plane tokens | Founder executes |
| SEC-03 | ENCRYPTION_KEY dual-key support (unblocks rotation phase F) | T1 Verified | Claude Code agent | 2026-11-02..2026-11-04 | 0 | on window | T2 | Phase F also needs: WhatsApp follow-up (after integration lands) and repositories bound for every encrypted column; rollback is one-way once k1: values are written | Review 88b9378b; bind re-encryption repositories; WhatsApp follow-up on integration base | Push/merge; phase F cut-over by founder |
| SEC-04 | Central log redaction and secret scanning | T1 Verified | Claude Code agent | 2026-11-02..2026-11-04 | 0 | on window | T1 | ~3.8k direct console.* calls bypass the logger (separate change) | Review 73396d96; founder installs pre-commit hook and makes the check required after push | Push/merge; required-check wiring by founder |
| SEC-05 | Tenant release cannot lift unsubscribe / consent withdrawn / complaint (GD-3 interim) | T1 Verified | Claude Code (session a410c8dc) | 2026-11-02 | 0 | on window | T2 | Merge approval | Review + push approval for sec/governance-release-lock (ce1d6e15) | Push/merge |
| SEC-06 | Creator upload-session verification fails closed without its secret | T1 Verified | Claude Code (session a410c8dc) | 2026-11-02 | 0 | on window | T1 | Merge approval | Review + push approval for sec/creator-upload-secret-fail-closed (a0c67c55) | Push/merge |
| SEC-07 | revoke8 SQL Editor evidence (decide by 2026-11-04 12:00 UTC; window ~15:56 UTC) | Not Started | Founder | 2026-11-02..2026-11-04 | — | on window | T3 | Founder decision; Supabase plan (Pro/Team) unconfirmed | Founder: export (Route A) or record decision to let it expire | Founder decision + execution |
| SEC-08 | Counsel briefing on notification duties | Not Started | Founder | 2026-11-02..2026-11-06 | — | on window | T3 | External (counsel) | Founder briefs counsel with the prepared facts (no secret values) | Founder |
| PRES-01 | Preservation of engineering work | In Progress | Claude Code / Founder | 2026-11-02..2026-11-03 | 0 | on window | T2 | Off-machine copy needs founder (destination) | Founder: gpg-encrypt and copy archive off-machine; verify hashes | Founder executes copy |
| BASE-01 | Production verification session (21 statements + dashboard checks) | Not Started | Founder | 2026-11-03..2026-11-05 | — | on window | T3 | Founder: route R1/R2 decision and ~100 minutes | Founder runs C:/omnivyra-archive/execution-readiness-20261102/runbook | Founder executes (read-only) |
| REL-01 | Typecheck gate cannot pass on a crash | T1 Verified | Claude Code (session a410c8dc) | 2026-11-02..2026-11-05 | 0 | on window | T1 | Review + push approval | Review a27ff537; push after repo private | Push/merge |
| REL-02 | Migration controls (version reservations, applied-migration immutability) | T1 Verified | Claude Code (session a410c8dc) | 2026-11-02..2026-11-07 | 0 | on window | T2 | Full human review; push approval | Line-by-line review of 51d43e98 | Push/merge |
| REL-03 | Reconcile gov2 actor contract with migration controls | Not Started | unassigned | after REL-02 | — | n/a | T1 | REL-02 review | One registry schema + one checker | Push/merge |
| REL-04 | Release candidate 7bdd76ae landed (L-1..L-10) | Blocked | Founder (operator) + Claude Code (prep) | 2026-11-04..2026-11-12 | — | on window | T3 | L-1 probe (BASE-01); decisions RC04/RC05; push approval; repo private first | Founder: L-1 probe + options 04/05 | Push, migrations, merge, deploy |
| REL-05 | Credit reaper and reconciliation scheduled safely | Blocked | unassigned | after P11 | — | n/a | T3 | P11 HOLD backlog, wallet consistency, idempotency and controlled-test evidence required first | Read P11; dry-run reaper on a controlled copy | Production config change |
| REL-06 | Backport scheduled-post authorization fix d8d79b74 | T1 Verified | Claude Code (session a410c8dc) | 2026-11-03 | 0 | on window | T2 | Merge approval | Review + push approval for fix/scheduled-post-authorization-backport (c51bfda9) | Push/merge |
| REL-07 | Integration branch renumbered (keep 20261127000000; 22 -> 20270121000000-21) with fresh T2 | Blocked | Claude Code (after approval) | after GD-4 + P1/P3 clean | — | n/a | T2 | GD-4 decision; production P1/P3 clean | Wait for GD-4 approval and P1/P3 | GD-4; then push/merge |
| REL-08 | Jira/JEV governance adoption of pending branches | Deferred | Founder | suspended | — | n/a | T1 | Founder suspended Jira/JEV governance automation (2026-11-02) | None while suspended | Founder |
| **SF** | **Shared-foundation contracts** | | | | | | | | | |
| SF-01 | Canonical prospect/person identity contract | Implemented | PI track | 2026-11-02..2026-11-05 | 0 | on window | T2 | — | Contract tests (identity resolution + one-anchor rule) | None |
| SF-02 | Company and tenant identity contract | Implemented | Platform | 2026-11-02..2026-11-06 | 0 | on window | T1 | — | Contract test: tenant key types on new tables | None |
| SF-03 | Consent, lawful basis and jurisdiction contract | Blocked | PI track | after counsel K-1 | 0 | n/a | T2 | Counsel K-1 (lawful basis per channel/region) | Schema design can proceed; policy values wait for counsel | Founder + counsel |
| SF-04 | Suppression / unsubscribe / DNC / contact-eligibility contract | Implemented | PI track | 2026-11-02..2026-11-08 | 0 | on window | T2 | — | Single-store convergence (PI-08) | None |
| SF-05 | Per-send approval and content-hash contract (GD-1) | Implemented | Orchestration track | after GD-1 | 0 | n/a | T2 | GD-1 decision before merge | Implement on integration base after GD-1 | GD-1 |
| SF-06 | Workflow / task / execution / correlation identifier contract | Implemented | Orchestration track | 2026-11-02..2026-11-12 | 0 | on window | T2 | — | Correlation joins (AIO-04) | None |
| SF-07 | Outreach outcome and lifecycle-transition identifier contract (GD-2) | Implemented | Feedback track | after GD-2 | 0 | n/a | T2 | GD-2 decision before merge | Outcome key + subject_id resolution | GD-2 |
| SF-08 | Credit reservation / confirm / release / reconciliation contract | Implemented | Billing track | 2026-11-02..2026-11-12 | 0 | on window | T2 | K-8 decision (charge per send) | Adapter-level hold/confirm/release | K-8 |
| SF-09 | Domain-event and integration-handoff contract | Implemented | Orchestration track | 2026-11-02..2026-11-12 | 0 | on window | T2 | — | Handoff row contract tests | None |
| SF-10 | Migration ownership, ordering and compatibility contract (GD-4) | Implemented | Release controls | 2026-11-02..2026-11-07 | 0 | on window | T1 | GD-4 decision | Land REL-02 | GD-4 |
| SF-11 | Security, audit and tenant-isolation contract | Implemented | Platform | 2026-11-02..2026-11-10 | 0 | on window | T2 | — | Route-auth in predeploy; governance-record trigger | None |
| **PI** | **Track 1 - Prospect Intelligence** | | | | | | | | | |
| PI-01 | CSV/manual ingestion into canonical records | Implemented | unassigned | 2026-11-04..2026-11-11 | pre | on window | T2 | Flags off in prod; T2 not re-run this programme | Run PI real-schema ingestion suites at main; record | None (flags: founder) |
| PI-02 | Canonical identity and deduplication | Implemented | unassigned | 2026-11-04..2026-11-11 | pre | on window | T2 | — | T2 of identity suites | None |
| PI-03 | Enrichment and evidence provenance | Implemented | unassigned | 2026-11-09..2026-11-20 | pre | on window | T2 | No vendor credential (J-3) | Provenance T2; vendor trial after J-3 | J-3 for vendor |
| PI-04 | Qualification and ICP ratification | Implemented | unassigned | 2026-11-09..2026-11-15 | pre | on window | T2 | qualificationIntelligence has no caller | Decide caller or retire | None |
| PI-05 | Persisted score evaluations (one canonical scorer) | Implemented | unassigned | 2026-11-09..2026-11-20 | pre | on window | T2 | 13 competing scorers | AS-2 T2; retire rival writers | None |
| PI-06 | Lifecycle transitions from outcomes via handoff.subject_id | Not Started | unassigned | after REL-07 | — | n/a | T2 | Integration branch not landed | Prepare on integration base | GD-2 |
| PI-07 | Consent / lawful-basis ledger | Blocked | unassigned | after counsel K-1 | — | n/a | T2 | Counsel K-1 | Schema draft | Founder + counsel |
| PI-08 | Single suppression store (contact_governance_records) | Not Started | unassigned | 2026-11-03..2026-11-12 | — | on window | T2 | — | WS-3 gate reads canonical; stop outreach_suppressions reads; retire suppression_entries dual-write plan | Push/merge |
| PI-09 | Prospect-keyed port for downstream consumers (PiProspectPort v1) | Not Started | unassigned | after REL-07 | — | n/a | T2 | Integration branch not landed | Define port; migrate orchestration reads | None |
| PI-10 | Ranked prospect list 6a6c3d9b | Blocked | unassigned | after REL-07 | — | n/a | T2 | Lands after integration branch | Cherry-pick after merge | Push/merge |
| **AIO** | **Track 2 - AI Intelligence and Orchestration** | | | | | | | | | |
| AIO-01 | Orchestration line (contract 0.2.0) on main | Implemented | Founder (merge) | after REL-07 | pre | n/a | T2 | REL-07 | Merge after T2 | Merge |
| AIO-02 | Enrollment records score_evaluation_id + icp_version (AS-3) | Not Started | unassigned | after AIO-01 | — | n/a | T2 | AIO-01 | Implement on integration base | None |
| AIO-03 | GD-1 per-send approval enforcement (content hash, atomic audit, role split) | Blocked | unassigned | after GD-1 + AIO-01 | — | n/a | T2 | GD-1 decision | Implement after decision | GD-1 |
| AIO-04 | Correlation joins persisted across handoffs | Not Started | unassigned | after AIO-01 | — | n/a | T2 | AIO-01 | Design migration in post-renumber block | Migration apply |
| AIO-05 | Agent runtimes stop self-approving (truthful gates) | Not Started | unassigned | 2026-11-09..2026-11-15 | — | on window | T2 | Product behaviour decision (which gates need a human) | Inventory the 3 runtimes' gates | Founder (behaviour) |
| AIO-06 | Retry, timeout, idempotency and recovery proven | Implemented | unassigned | with REL-07 T2 | pre | n/a | T2 | AIO-01 | Covered by fresh T2 | None |
| AIO-07 | Recommendation planner keyed on canonical prospects | Deferred | unassigned | Stage 8 | — | n/a | T2 | Slice uses the authored workflow step instead | None | None |
| **OUT** | **Track 3 - Outreach Engines** | | | | | | | | | |
| OUT-01 | Channel-neutral contract and EngineAdapter | Implemented | unassigned | with AIO-01 | pre | n/a | T2 | AIO-01 | Lands with integration branch | Merge |
| OUT-02 | Email engine through the adapter (real provider) | Implemented | unassigned | after AIO-01 | pre | n/a | T3 | Provider declared mocked; SES config unknown | SES config (founder) + tags | Founder (SES) |
| OUT-03 | Mandatory egress governance (GD-3) | Not Started | unassigned | 2026-11-03..2026-11-12 | — | on window | T2 | GD-3 before merge (local build can start) | Gate inside send-transactional-email + WS-3 transport | GD-3 |
| OUT-04 | Per-send credit metering | Blocked | unassigned | after K-8 | — | n/a | T2 | K-8 decision | Adapter-level hold/confirm/release | K-8 |
| OUT-05 | Delivery evidence with SES tags | Not Started | unassigned | after AIO-01 | — | n/a | T2 | AIO-01 | Tags tenant/task/correlation | None |
| OUT-06 | Inbound reply ingestion | Not Started | unassigned | after OUT-05 | — | n/a | T2 | SES inbound not configured | In-Reply-To matching | Founder (SES inbound) |
| OUT-07 | Engagement-history mirror for email | Not Started | unassigned | after OUT-05 | — | n/a | T2 | — | Mirror keyed by provider message id | None |
| OUT-08 | Channel-agnostic outcome key | Not Started | unassigned | after AIO-01 | — | n/a | T2 | AIO-01 | Outcome keyed by engine request/handoff | Migration apply |
| OUT-09 | DM / extension / browser contact contained on main | Not Started | unassigned | 2026-11-03..2026-11-06 | — | on window | T2 | J-5 scope decision (contain vs retire) | mayContact before claim on main paths (or wait for integration fixes 30a421c2/1c328464) | J-5 |
| OUT-10 | WhatsApp, SMS and voice foundations | Deferred | unassigned | Stage 8 | — | n/a | T3 | Consent (K-1), metering (K-8), J-9 | None | Per-channel activation decision |
| **VS** | **Integrated vertical slice (AS-1..AS-9)** | | | | | | | | | |
| VS-01 | AS-1..AS-9 pass at T2 with full ID chain | Not Started | unassigned | Stage 6 | — | n/a | T2 | Upstream milestones | Write acceptance suite skeleton once AIO-01 lands | None |
| VS-02 | AS-1..AS-6 at T3 on tenant 0eda0896 (real SES MessageId) | Not Started | Founder (operator) | Stage 7 | — | n/a | T3 | VS-01; counsel K-1; erasure live | None yet | Founder (real send) |

### Effort (estimates are inferred ranges, not recorded time)

| Scope | Agent hours (estimate) | Founder hours (estimate) | Confidence | Basis |
| --- | --- | --- | --- | --- |
| FND (containment, baseline, release) | 18-30 | 10-16 | medium | Prepared runbooks; rotation phases dominate founder time |
| SF contracts (tests + enforcement) | 16-28 | 2-4 | low-medium | Docs done; tests depend on integration landing |
| PI track | 30-55 | 2-4 | low | Most code exists; single store + consent + port are new; consent blocked on counsel |
| AIO track | 35-60 | 3-6 | low | Renumber + T2 + GD-1 + correlation; blocked on GD-4 and P1/P3 |
| OUT track | 45-80 | 6-10 | low | Egress gate, metering, SES tags, reply ingestion, mirror; SES configuration is founder work |
| VS slice (T2 suite + T3 run) | 15-25 | 3-5 | low | After upstream milestones |

### Effort log

Recorded: 0.0 h in 0 entries (start/end captured). Inferred: 2.4 h in 4 entries (no timer; not evidence of time worked). Agent wall-clock is not human working time. Source: docs/programme/effort-log.csv.

<!-- GENERATED:END -->
