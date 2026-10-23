# PI-MILESTONE-A-EXECUTION-001

**The single execution ledger for Milestone A.** Updated in place every session. Never overwritten, never re-baselined without recording the original.

Controlling audit: `PI-MILESTONE-A-CLOSURE-AUDIT-001.md` · SHA-256 `582e63b7e65540cf4b52a7ab734e8b8bc8cb964126abfc91643b0f4bb49577d6` (read-only; not edited by this programme).

---

## 1. Clock start — FROZEN

| | |
|---|---|
| **Actual start** | **2026-10-17T06:05:34+05:30 (IST)** — read from the system clock at execution start, not backdated |
| Repository | `C:/tmp/r1-ctx` |
| Branch | `fix/r1-profile-context` |
| HEAD at start | `29fea38a2d1642c1c2fd957e5151f6be81415774` — **matches the expected HEAD** |
| Worktree at start | **116 entries (63 M / 53 ??), 0 staged** — all preserved |
| Execution owner | One engineering agent (this session), acting as sole mutation owner for every work package below |
| **Capacity model** | **One owner, sequential.** Calendar duration therefore equals focused effort in working days; it is **not** compressed by notional parallelism. Where two work packages have disjoint file ownership this is noted, but a single owner cannot run them concurrently, and claiming otherwise would be a false commitment. External waiting time is tracked separately and never counted as effort. |
| Working week | Mon–Fri, plus Sat 2026-10-17 (the session already underway). Day 1 = Sat 2026-10-17. |
| Tooling constraint | `npm run typecheck` consumes ~8 GB and must run alone; the real-schema suite needs a disposable Docker container. Both are serialising constraints on a single owner. |

### 1.1 Authorization deltas recorded at start

`PI-MA-EXEC-001` §3 and §4 changed two statuses that the controlling audit carried as blockers. Recorded here because they are the reason implementation may now begin:

| Audit blocker | New status | Authority |
|---|---|---|
| **B2** — unsigned source-arbitration warrant blocks atomicity | **NOT A BLOCKER for atomicity-only.** §4: *"do not treat a previously chosen atomicity-only scope as requiring source-arbitration ratification."* Arbitration stays unresolved and byte-frozen. | §3, §4 |
| **B6 / D-3C-5** — atomicity implementation unauthorized | **AUTHORIZED.** §3: *"This prompt authorizes implementation of the Milestone A work described here, including the person/account atomicity-only remediation and local tests."* | §3 |
| **B1** — production migration state `UNVERIFIED` | **Does not block local implementation.** New additive migration validated against disposable local PostgreSQL only; never applied to production. | §3, §4 |

Still **not** authorized, and not attempted: ratifying the arbitration warrant · historical repair · relationship-path atomicity · production database access or migration application · deployment · provider calls without confirmed credentials.

---

## 2. Phase 0 reconciliation — COMPLETE (Day 1)

Verified only what execution requires. All hashes below were recomputed this session and are unchanged from the controlling audit, so prior evidence is reliable and was not re-derived.

`ingestionBoundary.ts` `cc27942da2f61a60` · `relationshipAttributeIngestion.ts` `47cbdffbf758d990` · `attributes.ts` `9fc6630f8e654587` · `evaluate.ts` `50b8b039d627fe2f` · `20261119000000` `e8b9d614449121f9` · `20261122000000` `8b1b2765ce4e1f1c` · `20261124000000` `10f934f1e9eadad6`

### 2.1 Facts confirmed for execution

- **The defect, in code.** `ingestSourceRecord` (`ingestionBoundary.ts:930-1039`) commits the canonical `UPDATE` at `:1026-1030`, then calls `recordCanonicalProvenance` at `:1037`, which separately inserts the decision row and stamps the assertion. Three committed writes, no transaction, no `catch`. A failure after the canonical update leaves a canonical value with no decision record.
- **Retry cannot repair it.** `:690` skips an attribute whose canonical value already matches (`canonicalMatches → continue`), so on retry `decision.apply` is empty and `:1024` returns before provenance. The gap is permanent, not transient. This is the whole reason atomicity is the fix rather than a retry.
- **The precedent is real and close.** `pi_relationship_set_primary` (`20261122000000`) is plpgsql, takes the tenant as its first parameter, uses `FOR UPDATE`, writes three tables in one transaction, `RAISE EXCEPTION`s on a missing target, and is **not** `SECURITY DEFINER` — so it runs with the caller's rights and RLS still applies. The new function follows it exactly.
- **An RPC seam exists and is conventional.** `supabase.rpc(...)` has ~20 production callers (credits, scheduler, vault, billing). `ownedDbTable` is a thin wrapper over `supabase.from` in `backend/db/writeOwner.ts` (9 lines).
- **The decision log constrains the design.** `canonical_attribute_decisions` is append-only by trigger (`canonical_decisions_append_only`), its `reason` CHECK is the closed set of four apply reasons, and `20261124000000` widened `entity_type` and added `relationship_id` to the *same* table. The new function may therefore only ever `INSERT` there.
- **The allowlist is a 15/19-entry TypeScript constant.** `PERSON_ATTRIBUTE_COLUMNS` (15) and `ACCOUNT_ATTRIBUTE_COLUMNS` (19) in `attributes.ts:362-381`. The SQL function will carry its own copy and a test will assert set equality — the WS-3H generated-list/equality-test approach, adopted (see §5, UQ-1).
- **Blast radius measured.** 23 test files reference the canonical path; **14** assert `canonicalApplied` with real content, and 3 of those are real-schema suites (`b1b_arbitration`, `rel_attribute_producer`, `dl_relationship_decisions`) whose adapters already map `ownedDbTable` onto live `pg`. Each double needs one added key, not a new mock. This is the single largest cost line in WP-2 and is estimated explicitly rather than discovered later.

### 2.2 Phase 3 source contracts — inspected, and two audit statuses corrected

§7 forbids assuming the missing sources can be solved by adding `ingestLeadBatch` calls. Inspecting the actual contracts shows that is correct, and that the three sources are **not** in the same position:

| Source | Subject in the data? | Tenant-safe? | Verdict |
|---|---|---|---|
| **Active Leads** | **YES** — `active_leads.contact_id uuid NOT NULL REFERENCES contacts(id)`, plus `company_name`, `source_platforms[]`, `intent_score`, `icp_score` | **YES** — `active_leads.organization_id NOT NULL`, and `contacts.organization_id NOT NULL` with `UNIQUE (organization_id, platform, platform_user_id)` | **IMPLEMENTABLE — WP-7** |
| **MarketPulse** | **NO** | n/a | **BLOCKED — no subject exists** |
| **Social engagement** | YES (`engagement_identity_candidates.unified_person_id`) | **NO** | **BLOCKED — no tenant column** |

**Correction 1 — Active Leads is implementable.** The controlling audit recorded Active Leads as `MISSING` with no PI connection, which remains true, but did not establish that the data carries a usable, tenant-scoped subject. It does: every `active_leads` row names a `contacts` row in the same tenant. This is a genuine new source path, estimated as WP-7, and it is the one addition this programme makes to the audit's implementable set.

**Correction 2 — MarketPulse has no subject at all, which is stronger than the audit's "read-only consumption".** §7 says not to turn company-level intelligence into person-level assertions. The deeper fact, verified from source rather than from the module's own header: the **only** writer of `market_pulse_findings.entities` is `marketPulseV2ServiceEngine.ts:492`, and it writes the literal `entities: []`. Every `market_pulse_*` table is keyed by `company_id` = **the tenant**, not an external company. MarketPulse therefore names no external company anywhere, so there is no account or person to ingest. Making it a prospect source would require either a MarketPulse-side change to populate `entities` (outside PI's scope and outside this authorization) or fabricating a subject (forbidden). **Owner decision required — see §6, OD-1.**

**Social engagement is blocked on tenancy, not on effort.** `engagement_identity_candidates` has `UNIQUE(platform, external_id)` **globally** and **no tenant column at all** — stated deliberately in `20260924000000_w5_person_spine_tenant_integrity.sql:29`, and confirmed by `personSpineTenantIntegrityW5.test.ts`, which asserts the table is *not* tenant-constrained. It also has **zero application writers**: the only reference in the codebase is that test. Ingesting from it would attribute a social identity to a tenant that the data cannot support, and would collide across tenants on the global unique key. Fixing it means altering a legacy non-PI table plus a historical backfill — and backfill is explicitly deferred by the owner. **Owner decision required — see §6, OD-2.**

---

## 3. FROZEN INITIAL BASELINE — do not overwrite

Established Day 1, 2026-10-17. Any later change is recorded in §7 as a variance against these numbers, preserving them.

| WP | Work package | Effort (d) | Start | **Baseline finish** | Depends on | Confidence |
|---|---|---|---|---|---|---|
| **WP-1** | Phase 0 reconciliation | 0.5 | Sat 2026-10-17 | **Sat 2026-10-17** | — | DONE |
| **WP-2** | Person/account canonical write atomicity | 5.0 | Sat 2026-10-17 | **Fri 2026-10-23** | WP-1 | MEDIUM-HIGH |
| **WP-3** | Authenticated-role tenant-isolation harness | 4.0 | Mon 2026-10-26 | **Thu 2026-10-29** | — (disjoint files) | MEDIUM |
| **WP-4** | List permissions, archive semantics, `added_via` | 2.0 | Fri 2026-10-30 | **Mon 2026-11-02** | OD-3, OD-4 | HIGH |
| **WP-5** | Person-erasure membership + history retention | 3.5 | Tue 2026-11-03 | **Fri 2026-11-06** | OD-5 | MEDIUM |
| **WP-6** | Manual/CSV/CRM → real-schema + E2E promotion | 3.0 | Mon 2026-11-09 | **Wed 2026-11-11** | WP-2 | HIGH |
| **WP-7** | **Active Leads → PI canonical intake (new)** | 4.0 | Thu 2026-11-12 | **Tue 2026-11-17** | WP-2, WP-6 | MEDIUM |
| **WP-12** | One integrated acceptance run | 5.0 | Wed 2026-11-18 | **Tue 2026-11-24** | WP-2…WP-7 | MEDIUM |
| **WP-13** | Final closure report | 1.5 | Wed 2026-11-25 | **Wed 2026-11-25** | WP-12 | HIGH |

**Focused effort: 28.5 engineer-days. Calendar: 29 working days. Critical path: WP-1 → WP-2 → WP-6 → WP-7 → WP-12 → WP-13.**

### 3.1 FROZEN TARGET DATES

| | |
|---|---|
| **Milestone A′ (implementable scope) — BASELINE TARGET** | **Wed 2026-11-25** |
| **Milestone A (full agreed scope, incl. MarketPulse, social, Sales Navigator, live Apollo)** | **NO DEFENSIBLE DATE.** Four work packages are blocked on owner decisions or external access, not on effort. A date would be fiction. |

Assumptions behind 2026-11-25, stated as required: one sequential owner; OD-3/OD-4/OD-5 answered before WP-4 starts (Fri 2026-10-30); OD-5 resolved as B-1 or B-2 (option A removes 3.5 d); no new defect found in WP-12 that costs more than 1 day; the disposable Docker harness stays available.

### 3.2 Blocked work packages — zero engineering effort, no date

| WP | Work package | Status | Missing prerequisite | Decision |
|---|---|---|---|---|
| **WP-8** | MarketPulse intake | **BLOCKED — NO SUBJECT** | `market_pulse_findings.entities` is always `[]`; no external company exists in any `market_pulse_*` table | **OD-1** |
| **WP-9** | Social engagement intake | **BLOCKED — NO TENANT COLUMN** | `engagement_identity_candidates` has no tenant column and a global unique key; zero live writers | **OD-2** |
| **WP-10** | Sales Navigator intake | **BLOCKED_BY_EXTERNAL_DEPENDENCY** | No permitted integration exists; SNAP is partner-only. Scraping and undocumented APIs are forbidden and not attempted | **OD-6** |
| **WP-11** | Operational Apollo enrichment | **BLOCKED_BY_EXTERNAL_DEPENDENCY** | **No Apollo credential exists in any environment file.** Adapter supports exactly one attribute (`employee_count`) | **OD-7** |
| **OD-8** | **PI surfaces have no tenant-predicate RLS.** Nine of ten carry only `auth.role() = 'service_role'`, and `service_role` holds BYPASSRLS, so RLS provides no tenant separation on the path the application uses; separation rests on application code plus composite tenant-safe FKs. Proven in WP-3 (§10.4, §10.5). | defence in depth for all PI data | **(a)** accept the current model, documented. **(b)** add tenant-predicate policies to the PI surfaces as a backstop behind the application. No remediation was made |

---

## 4. Progress — baseline vs actual vs forecast

| WP | Baseline finish | Effort consumed | Elapsed | Forecast finish | Variance | Status |
|---|---|---|---|---|---|---|
| WP-1 | Sat 2026-10-17 | 0.5 d | 0.5 d | Sat 2026-10-17 | **0** | **COMPLETE** |
| WP-2 | Fri 2026-10-23 | ~1.0 d | 1 session | **Mon 2026-10-19** | **−4 d (ahead)** | **COMPLETE - all 10 acceptance criteria met, all gates green** |
| WP-3…WP-7, WP-12, WP-13 | per §3 | 0 | 0 | per §3 | 0 | NOT STARTED |
| WP-8…WP-11 | n/a | 0 | 0 | n/a | n/a | **BLOCKED** |

### 4.0 WP-2 variance — FAVOURABLE, after a corrected measurement

The baseline put WP-2 at 5 days, and its largest line was the test-double sweep: 23 files reference the canonical path, so the baseline assumed many would need their double extended for the new RPC seam.

**I first reported "only 1 of 16 suites broke". That figure was wrong.** It came from a `grep | head -40` whose output was truncated by the failure block, so suites below the cut were never seen. It was also measured the wrong way: I grepped for *direct* references to `ingestSourceRecord`, which misses every suite that reaches the boundary *indirectly* through `ingestLeadBatch`.

Measured properly, by running the whole affected domain:

| Suite | Cause | Resolution |
|---|---|---|
| `piSubjectCorrectArbitration` | **my change** | RPC emulated against its fake store — 16/16 |
| `piO5SubjectOnlyAssertionWrites` | **my change** | RPC emulated — PASS |
| `li4eManualAdapter` | **my change** (indirect, via `ingestLeadBatch`) | RPC emulated — PASS |
| `piList002IntakeToListE2E` | **my change** (indirect) | RPC emulated — PASS. The only intake-to-list chain test in the repository, so it mattered most |
| `prospectIdentityIngestionBoundary` | **PRE-EXISTING red** | §4.0.4 — fixed |
| `leadDeadLetterProducer` | **PRE-EXISTING red**, unrelated | §4.0.5 |
| `prospectListPage.dom` | **PRE-EXISTING red**, unrelated | §4.0.5 |

Four suites, not one. The variance is still favourable — four bespoke doubles is well under the budgeted sweep — but it is four, and the earlier number is corrected here rather than quietly replaced.

The §3 baseline is **not** rewritten. Forecast finish moves to **Mon 2026-10-19** against a baseline of Fri 2026-10-23: **4 days ahead**.

### 4.0.1 WP-2 evidence

| Artefact | SHA-256 (abbrev.) | State |
|---|---|---|
| `supabase/migrations/20261128000000_pi_canonical_write_atomicity.sql` | `3ce166ae2cb894d5` | NEW. `pi_apply_canonical_decisions` + `pi_canonical_attribute_allowlist`. Applied to a **disposable local container only**, and replayed twice so it is idempotent. **Never applied to production.** |
| `backend/db/writeOwner.ts` | `5e893b1c5cc8b37d` | `ownedDbRpc` added beside `ownedDbTable`; purely additive |
| `backend/services/prospectIdentity/ingestionBoundary.ts` | `9274892330362f5c` | Three committed writes become one call. `recordCanonicalProvenance` **deleted** |
| `backend/tests/realschema/ca_canonical_write_atomicity.test.ts` | NEW | **21/21 against real PostgreSQL 17** |
| `backend/tests/unit/caCanonicalSoleWriter.test.ts` | NEW | **12/12** — sole-writer scan with negative controls |

### 4.0.2 Gate results — read from jest, never from an exit code

| Gate | Result |
|---|---|
| `npm run typecheck` | **3/3 projects clean**, `TYPECHECK_EXIT=0`. Run against the final non-test sources; every later edit was test-only, and all three tsconfigs exclude `backend/tests` and `**/*.test.ts` |
| Full real-schema suite | **35/35 suites · 782/782 tests** (baseline 34/34 · 761/761; the new suite adds one suite and 21 tests). **Zero failures** |
| Scoped PI unit regression, 243 suites | **240 passed · 2 failed · 1 skipped**; 4918 passed / 11 failed. Both failures proven pre-existing and unrelated |
| **New failures caused by this work** | **ZERO** |
| Control-byte scan (`grep -laP`) | **Clean** on every file touched |

**Acceptance criteria 1–8 met.** Criterion 9 verified by hash: `relationshipAttributeIngestion.ts` `47cbdffbf758d990`, `attributes.ts` `9fc6630f8e654587`, `evaluate.ts` `50b8b039d627fe2f`, `criteria.ts` `c5752aca75938fc1` — all byte-identical to the Phase 0 baseline. The arbitration region of `ingestionBoundary.ts` was not edited: the three changes were exact-match anchored replacements, each asserted unique, none inside that region, which now hashes `88836693ce1d8870ad340945` as a forward baseline. Criterion 10 is the table above.

### 4.0.3 Defects I introduced and fixed, disclosed

| Defect | Detection | Fix |
|---|---|---|
| Two bad fixtures in the new real-schema suite | Real PostgreSQL refused both (`source_assertions_person_tenant_fk`, `unified_persons_attributes_provenance_coherent`) | Corrected. The first is a genuine extra finding: the composite FK makes a cross-tenant assertion **unconstructible**, so the function's refusal is a second line of defence and the schema is the first |
| The new sole-writer detector flagged `accountIntelligence.ts`, which only READS the column | Its own test 4 failed | One regex could not separate a type declaration from an assignment, because the whitespace class matches zero characters and the lookahead slips past the space. Replaced with a line-oriented check; **test 10b pins both directions** |
| An escaped-backslash slip in a patch script put a literal backspace byte into a test file, and later into this ledger | `grep -laP` control-byte scan | Both stripped; rescanned clean |
| Reported "1 of 16" suites broken, from truncated grep output | The full-domain run contradicted it | Corrected in §4.0 above |

### 4.0.4 CORRECTION to the controlling audit — blocker B9 was WRONG

The closure audit recorded, as blocker **B9**, that *"no test enforces the sole-writer property despite the module header claiming it"*.

**That finding is incorrect. The test exists**, and always has: `backend/tests/unit/prospectIdentityIngestionBoundary.test.ts`, describe block *"LI-2 — provider code cannot bypass the boundary"*, whose test *"no file outside the boundary writes an LI-1 attribute column to the spine"* walks `backend/` and refuses any file naming an LI-1 attribute column beside a spine table. It also holds every exempted file to a **stricter** check: that the file can reach no database at all.

What is true is narrower, and the audit missed it: **that test was RED on the baseline**, failing on one offender — `backend/services/prospectDiscovery/icpTranslation.ts -> job_title` — which is unrelated to this work. `icpTranslation.ts` hashes `b1edafbf99a5fa3d`, exactly as recorded in Phase 0, so it was not touched this session.

Resolved the way the test's own design prescribes, not by weakening it: `icpTranslation.ts` is flagged for precisely the "unlucky reason" the test already documents for `criteria.ts`. It names the spine tables **only in a prose comment** about where ICP attributes live, and its `person.job_title` entry is a **mapping key in a lookup table**, not an update payload. It contains **zero** database verbs and imports only `prospectIcp/types`, so it was added to the name-only exemption **and** to the stricter no-database list, where it now passes. The suite is **29/29**.

The new `caCanonicalSoleWriter.test.ts` is kept as well. It is complementary, not duplicative: it enforces that the *atomic function* has exactly one caller and that the *decision log* has exactly one remaining TypeScript writer, neither of which the older scan asks, and it carries the negative controls §5 requires.

### 4.0.5 Two pre-existing failures left untouched — reported, not fixed

Both are outside this programme's scope and neither is a PI canonical-write defect. Fixing either would be unrelated work.

| Suite | Offender | Why untouched |
|---|---|---|
| `leadDeadLetterProducer` | `services/boltExecutionRecovery.ts` lacks `deadLetterOnExhaustion(` | BOLT worker recovery, not PI |
| `prospectListPage.dom` | `pages/prospects/index.tsx:108` — `evaluationLabel` reads `.state` of `undefined` | A prospects **UI** defect. Worth noting it sits on the prospect list page this programme depends on, so WP-12 must account for it |

### 4.1 Alerts — raised, standing, never silently extended

| Date | Alert | Detail |
|---|---|---|
| 2026-10-17 | **`BLOCKED_BY_EXTERNAL_DEPENDENCY` — WP-11 Apollo** | Raised immediately as §8 requires. Exact missing prerequisite: **an Apollo API credential provisioned through the approved configuration path**. No provider call was made and none will be until credentials and authorized account access are confirmed. Even once provisioned the adapter maps **one** attribute (`employee_count`), so mandatory enrichment coverage stays narrower than the agreed scope. Milestone A is **not** claimed closed while this is unmet. |
| 2026-10-17 | **`BLOCKED_BY_EXTERNAL_DEPENDENCY` — WP-10 Sales Navigator** | No permitted integration exists to use. Scraping, undocumented endpoints and credential workarounds are forbidden and were not attempted. |
| 2026-10-17 | **`SCOPE BLOCKER` — WP-8 MarketPulse** | No subject exists in the data: the sole writer of `market_pulse_findings.entities` is `marketPulseV2ServiceEngine.ts:492`, writing the literal `[]`, and every `market_pulse_*` table keys on `company_id` = the tenant. Not an effort problem. Owner decision **OD-1**. |
| 2026-10-17 | **`SCOPE BLOCKER` — WP-9 social engagement** | `engagement_identity_candidates` has no tenant column and a global `UNIQUE(platform, external_id)`, stated deliberately in `20260924000000_w5_person_spine_tenant_integrity.sql:29`, and has zero application writers. Owner decision **OD-2**. |
| 2026-10-17 | **`NO DEFENSIBLE DATE` — full Milestone A** | Four of the agreed sources/providers are blocked on decisions or external access. Only Milestone A′ carries the 2026-11-25 commitment. The reduced scope is **not** substituted for the agreed scope: both are reported. |
| 2026-10-17 | **No overrun.** WP-1 on baseline; WP-2 forecast 4 days ahead | No deadline was extended, reset or re-estimated. The §3 baseline stands unedited and the favourable variance is recorded in §4.0. |

---

## 5. WP-2 — design, as being implemented

**Approach:** move the three writes into one plpgsql function, `pi_apply_canonical_decisions`, called once per ingestion through a new `ownedDbRpc` seam in `backend/db/writeOwner.ts`. A plpgsql function invoked as a single statement is one transaction, so a failure in the decision insert or the assertion stamp rolls back the canonical update.

Properties, each mapped to §5 of the brief:

| Required property | How |
|---|---|
| Canonical update + decision log atomic | One plpgsql function, one statement, one transaction |
| Assertion stamps in the same transaction | Stamped inside the same function body |
| Later failure rolls back the canonical update | Guaranteed by the single statement; proven by a forced-failure real-schema test |
| Assertion validated on tenant, attribute and normalized value — **without re-running winner selection** | The function re-reads the named assertion and checks `organization_id`, subject leg, `attribute` and `normalized_value`. It performs no ordering, no recency comparison and no confidence comparison — it cannot pick a winner, only verify the one it was given |
| Superseded assertions keep existing attestation semantics | The stamp still writes only where `applied_to_canonical_at IS NULL`; `superseded_at` is read, never written, by this function |
| **Attribute surface cannot be widened by a caller** | The allowlist is a literal in the SQL function, per entity type. A caller passing any other column name is refused by `RAISE EXCEPTION` before any write. Dynamic SQL uses `%I` quoting over allowlisted names only |
| Sole-writer enforcement tested, with negative controls | Addressed as a dedicated deliverable inside WP-2 — the controlling audit found **no** existing test enforcing it despite the module header claiming it (audit blocker B9) |
| Missing/incorrect target fails closed inside the function | `RAISE EXCEPTION` when the tenant-scoped canonical row is absent. Reachable only if the row vanished between the TypeScript read and the write — a real race that must fail loudly rather than silently skip |
| Relationship ingestion path unchanged | `relationshipAttributeIngestion.ts` is not touched; its hash is re-asserted at WP-2 close |
| Arbitration byte-frozen | `decideCanonicalUpdates` and all winner-selection helpers unchanged; proven by hash at WP-2 close |

**UQ-1 (allowlist) — RESOLVED, no owner decision needed.** Adopting the WS-3H generated-list/equality-test approach: the SQL function carries the allowlist as a literal array per entity type, and a test asserts set equality between the SQL literals and `PERSON_ATTRIBUTE_COLUMNS` / `ACCOUNT_ATTRIBUTE_COLUMNS`. Drift becomes a failing test rather than a silent widening. Recorded here so the design discussion is closed rather than left open.

**WP-2 acceptance criteria:**
1. A forced decision-insert failure leaves the canonical column **unchanged** (real PostgreSQL).
2. A forced stamp failure likewise rolls back the canonical update.
3. Decision row and canonical value commit together or not at all.
4. A caller passing a non-allowlisted attribute is refused with no write.
5. A cross-tenant assertion id, subject or canonical row is refused.
6. An assertion whose `normalized_value` does not match the supplied value is refused.
7. The SQL allowlist equals the TypeScript allowlist, per entity type.
8. Sole-writer enforcement test passes **and** fails when deliberately violated (negative control).
9. `decideCanonicalUpdates` and `relationshipAttributeIngestion.ts` unchanged by hash.
10. Full real-schema suite and `npm run typecheck` (3/3) pass; no new unit-test failures.

---

## 6. Owner / operator decisions required

None is taken on the owner's behalf. Independent work continues regardless, per §8 and §13.

| ID | Decision | Blocks | Narrow choice |
|---|---|---|---|
| **OD-1** | **MarketPulse intake.** No external-company subject exists in `market_pulse_*`. | WP-8 | **(a)** Record a scope exception: MarketPulse stays read-only market context, not a prospect source. **(b)** Authorize a separate MarketPulse-side programme to populate `findings.entities` — outside PI scope, no date. |
| **OD-2** | **Social engagement intake.** `engagement_identity_candidates` has no tenant column, a global unique key and no live writer. | WP-9 | **(a)** Record a scope exception. **(b)** Authorize a legacy-schema change adding tenancy, accepting that attributing existing rows is a historical backfill the owner has deferred. |
| **OD-3** | List permissions, archive/un-archive, super-admin bypass (`PL-DEC-001`) | WP-4 | Open from WS-2F |
| **OD-4** | `added_via` contract (`PL-DEC-002`) | WP-4 | Open from WS-2F |
| **OD-5** | Erasure residue (`PL-DEC-003`): **A** accept · **B-1** hard delete · **B-2** soft remove. **Audit-retention policy is not decided here** — options B-1/B-2 differ in what history survives, which is a product policy call. | WP-5 | A removes 3.5 d from the baseline |
| **OD-6** | Record the Sales Navigator scope exception | WP-10 | No permitted integration exists |
| **OD-7** | **Apollo enrichment.** No credential exists anywhere; adapter covers one attribute. | WP-11 | **(a)** Provision a credential via the approved path, accepting `employee_count`-only coverage. **(b)** Approve a different enrichment provider. **(c)** Record a scope exception. Until one is chosen, mandatory enrichment is unmet and Milestone A cannot close |

---

## 7. Variance log

The §3 baseline is never edited. Every revision is appended here with the original preserved.

| # | Date | WP | Baseline | Revised forecast | Variance | Reason |
|---|---|---|---|---|---|---|
| V-1 | 2026-10-17 | WP-2 | Fri 2026-10-23 | **Mon 2026-10-19** | **−4 d (favourable)** | The baseline's largest line was a test-double sweep across up to 14 suites. Measured by running the whole affected domain, four suites needed their double extended, not fourteen. No scope was dropped to achieve this and no deadline was extended. |
| V-2 | 2026-10-17 | WP-2 | — | — | **measurement corrected** | An earlier figure of "1 of 16 suites" was published in-session and was wrong — truncated grep output plus a direct-reference-only search that missed indirect callers. Corrected to four in §4.0. Recorded rather than overwritten. |
| V-3 | 2026-10-17 | WP-3 | Thu 2026-10-29 | **actual 2026-10-17T12:53:51** | **8 working days early (favourable)** | Completed in 52 min 41 s of active effort against a 4.0-day budget. No scope dropped, no criterion redefined, no deadline moved. |
| V-4 | 2026-10-17 | WP-2 | reported "forecast Mon 2026-10-19" | **actual 2026-10-17T07:00:12** | **5 working days early** | A forecast was reported where an actual existed. Corrected in §9.4; the original wording is preserved in §4. |
| V-5 | 2026-10-17 | sequence | WP-3 -> WP-4 -> WP-5 -> WP-6 | **WP-3 -> WP-6**, WP-4/WP-5 deferred | **resequenced, owner-APPROVED** | WP-4 and WP-5 are blocked on OD-3/OD-4/OD-5; WP-6 depends only on WP-2. Both remain required for Milestone A-prime. The frozen baseline and the Section 9.6 critical path are preserved. |
| V-6 | 2026-10-17 | WP-6 | Wed 2026-11-11 | **actual 2026-10-17T14:16:40** | **~17 working days early (favourable)** | 42 min 29 s of active effort against a 3.0-day budget. No scope dropped, no acceptance criterion redefined, no deadline moved. |

No unfavourable variance and no overrun. No deadline has been extended, reset or re-estimated.

## 8. Session log

| # | Date (IST) | Owner | Work | Evidence |
|---|---|---|---|---|
| 1 | 2026-10-17 06:05 → 08:4x | execution agent | Clock started and baseline verified (HEAD `29fea38a`, 116 entries). **WP-1 Phase 0 reconciliation complete**, with two corrections to the controlling audit (Active Leads implementable; MarketPulse has no subject). **Frozen baseline published.** Four blockers alerted. **WP-2 implemented and gated**: atomic function + additive migration, boundary rewired, `recordCanonicalProvenance` deleted, five test suites added or extended. Audit blocker **B9 corrected** — the sole-writer test exists, was red on the baseline, and is now green. | §2, §3, §4.0–§4.1; real-schema **35/35 · 782/782**; typecheck **3/3**; scoped unit **240/243 suites**, zero new failures |
| 2 | 2026-10-17 12:01:10 -> 12:53:51 | execution agent | Clock and schedule reconciled from measured timestamps (two published figures corrected, plus the critical path). **WP-3 COMPLETE**: authenticated-role tenant-isolation harness, 26 tests, two real sessions, negative controls that provably catch a broken policy. Two isolation models found and documented; trust-boundary gap raised as OD-8. | §9, §10; real-schema **36/36 suites, 808/808 tests**, typecheck **3/3**, all exit 0 |
| 3 | 2026-10-17 13:34:11 -> 14:16:40 | execution agent | Approved resequencing recorded. **WP-6 COMPLETE**: manual, CSV and CRM intake proven end to end against the real schema, 27 tests, including suppression, provenance, dedup, partial failure and cross-tenant postconditions. Two contract-comment inaccuracies found (code safe). OD-8 design note recorded, nothing implemented. | Section 11, Section 12; real-schema **37/37 suites, 835/835 tests**, typecheck **3/3**, PI unit **240/243** with zero new failures |

### 8.1 Repository state at session close

| | |
|---|---|
| Branch / HEAD | `fix/r1-profile-context` / `29fea38a2d1642c1c2fd957e5151f6be81415774` — **unchanged** |
| Worktree | **123 entries (66 M / 57 ??), 0 staged** — baseline was 116 (63 M / 53 ??) |
| Accounted for | **+3 modified, +4 untracked** against the Phase 0 baseline. Newly modified: `backend/db/writeOwner.ts` plus two test files that were not already dirty. Also edited, but already in the baseline modified set: `ingestionBoundary.ts`, `b1b_arbitration.test.ts`, `piSubjectCorrectArbitration.test.ts`, `piO5SubjectOnlyAssertionWrites.test.ts`, `li4eManualAdapter.test.ts`, `piList002IntakeToListE2E.test.ts`, `prospectIdentityIngestionBoundary.test.ts`. New untracked: the migration, `ca_canonical_write_atomicity.test.ts`, `caCanonicalSoleWriter.test.ts`, and this ledger. No other file in the worktree was touched. |
| Not done, deliberately | No commit, no push, no PR, no merge, no deployment. No production database access. No migration applied to any persistent database. No provider call. No existing work cleaned, reset, stashed or reverted. `C:/virality` neither inspected nor modified. |

---

## 9. Session 2 — WP-3. Clock reconciliation FIRST

Nothing in §1–§8 is edited. This section corrects two figures I published in
session 1 and records why they were wrong.

### 9.1 Measured timestamps

| Event | Timestamp (IST, +05:30) | Source |
|---|---|---|
| Session 1 start | **2026-10-17T06:05:34** | `date -Iseconds` at WP-1 start (§1) |
| WP-2 migration written | 2026-10-17T06:15:18 | file mtime |
| WP-2 real-schema suite written | 2026-10-17T06:22:02 | file mtime |
| WP-2 sole-writer test written | 2026-10-17T06:28:45 | file mtime |
| **WP-2 last code/test change** | **2026-10-17T06:53:53** | mtime, `prospectIdentityIngestionBoundary.test.ts` |
| **WP-2 COMPLETE — ledger closed** | **2026-10-17T07:00:12** | mtime, this ledger |
| Session 2 (WP-3) start | **2026-10-17T12:01:10** | `date -Iseconds` |

### 9.2 Elapsed wall-clock vs active engineering effort — reported separately

| Measure | Value |
|---|---|
| **Active engineering, session 1** | **54 min 38 s** (06:05:34 → 07:00:12) |
| **External wait** (idle, awaiting owner input) | **5 h 00 min 58 s** (07:00:12 → 12:01:10). **Not** engineering effort |
| Total wall-clock, session 1 start → session 2 start | **5 h 55 min 36 s** |
| Active engineering, sessions 1+2 to this checkpoint | 54 min 38 s + session 2 in progress |

### 9.3 CORRECTION — two figures in session 1 were wrong

**(a) "approximately 2 hours 45 minutes elapsed" was wrong, and was never measured.**
I inferred elapsed time from how much work had been done instead of reading the
clock at the checkpoint. The true active engineering window was **54 min 38 s**.
The owner's arithmetic was right to flag it: against a start of 06:05:34, a
report at ~11:51 implies ~5 h 46 m of wall-clock. Neither my figure nor that
inference describes the work: **55 minutes was engineering and ~4 h 51 m was
idle waiting.** My number matched neither because it was a guess.

**(b) "approximately 1.0 engineer-day consumed" was wrong.**
54 min 38 s is **~0.11 engineer-days** at 8 h/day — roughly one ninth of what I
reported. Also an unmeasured estimate.

**Cause:** no timestamp was taken at the checkpoint. **Fix, in force from now
on:** every checkpoint records a measured `date -Iseconds`, and elapsed
wall-clock, active effort and external wait are reported as three separate
numbers, never one blended figure.

### 9.4 CORRECTION — a forecast was reported where an actual existed

Session 1 reported WP-2 with "**forecast** finish Mon 2026-10-19, 4 days ahead".
That was wrong in two ways: WP-2 was **already complete** when I wrote it, so a
forecast had no place in the report, and the date was not the completion date.

| | |
|---|---|
| WP-2 baseline finish | **Fri 2026-10-23** (Day 6 of the frozen schedule) |
| WP-2 **ACTUAL** completion | **2026-10-17T07:00:12+05:30** (Day 1) |
| **Actual schedule variance** | **5 working days early** — finished on Day 1 against a baseline of Day 6 |
| Effort | **0.11 engineer-days actual** against a **5.0-day** budget |

The §3 frozen baseline is unchanged. §4's WP-2 row said "forecast Mon 2026-10-19"
and is superseded by the actual above; the original wording stays in place as
history.

### 9.5 WP-3 schedule position

| | |
|---|---|
| Original target | **Thu 2026-10-29** (Day 10), unchanged |
| Effort budget | **4.0 engineer-days**, unchanged |
| Effort consumed at this checkpoint | session 2 in progress, measured below |
| Dependencies | **None upstream.** File ownership is disjoint from WP-2 (`backend/tests/realschema` + fixtures) |
| Blocks | **WP-12**, whose acceptance criterion 3 is cross-tenant prevention |
| Calendar float to 2026-10-29 | WP-3 is starting on **Day 1** against a planned start of Day 7, so ~6 working days of calendar float |
| Resource float | **ZERO** — see §9.6 |

### 9.6 CORRECTION — critical path. WP-3 was wrongly omitted

Session 1 stated the critical path as
`WP-1 → WP-2 → WP-6 → WP-7 → WP-12 → WP-13`, which leaves WP-3 out. **That was
wrong**, for two independent reasons:

1. **Dependency.** WP-12's acceptance criterion 3 is that cross-tenant access is
   prevented. WP-3 is the only work package that establishes it, so there is a
   genuine edge **WP-3 → WP-12**.
2. **Resource.** §1 fixes the capacity model at **one sequential owner**. Nothing
   can overlap, so *every* work package sits on the resource-critical path and
   **no package has any float**. The session-1 statement described a dependency
   sub-chain and called it the critical path.

**Corrected critical path:**
`WP-1 → WP-2 → WP-3 → WP-4 → WP-5 → WP-6 → WP-7 → WP-12 → WP-13` — the whole
sequence, because a single sequential owner cannot parallelise it. WP-3 is the
**next required engineering gate**, which is consistent with session 1's closing
statement and inconsistent with the path it printed. The path is corrected here.

### 9.7 SCHEDULE HEALTH — not an overrun, but the baseline is now in question

**No OVERRUN RISK alert is warranted.** WP-3 has ~6 working days of calendar
float against 2026-10-29 and no upstream dependency, and the 2026-11-25
Milestone A′ baseline is not threatened.

The opposite risk is now the material one, and the owner should see it:

| | |
|---|---|
| WP-2 budget | 5.0 engineer-days |
| WP-2 actual | **0.11 engineer-days** (54 min 38 s) |
| Ratio | the budget over-predicted actual effort by roughly **45×** |

The §3 baseline was estimated in **human** engineer-days; execution is by an
agent, so the two units are not comparable, and the frozen 28.5-day / 2026-11-25
plan is very likely far too conservative. **I am not revising it** — §2.3 and
§2 of this brief reserve that to the owner. It is recorded here as a schedule
observation with one recommendation: once WP-3 closes, the owner may wish to
approve a revised baseline, at which point both the original and the revision
will be preserved in §7.

### 9.8 Baseline verification at session 2 start

| | |
|---|---|
| Repository | `C:/tmp/r1-ctx` |
| Branch | `fix/r1-profile-context` — **matches** |
| HEAD | `29fea38a2d1642c1c2fd957e5151f6be81415774` — **matches** |
| Worktree | **123 entries (66 M / 57 ??), 0 staged** — matches the session-1 close state exactly; no pre-existing work disturbed |
| Ledger identity | full SHA-256 `527934a01d13ed298da5777f342f8c9493b52db6928e09a12f139a9ec6075ecf`; the abbreviated `527934a01d13ed29` reported earlier is **confirmed correct** |
| WP-2 artefacts intact | migration `3ce166ae2cb894d5`, `writeOwner.ts` `5e893b1c5cc8b37d`, `ingestionBoundary.ts` `9274892330362f5c` — all unchanged |


---

## 10. WP-3 — authenticated-role tenant isolation

### 10.1 Timestamped checkpoints

| Checkpoint | Timestamp (IST) | Active effort since WP-3 start |
|---|---|---|
| WP-3 start | **2026-10-17T12:01:10** | 0 |
| Harness written, first run (25/25 tests pass, SUITE failed on teardown) | 2026-10-17T12:1x | ~13 min |
| Teardown fixed; harness green | 2026-10-17T12:17:16 | **16 min 06 s** |
| Gates complete | see §10.7 | recorded there |

No claim is made about monitoring the workstation between checkpoints. Each row
above is a measured `date -Iseconds` or a file mtime.

### 10.2 Effort and schedule

| | |
|---|---|
| WP-3 budget | **4.0 engineer-days**, unchanged |
| Active effort consumed | **well under 1 hour** (see §10.1) |
| Remaining budget | effectively the whole 4.0 days |
| Original target | **Thu 2026-10-29**, unchanged |
| Forecast finish | **2026-10-17** (this session) |
| Variance | **~8 working days early** |
| **OVERRUN RISK** | **NOT RAISED.** Neither 2026-10-29 nor the 2026-11-25 Milestone A′ baseline is threatened. The 75%-of-budget alert threshold was never approached |
| External wait / operator dependency | **none for WP-3** |

### 10.3 What the harness actually does

`backend/tests/realschema/ti_authenticated_tenant_isolation.test.ts`
(`ab4376ed17277204`, 587 lines, **26 tests**).

- **Two separate connections**, each as the `authenticator` LOGIN role then
  `SET ROLE authenticated`, with per-session `request.jwt.claims`. Distinct
  backend PIDs are asserted, so this is not one privileged session toggling a
  tenant parameter.
- **Grants re-created first.** The replay baseline is ACL-free, so the harness
  GRANTs production-shaped privileges before testing and asserts that each
  denial is a **zero-row RLS outcome** (`code === null`) rather than a
  privilege error. Without this, "permission denied for table" would have been
  recorded as isolation.
- **The policy model is discovered from `pg_policies` at runtime**, not assumed.
- **Committed fixtures with exact ids**, torn down by exact id. Verified after
  the run: zero fixture residue, zero leaked grants, RLS re-enabled, probe
  policy dropped.
- **Its own privileged client** for setup and teardown — see §10.6.

### 10.4 The security finding: PI has TWO different isolation models

Derived from the live catalogue, not from source comments.

| Surface | Policy model | What an authenticated tenant can do |
|---|---|---|
| `canonical_leads` | **tenant predicate** — `company_id = current_company_id()` on SELECT/UPDATE/DELETE, plus an INSERT check | Reads and updates **its own** rows; cross-tenant read/insert/update/delete/re-tenant/join all denied |
| `unified_persons`, `prospect_accounts`, `source_records`, `source_assertions`, `canonical_attribute_decisions`, `prospect_lists`, `prospect_list_members`, `person_account_relationships`, `contact_governance_records` | **`auth.role() = 'service_role'` only** — no tenant predicate anywhere | **Nothing.** Zero rows read, no writes accepted, *including into its own tenant* |

Both are isolation, and they are not the same guarantee:

1. On the service-role-only surfaces, isolation is **total denial** of the
   authenticated role. That is strictly stronger than tenant filtering for that
   role — but it also means **RLS contributes no tenant separation at all on the
   path the application actually uses**, because the application connects as
   `service_role`, which holds **BYPASSRLS** (asserted, test 5). Tenant
   separation there rests entirely on application code plus the composite
   tenant-safe foreign keys. A leaked service-role key has **no database-level
   backstop**.
2. `current_company_id()` **fails closed**: it returns NULL unless the
   `company_id` claim matches a UUID regex, so a missing, empty, malformed or
   injection-shaped claim yields no rows (test 21, five variants).

### 10.5 Residual security gap — the trust boundary (test 23)

Every service-role-only policy is `USING (auth.role() = 'service_role')`, and
`auth.role()` is `current_setting('request.jwt.claim.role')` — a **session
GUC**. The harness demonstrates that an `authenticated` session which can set
that GUC reads another tenant's data immediately.

This is **not an application vulnerability and is not reported as one**:
PostgREST sets the GUC from a signature-verified JWT and gives clients no way to
issue `SET`, so the real request path cannot reach it. It is recorded because it
bounds the guarantee: the predicate is enforced by a *setting*, not by the
*connected role*, so any path that can run arbitrary SQL on an authenticated
connection — a SQL-injection sink, or a careless `SECURITY DEFINER` routine —
inherits full cross-tenant read. "RLS protects these tables" is true only while
that GUC is trustworthy.

**No remediation is proposed or made here.** It is an owner decision whether to
add tenant-predicate policies to the PI surfaces (defence in depth behind the
application) or to accept the current model. Recorded as **OD-8**.

### 10.6 Defect I introduced and fixed, disclosed

The first harness run produced **25 tests passing and the SUITE marked FAIL**:
`setup.ts` registers a top-level `afterAll` that disconnects the shared `db`
client, and within one scope jest runs `afterAll` hooks in registration order,
so `db` was already closed when this file's teardown ran — "Client was closed
and is not queryable". Teardown that creates committed rows and real GRANTs
cannot depend on another module's lifecycle, so the harness now opens and closes
its own privileged client. This is also a live example of the hazard the brief
names: a wrapper reported success while a suite had failed.

A second, smaller correction: `SURFACES` carried a `tenant` column that nothing
read. Rather than delete it, test 18b now uses it for a generic per-surface
cross-tenant sweep, and **asserts its own non-vacuity** — naming the three
surfaces where a tenant-A fixture actually exists, so the sweep cannot pass by
testing nothing.

### 10.7 Gates — commands, runner counts and exit statuses

Every count below is read from jest's or tsc's own output, never from a wrapper's
exit code. The brief's ordering was followed.

| # | Command | Runner result | Exit |
|---|---|---|---|
| 1 | `jest --config jest.realschema.config.js --runInBand --forceExit --testPathPattern ti_authenticated_tenant_isolation` | **1 suite passed, 26/26 tests passed** | **0** |
| 2 | same, pattern `(w5_tenant_isolation\|rls_anon_exposure\|pl_prospect_lists\|li3_contact_governance\|li3d_governance_writer\|ti_authenticated\|ca_canonical_write_atomicity\|b1b_arbitration)` | **8 suites passed, 176/176 tests passed** | **0** |
| 3a | `NODE_OPTIONS=--max-old-space-size=12288 npx tsc -p tsconfig.backend-tests.json --noEmit` | 551 diagnostics, **0 of them in the new file** | 2 (pre-existing baseline) |
| 3b | `npm run typecheck` | **3/3 projects clean** | **0** |
| 4 | `jest --config jest.realschema.config.js --runInBand --forceExit` (full, once) | **36 suites passed, 808/808 tests passed** | **0** |
| 5 | wider regression | **NOT RUN** — WP-3 added one test file and changed no product source, so no evidence suggests wider impact |

Notes on 3a: `backend/tests` is excluded from all three main tsconfigs, so
ts-jest only *transpiles* the new harness and the main typecheck does not see
it. The backend-tests project is the only one that type-checks it; it carries a
large pre-existing error baseline (551 here), so the meaningful figure is that
**zero diagnostics name the new file**. Scope was verified rather than assumed:
the project's `include` is `backend/tests/**/*.ts`, and another realschema file
does appear in the diagnostics, so the directory is demonstrably in scope.

Container: disposable `w6-wp3b`, `pgvector/pgvector:pg17`, published
loopback-only. Schema built from `supabase/_schema/baseline.sql` + **52 replayed
migrations** (WP-2's `20261128000000` applied cleanly for a third time,
confirming idempotency). Removed at session close.

**A second instance of the wrapper hazard:** the first container build reported
`exit 0` while the log read `FATAL: the database system is shutting down` and no
schema was created; a later harness run reported `exit 0` while jest reported
`1 failed, 35 passed` suites. `scripts/ci/real-schema-ci.sh` exit status remains
unusable as a gate, as recorded in §4.0.2.

### 10.8 Acceptance-criteria matrix

| # | Criterion | Status | Evidence |
|---|---|---|---|
| 1 | Two distinct authenticated identities through separate sessions | **PASS** | Test 1 — distinct `pg_backend_pid()`, each `current_user = authenticated`, each with its own `company_id` claim. Tests 2 and 3 prove RLS is *enforced* on them, not merely enabled |
| 2 | Positive controls for each tenant's own data | **PASS** for the tenant-predicate surface; **N/A BY DESIGN** for the service-role-only surfaces | Tests 6, 7, 8 on `canonical_leads`. Test 19 records that tenant A also cannot read its own rows on the service-role-only surfaces, because no policy grants the authenticated role anything there. Not reported as a pass |
| 3 | Cross-tenant read/insert/update/delete/relationship/governance denied | **PASS** | Tests 9–15 (read, insert, update, re-tenant, delete, tenant-blind predicate, join), 17–18 (service-role-only surfaces), 18b (generic sweep, non-vacuity asserted) |
| 4 | Postconditions prove nothing persisted | **PASS** | Every negative control re-reads through the privileged session: intruder row absent, `source` unchanged, `company_id` still tenant B, row count still 1 |
| 5 | Effective grants, policies and bypass paths inspected | **PASS** | Policy model discovered from `pg_policies` at runtime (test 16); `authenticated` proven not superuser and not BYPASSRLS (test 2); `service_role` proven **BYPASSRLS** (test 5); grants re-created so denials are attributable to RLS |
| 6 | Deliberate negative control proves the harness catches a real failure | **PASS** | Test 24 adds a `USING (true)` SELECT policy → cross-tenant read succeeds → check fails as required → policy dropped → isolation restored. Test 25 does the same by disabling RLS. Disposable container only; both restored and re-asserted |
| 7 | Harness and affected suites pass, counts verified from the runner | **PASS** | §10.7 rows 1, 2, 4 |
| 8 | Typecheck and static checks pass | **PASS** | §10.7 rows 3a, 3b |
| 9 | Existing work and WP-2 semantics preserved | **PASS** | WP-2 artefacts unchanged by hash: migration `3ce166ae2cb894d5`, `writeOwner.ts` `5e893b1c5cc8b37d`, `ingestionBoundary.ts` `9274892330362f5c`. HEAD unchanged; worktree grew by exactly one file |
| 10 | Ledger carries timestamped effort, variance, evidence, limitations, next forecast | **PASS** | §9, §10 |

**Residual, reported not resolved:** the trust-boundary finding in §10.5 is
classified **UNVERIFIED as a production risk and OPEN as a design question**
(OD-8). It is not counted as a failure of criterion 3, because the application
request path cannot reach it; it is not counted as a pass either.

**Environmental limitations, stated rather than glossed:**
1. The disposable container emulates Supabase auth with SQL functions reading
   session GUCs (`auth.role()`, `auth.jwt()`), not GoTrue. The privilege context
   (`authenticator` → `SET ROLE authenticated`, NOINHERIT) is faithful to
   PostgREST; the *claim delivery* is not, which is exactly what §10.5 is about.
2. The replay baseline is ACL-free, so the harness grants production-*shaped*
   privileges rather than replaying production's actual ACLs. Production grants
   were **not** read — that would require production access, which is not
   authorized. Isolation under production's real ACLs is therefore
   **UNVERIFIED**, and only the policy behaviour is proven.
3. Six of the ten surfaces hold no tenant-A fixture, so test 18b's sweep covers
   three non-vacuously; tests 17/18 still prove total denial on all of them.

### 10.9 WP-3 status and next work package

**WP-3: COMPLETE.** All ten acceptance criteria PASS, with criterion 2 recorded
as split (PASS / N/A-by-design) and one residual design question raised as OD-8.

| | |
|---|---|
| Active engineering effort | **52 min 41 s** (12:01:10 → 12:53:51) against a **4.0 engineer-day** budget |
| Baseline target | Thu 2026-10-29 |
| Actual completion | **2026-10-17T12:53:51+05:30** |
| Variance | **8 working days early** |
| Files changed | **one added** — `backend/tests/realschema/ti_authenticated_tenant_isolation.test.ts` (`ab4376ed17277204`), plus this ledger. No product source touched |

**Next: WP-4 — list permissions, archive semantics, `added_via`.** Baseline Mon
2026-11-02, 2.0 engineer-days. It is **blocked on owner decisions OD-3 and
OD-4**, which were raised in §6 and remain open.

Because WP-4 and WP-5 are both owner-blocked, the next *unblocked* engineering
work is **WP-6** (manual/CSV/CRM promotion to real-schema and end-to-end, 3.0
days, baseline Wed 2026-11-11), which depends only on WP-2. Taking WP-6 ahead of
WP-4/WP-5 is a **sequencing change to the frozen plan** and is therefore the
owner's call, not mine; the dependency-ordered default remains WP-4 next.


---

## 11. WP-6 — manual / CSV / CRM intake promotion

### 11.1 Owner decisions recorded at WP-6 start

| Decision | Recorded effect |
|---|---|
| **Resequencing APPROVED** — WP-6 proceeds before WP-4/WP-5 because its only dependency is WP-2 | Taken as variance **V-5**. The §3 frozen baseline and the §9.6 corrected critical path are **not** rewritten; the executed order now differs from the planned order and both are preserved |
| **OD-8 → separate design-and-test track** | Not implemented here. No RLS change, no production ACL read, no schema change, no deployment. A read-only design note is recorded in §12 with explicit NOT RUN / UNVERIFIED statuses |
| **Milestone A′ frozen at 2026-11-25** | Unchanged. Not revised, not extended |

### 11.2 Revised dependency map

Planned (frozen §3): WP-3 → **WP-4 → WP-5 → WP-6** → WP-7 → WP-12 → WP-13.

Executed, under the approved resequencing:

```
WP-1 -> WP-2 -> WP-3 -> WP-6 -> WP-7 -> WP-12 -> WP-13
                          ^
            WP-4, WP-5 ---+  (owner-blocked on OD-3/OD-4/OD-5;
                              re-enter the sequence when answered)
```

WP-4 and WP-5 remain **required for Milestone A′** and are deferred, not
dropped. WP-6 does not satisfy either of them, and §8 of the brief forbids
deciding the list-permission, `added_via` and erasure-residue questions here —
none was touched.

### 11.3 Clock — measured

| Event | Timestamp (IST) |
|---|---|
| WP-3 close | 2026-10-17T12:55:13 |
| **WP-6 start** | **2026-10-17T13:34:11** |
| External wait between work packages | **38 min 58 s** (not engineering effort) |

| Measure | Value |
|---|---|
| WP-6 budget | **3.0 engineer-days** (frozen §3), unchanged |
| Baseline target | **Wed 2026-11-11** (frozen §3), unchanged |
| Agent wall-clock vs human engineer-days | reported separately, per §9.7: the budget is in human engineer-days and execution is agent wall-clock, so the two are not comparable and neither is converted into the other |

### 11.4 Prior-workstream evidence confirmed, not re-audited

All six artefacts re-hashed at WP-6 start and **unchanged**, so WP-2 and WP-3
stand on their existing reports without repeating either audit:

| Artefact | SHA-256 (abbrev.) |
|---|---|
| `supabase/migrations/20261128000000_pi_canonical_write_atomicity.sql` | `3ce166ae2cb894d5` |
| `backend/db/writeOwner.ts` | `5e893b1c5cc8b37d` |
| `backend/services/prospectIdentity/ingestionBoundary.ts` | `9274892330362f5c` |
| `backend/tests/realschema/ca_canonical_write_atomicity.test.ts` | `734ce27e0cd98e53` |
| `backend/tests/realschema/ti_authenticated_tenant_isolation.test.ts` | `ab4376ed17277204` |
| this ledger at WP-6 start | `fece9cd8d6b24f36` |

Repository at WP-6 start: branch `fix/r1-profile-context`, HEAD
`29fea38a2d1642c1c2fd957e5151f6be81415774`, worktree **124 entries
(66 M / 58 ??)** — identical to the WP-3 close state.

### 11.5 The gap WP-6 closes

Traced through the existing code rather than assumed:

| Stage | Manual | CSV | CRM |
|---|---|---|---|
| Route | `pages/api/lead-ingestion/manual.ts` | `.../csv.ts` | `.../crm.ts` |
| Adapter registered at runtime | `registerBuiltInLeadSources()` is called by each route at module scope | same | same |
| Source key | `manual` | `csv` | `crm` |
| Identity key | `referenceId` | derived: sha256 over `org\|email\|phone` | **`externalId` REQUIRED** — a CRM record is defined by the CRM's own id |
| Orchestrator | `ingestLeadBatch` → `ingestSourceRecord` → identity → account → `resolveOrCreateProspect` → duplicate parking | same | same |
| List | `listProspects` over `canonical_leads` | same | same |

**None of it was proven against the real schema.** The only end-to-end test,
`piList002IntakeToListE2E`, states in its own header that it is "NOT
database-backed", and it covers `manual` only. So the gap was not a missing
code path — all three paths exist and are wired — it was missing *real-schema
evidence* for all three, plus no coverage at all for `csv` and `crm`.

Consistent with that, **no product source was changed by WP-6**. The deliverable
is the evidence.


### 11.6 Intake-to-list data flow, as proven

For each source, the chain below was driven end to end against live
PostgreSQL 17. Everything is the real implementation except the two doubles
named in the suite header: `ownedDbTable`/`ownedDbRpc` mapped onto the live
connection, and `featureFlagService` (the tenant gate is a policy decision, not
part of the pipeline).

```
record -> adapter.translate(raw, batchTenant)       <- tenant OVERRIDDEN here
       -> validateNormalizedRecord                 <- externalId required
       -> source_records  (upsert, observation_count)
       -> source_assertions (dedup by unique index)
       -> identityResolutionService.resolveUnifiedPerson
       -> accountResolution.resolveOrCreateAccount
       -> pi_apply_canonical_decisions  (WP-2: atomic canonical + decision + stamp)
       -> prospectResolution.resolveOrCreateProspect  -> canonical_leads
       -> personDuplicates.detectAndParkDuplicates
       -> listProspects  -> ProspectListRow { prospectId, scoreState, ... }
       -> prospect_list_members  (enrollable, tenant-safe composite FK)
```

| Source | Identity key | Proven by |
|---|---|---|
| `manual` | `referenceId` | tests 1–3, 9, 11, 17–19, 23–27 |
| `csv` | sha256 over `org\|email\|phone` | tests 4–6, 20, 21 |
| `crm` | **`externalId`, required** — the CRM's own id, carried into `canonical_leads.external_lead_key` | tests 7, 8 |

### 11.7 Gates — commands, runner counts, exit statuses

Read from jest's and tsc's own output. The brief's ordering was followed and the
heavyweight runs were serialized, one process at a time.

| # | Command | Runner result | Exit |
|---|---|---|---|
| 1 | `jest --config jest.realschema.config.js --runInBand --forceExit --testPathPattern i2l_intake_to_list` | **1 suite passed, 27/27 tests passed** | **0** |
| 2 | full real-schema suite, once | **37 suites passed, 835/835 tests passed** (was 808; +27) | **0** |
| 3 | scoped PI unit regression, 243 suites | **240 passed, 2 failed, 1 skipped**; 4918 passed / 11 failed | 1 |
| 4 | `tsc -p tsconfig.backend-tests.json --noEmit` | see §11.9 | — |
| 5 | `npm run typecheck` | see §11.9 | — |
| 6 | Control-byte scan (`grep -laP`) | **clean** on every file touched | — |

Gate 3's two failures are the **same pre-existing failures, with identical
counts**, recorded at WP-2 close in §4.0.5: `leadDeadLetterProducer`
(`services/boltExecutionRecovery.ts` lacks `deadLetterOnExhaustion(`, BOLT, not
PI) and `prospectListPage.dom` (`pages/prospects/index.tsx:108`,
`evaluationLabel` reads `.state` of `undefined`). **Zero new failures.**

Per §6 of the brief neither was fixed. Their effect on the WP-6 proof: **none**.
`leadDeadLetterProducer` is unrelated. `prospectListPage.dom` is a *rendering*
defect on the prospects page; the API-level list contract WP-6 proves is
`listProspects`, which passes. The UI page that consumes it is broken
independently — worth carrying into WP-12, and noted there.

### 11.8 Defects I introduced and fixed, disclosed

| Defect | Detection | Resolution |
|---|---|---|
| The suite could not load at all: `Cannot find module '@/config'` | first run, suite-level failure | `jest.realschema.config.js` had no `moduleNameMapper`, so no real-schema test could import anything transitively reaching the `@/` alias — and `prospectIntelligenceRead` does, through the enrichment credential chain. Added the mapping, identical to the default project's. **Additive**: a mapper only applies to imports that match, so suites never using `@/` are unaffected — confirmed by the full suite still passing |
| Every ingest refused as `ingestion_disabled` | first green run, 16 failures | `resolveLeadIngestionGate` checks a **global kill switch** (`ENABLE_LEAD_INGESTION`) before the per-tenant flag, and the real-schema jest project loads only `realschema/setup.ts`, not `backend/tests/setupEnv.ts`. Set in the suite, as `piList002` does |
| 6 assertions used `row.id` and one used `row.score` | failures showed `[undefined]` | `ProspectListRow` exposes `prospectId`, and scores live under `evaluation.overall` with `scored`/`scoreState` beside it. Corrected to the reader's real fields — and `qualificationScore` is deliberately **not** asserted null, because it is a different authority whose column default of 0 is reported verbatim |
| Test 1 failed with `expected 0, received 1` and no reason | — | Added a diagnostic assertion that surfaces `rejection`/`error` **before** the count, so a refusal reports why. Kept |
| Two tests asserted behaviour the code does not have | tests 13 and 22 | Both were **my** wrong expectations, not defects. Corrected to the measured behaviour, and the measurements are findings in their own right — see §11.9 |

### 11.9 Two findings: the code is safe, the contract comments are not accurate

**(a) A record claiming another tenant is OVERRIDDEN, not rejected.**
`IngestBatchInput.organizationId` is documented as *"Authoritative; a record
claiming a different tenant is rejected."* It is not rejected. Every adapter
builds its input as `{ ...raw, organizationId }` with the batch tenant **last**
(`manualAdapter.ts:302`), so a record-level tenant claim is discarded before
validation ever sees it.

Measured outcome for a batch tenanted to A carrying a record claiming B:
`succeeded: 1`, and the row landed in **A**, with **zero** rows in B across
`canonical_leads`, `unified_persons`, `prospect_accounts`, `source_records` and
`source_assertions`. So the security property holds, and arguably more strongly
than the comment describes: there is no code path on which a record-level claim
is honoured at all. **The comment is inaccurate; the behaviour is safe.** No
code was changed — correcting a comment is not WP-6 scope, and the test now
records the real behaviour.

**(b) A per-record canonical-write failure does not reject the batch.**
With the decision log blocked by a trigger, intake does **not** throw: the
orchestrator isolates per-record failures by design ("a bad record in a batch
must fail that record and no other"), so the batch resolves with `failed: 1`
and that record reporting `ok: false`. The WP-2 property still holds through
intake — no canonical attribute was applied and **zero** decision rows exist,
so there is never an applied canonical value without a decision explaining it.

### 11.10 Static checks

| Gate | Result |
|---|---|
| `tsc -p tsconfig.backend-tests.json --noEmit` | **551 pre-existing diagnostics, 0 in the new file.** Identical to the 551 baseline measured at WP-3, so the new suite added none |
| `npm run typecheck` | **3/3 projects clean**, `TYPECHECK_EXIT=0` |

`backend/tests` is excluded from all three main tsconfigs, so ts-jest only
transpiles the new suite and the main typecheck never sees it; the backend-tests
project is the only one that type-checks it, and its `include` is
`backend/tests/**/*.ts`. The one non-test change, `jest.realschema.config.js`,
is a `.js` file and is in no TypeScript project.

### 11.11 Acceptance-criteria matrix

| Required test | Status | Evidence |
|---|---|---|
| Manual intake → canonical prospect → qualification / list eligibility | **PASS** | Tests 1, 2, 3, 26 |
| CSV intake → canonical → qualification / list eligibility | **PASS** | Test 4 |
| CSV malformed rows | **PASS** | Test 5 — refused, and postconditions prove nothing persisted on any surface |
| CSV duplicate records | **PASS** | Test 6 — two identical rows in one batch yield one prospect and one person |
| CRM intake through the supported adapter | **PASS** | Test 7 — `external_lead_key` carries the CRM's own id |
| Idempotent reprocessing | **PASS** | Tests 9, 11, 21 — the same prospect id on replay, assertion count does not grow |
| Duplicate identity handling | **PASS** | Tests 6, 10 — the same person from a second source resolves to one spine row |
| Missing tenant context fails closed | **PASS** | Tests 12, 15 |
| Conflicting tenant context fails closed | **PASS** (behaviour corrected) | Test 13 — **overridden, not rejected**; zero rows reach the claimed tenant on five surfaces. See §11.9(a) |
| Cross-tenant reads/writes denied, with postconditions | **PASS** | Tests 13, 14, 16, 27 — plus WP-3's 26 authenticated-session tests |
| Suppression / consent enforced | **PASS** | Tests 23 (positive control), 24, 25 — stored in the real governance table, read back, decided by the real evaluator; tenant-scoped |
| Provenance enforced | **PASS** | Tests 2, 11, 19 |
| Unknown attributes not fabricated | **PASS** | Tests 17, 18 — unsupplied columns stay NULL; invented fields appear nowhere in the canonical row |
| No unjustified positive ICP score | **PASS** | Test 3 — `scoreState: 'unevaluated'`, `scored: false`, `evaluation.state: 'none'`, `evaluation.overall: null` |
| Partial failure preserves consistency and auditability | **PASS** | Tests 20, 22 — one bad row fails alone; a blocked decision log leaves no applied canonical value and zero decision rows |
| Retry behaviour | **PASS** | Test 21 |
| Relevant existing PI tests | **PASS** | Full real-schema **37/37 suites, 835/835**; scoped PI unit **240/243 suites**, zero new failures |
| Typecheck | **PASS** | 3/3 clean; 0 diagnostics in the new file |

**Not decided here, preserved for WP-4/WP-5 as required by §8 of the brief:**
list permissions and archive semantics (OD-3), the `added_via` vocabulary
(OD-4), and person-erasure residue (OD-5). Test 26 proves a prospect is
*reachable* as a list member and says so explicitly in a comment; it asserts no
policy.

### 11.12 Effort, variance and status

| | |
|---|---|
| WP-6 start | **2026-10-17T13:34:11+05:30** |
| WP-6 finish | **2026-10-17T14:16:40+05:30** |
| **Active engineering effort** | **42 min 29 s** |
| External wait before start | 38 min 58 s (WP-3 close → WP-6 start), tracked separately |
| Budget | **3.0 engineer-days** (frozen), effectively unconsumed in human-day terms |
| Baseline target | **Wed 2026-11-11** (frozen) |
| Variance | **~17 working days early** |
| **OVERRUN RISK** | **NOT RAISED.** Neither 2026-11-11 nor the frozen 2026-11-25 Milestone A′ baseline is threatened. The 75%-of-budget threshold was never approached |

**WP-6 STATUS: COMPLETE.** All three supported sources — manual, CSV and CRM —
are verified end to end against the real schema, from intake through canonical
identity to a usable, tenant-safe prospect list.

### 11.13 Files changed, and why

| File | Change | Why |
|---|---|---|
| `backend/tests/realschema/i2l_intake_to_list.test.ts` | **NEW**, 819 lines, 27 tests, `92a343c9e868200f` | The WP-6 deliverable. All three sources end to end against live PostgreSQL |
| `jest.realschema.config.js` | **+1 `moduleNameMapper`**, `b2ffbc9c445704ef` | Without the `@/` alias no real-schema test can import anything transitively reaching it, and the real list reader does. Mirrors the default project exactly; additive, and the full suite still passes |

**No product source was changed.** The gap WP-6 closed was missing real-schema
*evidence*, not a missing code path — all three routes, adapters and the
orchestrator already existed and were already registered at runtime.

Repository at WP-6 close: branch `fix/r1-profile-context`, HEAD
`29fea38a2d1642c1c2fd957e5151f6be81415774` **unchanged**, worktree **126 entries
(67 M / 59 ??)** — exactly +1 modified and +1 untracked against the WP-6 start
state of 124 (66 M / 58 ??). WP-2 and WP-3 artefacts unchanged by hash. Nothing
committed, pushed, merged or deployed; no production access; the disposable
container was removed at close.

### 11.14 Next dependency-ordered task

**WP-7 — Active Leads → PI canonical intake**, baseline Tue 2026-11-17,
4.0 engineer-days, dependencies WP-2 and WP-6 (both now complete). It is the
next *unblocked* engineering work and the next step on the corrected critical
path.

Still owner-blocked and still required for Milestone A′: **WP-4** (OD-3, OD-4)
and **WP-5** (OD-5). They remain deferred, not dropped.


---

## 12. OD-8 — tenant-predicate RLS as defence in depth (separate track, DESIGN ONLY)

Per the owner's decision, this is a **design-and-test track, not WP-6 work**.
Nothing here was implemented. No RLS was changed, no schema was altered, no
production ACL was read, no database was mutated outside the disposable
container, and nothing was deployed.

### 12.1 Threat model

The asset is every tenant's prospect data: people, employers, evidence,
arbitration decisions, lists and contact-governance instructions.

| Threat | Today's control | Database backstop today |
|---|---|---|
| A tenant user requests another tenant's data through the API | application authorization (`requireTenantAccess`, tenant-scoped queries) | **`canonical_leads` only.** Nine other PI surfaces have none |
| A bug omits a tenant predicate in one query | code review, the `piList002` test asserting the predicate on every `canonical_leads` access | **none** on the nine surfaces |
| A leaked or misused `service_role` key | key custody | **NONE.** `service_role` holds `BYPASSRLS` (proven, WP-3 test 5) |
| SQL injection reaching an authenticated connection | input handling | **none**; and WP-3 test 23 shows a session able to set `request.jwt.claim.role` reads everything |
| A careless `SECURITY DEFINER` routine | review | **none** |

The honest summary: **PI's tenant isolation is an application property, not a
database property**, on every surface except `canonical_leads`. The composite
tenant-safe foreign keys are a real and valuable structural control — they are
what makes a cross-tenant *write* unconstructible (proven repeatedly in WP-6
tests 16 and 27) — but they do not prevent a cross-tenant *read*.

### 12.2 Tables and roles in scope

Measured from the live catalogue in WP-3, not from source comments.

| Surface | Current policy | Candidate |
|---|---|---|
| `canonical_leads` | `company_id = current_company_id()` on SELECT/UPDATE/DELETE + INSERT check | **already compliant — use as the pattern** |
| `unified_persons` | `auth.role() = 'service_role'` only | add `company_id = current_company_id()` |
| `prospect_accounts`, `source_records`, `source_assertions`, `canonical_attribute_decisions`, `prospect_lists`, `prospect_list_members`, `person_account_relationships`, `contact_governance_records` | `auth.role() = 'service_role'` only | add `organization_id = current_company_id()` |

Roles: `anon` (no access intended), `authenticated` (subject to RLS — proven not
superuser, not `BYPASSRLS`), `service_role` (**`BYPASSRLS`**), `authenticator`
(the PostgREST login role, privileges only via `SET ROLE`).

### 12.3 The service-role bypass is the crux

Adding tenant-predicate policies would **not** constrain the application,
because the application connects as `service_role` and `BYPASSRLS` means
policies are never evaluated. So the candidate change buys:

- a backstop for any **authenticated**-role path, present or future;
- a backstop against a missing tenant predicate in application SQL **only if**
  that path stops using `service_role`;
- **nothing at all** against a leaked `service_role` key.

Therefore the design question is **not** "should we add policies" in isolation.
It is: **which read paths could run as `authenticated` rather than
`service_role`?** If the answer is none, tenant-predicate policies are
documentation with a performance cost. That question is **UNVERIFIED** — it
requires an inventory of how each PI read path authenticates, which was not in
WP-6's scope.

### 12.4 Legitimate privileged workflows that must keep working

Each would break, or silently return nothing, under naive policies:

| Workflow | Why it needs privilege |
|---|---|
| The ingestion boundary and `pi_apply_canonical_decisions` | writes across tenants' rows within one tenant, but runs server-side with no end-user JWT |
| Background workers (scheduler, retry, sweeper) | no JWT at all, so `current_company_id()` would be NULL and every policy would deny |
| Platform super-admin surfaces | legitimately cross-tenant by design |
| Migrations and the real-schema harness | connect as the owner/superuser |
| `personErasure` | multi-table, ordered, tenant-scoped deletes |

A policy set that forgets any of these converts a security improvement into an
outage. `current_company_id()` returning NULL **fails closed** (proven, WP-3
test 21), which is correct for a user request and fatal for a worker.

### 12.5 Candidate policy shape

Following the `canonical_leads` precedent exactly rather than inventing one:

```
-- per surface, per command, with the tenant column that surface actually uses
CREATE POLICY <t>_select ON public.<t> FOR SELECT TO authenticated
  USING (<tenant_col> = public.current_company_id());
CREATE POLICY <t>_insert ON public.<t> FOR INSERT TO authenticated
  WITH CHECK (<tenant_col> = public.current_company_id());
-- UPDATE needs BOTH, or a row can be re-tenanted out of the tenant
CREATE POLICY <t>_update ON public.<t> FOR UPDATE TO authenticated
  USING (<tenant_col> = public.current_company_id())
  WITH CHECK (<tenant_col> = public.current_company_id());
-- the existing service_role policy is RETAINED, not replaced
```

Note the append-only trigger on `canonical_attribute_decisions` already forbids
UPDATE/DELETE, so that surface needs SELECT and INSERT only.

### 12.6 Test and rollout requirements

The WP-3 harness is the template and already proves the method works:
two real authenticated sessions, production-shaped grants re-created first so a
denial is attributable to RLS rather than a missing GRANT, postconditions on
every negative control, and a deliberately broken policy to prove the harness
is not blind.

Required before any rollout:

1. **Positive controls per surface** — each tenant reads and writes its own rows
   under `authenticated`. These are the tests that would catch an over-tight
   policy, and they do not exist today because the surfaces deny everything.
2. **Worker and server-side paths proven unaffected** — the gap most likely to
   cause an incident.
3. **Query-plan check** — a policy predicate is an implicit WHERE on every
   access; confirm the tenant columns are indexed on each surface.
4. **Migration-only change, additive**, retaining the service-role policies.
5. **Production migration state is a prerequisite**: four PI migrations are
   already `UNVERIFIED` in production (§3 WP-12, blocker B1/OD-3C-1). Adding a
   tenth policy migration before that is resolved would compound an existing
   unknown.

### 12.7 Status

| Item | Status |
|---|---|
| Threat model | **DOCUMENTED** (§12.1) |
| Tables and roles in scope | **VERIFIED** from the live catalogue (§12.2) |
| Service-role bypass implications | **VERIFIED** — `BYPASSRLS` proven in WP-3 (§12.3) |
| Which PI read paths could run as `authenticated` | **UNVERIFIED** — needs an authentication-path inventory, out of WP-6 scope. **This is the question that decides whether the change is worth making** |
| Legitimate privileged workflows | **DOCUMENTED, NOT TESTED** (§12.4) |
| Candidate policies | **DRAFTED, NOT APPLIED** (§12.5) |
| Index coverage for the predicates | **NOT RUN** |
| Production ACLs | **NOT READ** — not authorized, and not attempted |
| Implementation | **NOT RUN** — no authorization sought or assumed |

