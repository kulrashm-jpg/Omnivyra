# ENG-004 — ENGAGEMENT MESSAGE TENANT HARDENING + G-19 — IMPLEMENTATION REPORT

**Base:** worktree `C:/tmp/pi-consol`, HEAD `7febdb28`.

---

## 1. Gate status

**PASS WITH LIVE VERIFICATION BLOCKED — AND ONE SCOPE DECISION REQUIRED.**

The honest summary: the schema hardening and the priority lookup hardening are
implemented, typecheck and route-auth pass, 463 tests pass across 21 suites, and all
ten mutation probes behave and restore byte-identically. Two things stop this being an
unqualified PASS, and both are reported rather than papered over:

1. **The database half is unverified.** The migration has never been executed. No
   PostgreSQL is reachable from this gate: Docker is down, and the recorded evidence is
   that starting it auto-starts `omnivyra-worker`, which has run **production** crons
   (observed 2026-09-11 via the local Redis cron stamps). I will not start a
   production-connected process to test a migration. §16 has the detail.
2. **The access surface is 85 sites, not five.** ENG-003 said five. The real inventory
   is 85 access sites, of which **27 reads** touch `id`, `parent_message_id` or
   `platform_message_id`. I hardened the five ENG-003 named plus every
   `parent_message_id` and `platform_message_id` site the brief's §9 and §10 require —
   nine in total — and left **18 further id-based reads characterized but untouched**,
   per §3's instruction not to expand implementation without owner approval. §30's
   success criterion asks for *every identified* lookup, so that criterion is **not
   fully met** and the gap is the owner's call, not mine to quietly absorb.

---

## 2. Scope authorized, and what was built

| Authorized | Built |
|---|---|
| `engagement_messages` tenant hardening | **IMPLEMENTED** — migration `20261117000000` |
| tenant-safe lookup/write paths | **PARTIAL** — 9 of 27 read sites; writes covered structurally by trigger |
| the five identified unscoped lookups | **IMPLEMENTED** — all five |
| G-19 `autoReplyService` assessment | **CHARACTERIZED** — verdict in §10; minimal tightening only |
| G-22 ratification | **OWNER DECISION REQUIRED** — §11 |
| Reject → bounced documentation | **RECORDED, unchanged** — §12 |
| tests + probes | **IMPLEMENTED** — 26 new tests, 10 probes |

No inbound email, no SES inbound, no MX, no email conversations, no reply ingestion, no
unsubscribe→suppression, no lifecycle producer, no reply sentiment, no WhatsApp
convergence, no intelligence, no sender/domain work, no deployment.

---

## 3. Source inventory

Produced before any edit, by walking `backend`, `pages`, `lib`, `scripts` for
`ownedDbTable('engagement_messages')` and `from('engagement_messages')` and bounding
each chain at its statement end.

**85 access sites: 77 reads, 8 writes. Only 2 sites filtered a tenant in their own
chain before this gate.**

My first pass over-counted tenant-filtered sites at six; the window had bled into the
following statement. The tightened count is two.

### The 8 write paths

| Site | Op | Tenant predicate before |
|---|---|---|
| `backend/queue/jobProcessors/whatsappWebhookProcessor.ts:127` | upsert | — |
| `backend/services/bulkEngagementService.ts:285` | upsert | — |
| `backend/services/engagementOutboundMirrorService.ts:173` | upsert | — |
| `pages/api/engagement/backfill-self-signals.ts:222` | update | `id` only |
| `pages/api/engagement/message/mark-self.ts:81` | update | `id` only |
| `pages/api/engagement/reply.ts:910` | upsert | — |
| `pages/api/extension/events/dms.ts:663` | insert | — |
| `pages/api/extension/events/dms.ts:668` | update | `thread_id`, `platform_message_id` |

### The 27 reads on the isolation surface

Nine hardened (§8). The other 18, characterized and **not** changed:
`engagementConversationIntelligenceService.ts:104`, `insightIntelligenceService.ts:133`,
`leadDetectionService.ts:183`, `responseOrchestrator.ts:106`,
`responseStrategyLearningWorker.ts:97`, `engagement/generate-response.ts:40`,
`engagement/inbox.ts:170`, `engagement/like.ts:88`, `engagement/message/bulk-like.ts:110`
and `:152`, `engagement/message/mark-self.ts:55`, `engagement/reply.ts:248` and `:386`,
`engagement/suggestions.ts:48`, `engagement/thread/bulk-pattern-reply.ts:90`,
`response/generate.ts:37`, `autoReplyService.ts:25`/`:108` (see §10),
`scripts/operator/db/backfill_lead_signals.ts:95`.

Several of these are reachable only after a route-level tenant check, and
`engagementNormalizationService.ts:431` is `(thread_id, platform_message_id)` — thread-
scoped, therefore tenant-safe transitively and now structurally. None of that makes them
*explicitly* scoped, which is what §30 asks for.

---

## 4. Current `engagement_messages` access model

Before this gate: no tenant column. Tenancy was transitive through
`thread_id → engagement_threads.organization_id`, and the code knew it — 
`prospectEngagementIntelligence.ts:33` says in so many words "`engagement_messages`
carries NO tenant column — its only tenancy is its thread".

Two further structural facts found during discovery, neither recorded by ENG-001/002/003:

- **`engagement_threads.organization_id` is NULLABLE.** A message on an untenanted
  thread cannot be given a tenant that satisfies a composite FK, so the target invariant
  is unreachable for such rows. The migration detects and aborts (§6).
- **`engagement_messages_parent_message_id_fkey` references `engagement_messages(id)`
  globally.** Nothing prevented a message in tenant B naming a parent in tenant A. A
  query predicate alone would not have fixed that — the bad row stays writable — so the
  parent edge got its own composite FK (§7). This is the single most important change in
  the gate for inbound-email safety.
- **`idx_engagement_messages_platform_message_global` is UNIQUE on
  `(platform, platform_message_id)` ACROSS TENANTS.** Reported as **G-23** in §24, not
  changed.

---

## 5. Schema change

One additive migration,
`supabase/migrations/20261117000000_eng004_engagement_message_tenant.sql`
(`c3c5930edcd14a0a`). Migration count 435 → **436**.

```
1  ADD COLUMN organization_id uuid                        (nullable at first)
2  backfill from engagement_threads.organization_id
3  VALIDATE: orphans / untenanted / mismatches -> RAISE with counts + 20 ids
4  ALTER COLUMN organization_id SET NOT NULL              (only after 3 passes)
5  engagement_threads: UNIQUE (id, organization_id)       (supporting constraint)
6  FK (thread_id, organization_id) -> engagement_threads(id, organization_id)  CASCADE
6b engagement_messages: UNIQUE (id, organization_id)
   FK (parent_message_id, organization_id) -> engagement_messages(id, organization_id)
      ON DELETE SET NULL (parent_message_id)
7  TRIGGER engagement_messages_tenant_matches_thread  BEFORE INSERT OR UPDATE OF ...
8  3 indexes: (org), (org, parent) partial, (org, platform, platform_message_id) partial
```

**Why a trigger rather than editing all 8 write paths.** Each write path *has* a tenant
available — they all hold a thread — so the column could have been filled by hand in
eight places. Rejected because a ninth writer can forget, and the invariant would then
live in application discipline rather than in the database. The trigger makes
`message.organization_id = thread.organization_id` true by construction for every writer,
present and future, and the 8 paths needed **no change at all**.

**The trigger validates rather than merely fills**, and that detail is load-bearing:

- `organization_id IS NULL` → derived from the thread, so existing writers keep working;
- explicitly **wrong** → `RAISE`, because silently correcting a caller's bad tenant would
  hide a bug or an attack.

Had it only ever overwritten the value, the composite FK could never be violated and any
cross-tenant-insert test would pass vacuously — the trap PI-040 recorded as "BEFORE
triggers mask CHECKs". Probe **P7** injects exactly that degradation and the suite fails.

**A real bug I introduced and caught.** The parent FK was first written with a bare
`ON DELETE SET NULL`. On a composite FK that nulls *every* referencing column, including
the `NOT NULL` `organization_id` — so deleting a parent message would have errored
instead of cascading. Corrected to `ON DELETE SET NULL (parent_message_id)`, which needs
PostgreSQL 15+; this platform runs 17. Probe **P8** pins the column list.

---

## 6. Backfill results

**NOT RUN. No row was read, written or counted.**

The migration backfills from the thread, then validates and **aborts with exact counts**
(`orphaned_messages`, `messages_without_tenant`, `tenant_mismatches`) plus the first 20
offending ids, rather than repairing anything. It contains no `DELETE` and no
`DROP TABLE`.

Real counts are **UNVERIFIED**: production may not be read, and the non-production
project `lomndxmrpyudaegddpef` holds **zero** `engagement_threads` and **zero**
`engagement_messages` rows — I checked, and it can tell us nothing about distribution.

So whether this migration *applies* depends on data nobody has looked at. If any thread
has a NULL `organization_id`, it will abort — by design.

---

## 7. Composite tenant constraints

| Constraint | Purpose |
|---|---|
| `engagement_threads_id_org_unique UNIQUE (id, organization_id)` | the FK target. Adds no restriction — `id` is already the PK, so the pair is trivially unique |
| `engagement_messages_thread_org_fkey (thread_id, organization_id) → threads(id, organization_id)` ON DELETE CASCADE | makes `message.org = A` with `thread.org = B` **impossible**, not merely unwritten. CASCADE matches the pre-existing `engagement_messages_thread_id_fkey` |
| `engagement_messages_id_org_unique UNIQUE (id, organization_id)` | the parent FK's target |
| `engagement_messages_parent_org_fkey (parent_message_id, organization_id) → messages(id, organization_id)` ON DELETE SET NULL (parent_message_id) | a message may only name a parent **in its own tenant**. `MATCH SIMPLE` means a NULL parent skips the check, so root messages are unaffected |

`ON UPDATE` is left at the default `NO ACTION` deliberately. That blocks reassigning a
thread's tenant while messages reference the old pair — which is correct, because
`ON UPDATE CASCADE` would silently migrate messages between tenants. I verified nothing
reassigns `engagement_threads.organization_id` today; the only org-reassigning update in
the repo is on `free_credit_profiles` (`onboarding/setup-company.ts:826`).

This is the only change to `engagement_threads`. It is not redesigned.

---

## 8. The identified lookup changes

Nine sites, each now carrying an explicit tenant predicate.

| Site | Was | Now |
|---|---|---|
| `engagementAiAssistantService.ts` direct id | `.eq('id', message_id)` + an app-level thread check afterwards | `.eq('organization_id', organization_id).eq('id', message_id)` |
| `engagementAiAssistantService.ts` **parent** | `.eq('id', message.parent_message_id)` — **no check at all** | tenant-scoped by the caller's org |
| `bulkEngagementService.sendReply` | `.eq('id', messageId)` | `.eq('organization_id', organizationId)` added |
| `extension/events/comments.ts` parent | `.eq('platform').eq('platform_message_id')` on **scraped** data | tenant-scoped |
| `extension/events/comments.ts` update | `(platform, platform_message_id, thread_id)` | `organization_id` added |
| `replyIntelligenceAggregationWorker` parent sweep | `.in('parent_message_id', ids)` | `.in('organization_id', batchOrgIds)` added; org in the projection and the map key |
| `autoReplyService` ×2 | see §10 | thread predicate restored on the second read |

Two points worth drawing out:

The AI assistant's direct-id lookup already had defence-in-depth — it loaded the message
then verified the owning thread's org. §7 is explicit that this is the wrong shape when a
predicate can do it, and the reason is practical: the check is one edit from being
deleted, a `WHERE` clause is not. The check was kept as well.

The AI assistant's **parent** lookup had no tenant check at all and fed the result
straight into an AI prompt. With inbound email that pointer derives from `In-Reply-To`,
making it externally controlled. That is the sharpest single fix in this gate.

The worker was already safe *by accident* — its map key included `thread_id`, so a
cross-tenant reply failed to match. Now the tenant is in the predicate, the projection
and the key, so the isolation is stated rather than depending on a coincidence a
refactor could remove.

---

## 9. Additional findings

- **The surface is 85 sites, not 5** (§3). The 18 remaining id-based reads are the scope
  decision in §1.
- **`engagement_threads.organization_id` is nullable** → the invariant may be
  unreachable for legacy rows; the migration aborts rather than inventing a tenant.
- **The parent FK was globally scoped** → fixed structurally.
- **G-23 (new): `(platform, platform_message_id)` is UNIQUE across tenants.** Two
  tenants cannot hold the same provider message id — the second insert fails with 23505.
  For email, SES ids are globally unique so a collision is unlikely, but the *semantics*
  are cross-tenant: one tenant's data can make another's insert fail, and the error
  discloses existence. Characterized, **not changed** — altering a live unique index is
  not minimal and may have duplicates behind it.
- **Five test suites had fixtures that predated the column** and began failing when the
  predicates landed. Updated to carry `organization_id`, which makes those fixtures model
  the DB invariant rather than contradict it (§17).

---

## 10. G-19 assessment

**G-19 status: ORPHANED — and NON-COMPLIANT. BLOCKING for ENG-005.**

| Question | Answer |
|---|---|
| production-reachable? | **No.** Zero importers of `autoReplyService`, `isEligible` or `attemptAutoReply` anywhere in `backend`, `pages`, `lib` |
| can it send? | **Yes.** `attemptAutoReply → orchestrateResponse → executeAction`, whose runtime imports `getToken` (platform tokens), `executeRpaTask` (RPA worker) and `sendCommunityAiWebhooks`, and writes `community_ai_actions` |
| bypasses Common Outreach? | **Yes.** `communityAiActionExecutorRuntime` references `leadOutreachExecution`, Common Outreach and `mayContact` **zero** times |
| bypasses tenant governance? | **Partly.** It is gated by `getControls(organizationId).auto_reply_enabled`, a per-org feature control — but that org is *derived from the supplied thread*, not from an authorized caller |
| creates engagement messages? | Not directly; its downstream mirror paths do |
| mutates lifecycle? | No |
| tenant-scoped message queries? | **No, and it cannot be.** Neither entry point accepts an organization id |
| dead or orphaned? | **Orphaned** — the module is intact, has no callers, and has no tests |
| behind a feature flag? | Behind `auto_reply_enabled` per organization, not a deploy flag |
| tests? | **None** |
| reachable once inbound email exists? | **Yes — that is precisely the trigger.** An inbound reply is the event an auto-reply responds to |

Per §15 it is orphaned, so I did not stop the gate, did not delete it, and did not
redesign it. The one change made is a tightening inside its existing contract: its second
message read lacked the `thread_id` predicate its own eligibility check uses, so it could
resolve a message from a *different* thread than the one just validated.

**It cannot be tenant-scoped without a signature change**, because the tenant is derived
from whichever `threadId` the caller passes. **ENG-005 must not be started while this
module can be given a caller**: the options are to add an authoritative
`organizationId` parameter and route it through Common Outreach, or to delete it. Both
are owner decisions outside this gate.

---

## 11. G-22 decision status

**G-22 = OWNER DECISION REQUIRED.**

No owner ratification was supplied in this execution context, and §18 is explicit that
absent that I must not declare it ratified. So it is not.

The mechanism is unchanged from ENG-003 and does satisfy every constraint §18 lists: it
fails on zero matches (`task_not_found`), fails on multiple tenants
(`cross_tenant_mismatch`), and never infers from recipient, sender or arbitrary payload
metadata — the only input is a `provider_message_id` our own `dispatch.ts` minted, read
from a row we wrote, after the event's authenticity is established by signature and topic
allow-list. It remains an interim measure to be replaced by authoritative sender/provider
identity mapping once tenant-owned sender identities exist. No replacement was built.

---

## 12. Reject → bounced decision status

**Preserved exactly as ENG-003 left it. Unchanged, and no migration created for it.**

`SES Reject` normalizes to `bounced` because `failed` is not ingestible through the
frozen feedback contract, and raw `sesEventType: 'Reject'` remains available in the
evidence so the distinction is never lost. `ingestFeedback` was **not** modified by this
gate. It remains an owner decision for a future outcome-vocabulary gate.

---

## 13. Security invariants

| Invariant | Enforcement |
|---|---|
| every message has an explicit tenant | `organization_id NOT NULL` — **DB (unverified)** |
| `message.org = thread.org` | composite FK + trigger — **DB (unverified)** |
| a message may only name a parent in its own tenant | composite parent FK — **DB (unverified)** |
| an explicitly wrong tenant is refused, not corrected | trigger `RAISE` — **DB (unverified)** |
| direct id lookup is tenant-scoped | predicate — **proven, probe P1/P9** |
| parent lookup is tenant-scoped | predicate — **proven, probe P2/P3/P10** |
| `platform_message_id` lookup is tenant-scoped | predicate — **proven, probe P3** |
| update is tenant-scoped | predicate — **proven, probe P5** |
| tenant comes from session, never request body | `session.orgId` — **proven, probe P6** |
| no new send path created | Engagement remains evidence/history; no transport added |

"DB (unverified)" means written and content-pinned but never executed. §16.

---

## 14. Positive/negative tests, and the access matrix

26 tests in `backend/tests/unit/eng004EngagementMessageTenant.test.ts`. §A exercises a
faithful in-memory query builder — one that applies filters rather than returning a
canned row — so each isolation claim is a pair, and the counterfactual is asserted too:
*without* the predicate, tenant B's row **is** returned. That assertion is what stops the
harness being silently broken into vacuity.

| Operation | Tenant A → A | Tenant A → B | Tenant context required | DB enforced |
|---|---|---|---|---|
| direct message lookup | **PASS** | **BLOCK** | YES | partly — predicate proven; NOT NULL unverified |
| parent lookup | **PASS** | **BLOCK** | YES | FK written, **unverified** |
| `platform_message_id` lookup | **PASS** | **BLOCK** | YES | no — predicate only (and see G-23) |
| thread lookup | **PASS** | **BLOCK** | YES | composite FK written, **unverified** |
| insert | **PASS** | **BLOCK** | YES (from the thread) | trigger + FK written, **unverified** |
| update | **PASS** | **BLOCK** | YES | predicate proven; FK written, **unverified** |

The "DB enforced" column is where the brief's template said YES throughout. I have not
written YES where I did not run the database.

---

## 15. Mutation probes

Ten probes. Each asserts its anchor matches exactly once before writing — an injection
that changes zero bytes is not a probe — then runs the suite, restores from backup
unconditionally, and re-hashes.

| # | Injection | Result | Restored |
|---|---|---|---|
| P1 | direct-id lookup loses its tenant predicate | 1 failed | `41a3ea2fd0eeb457` ✓ |
| P2 | parent lookup loses its tenant predicate | **2 failed** | `41a3ea2fd0eeb457` ✓ |
| P3 | scraped platform-id parent lookup loses its predicate | 1 failed | `80430c7f3c55fb35` ✓ |
| P4 | composite tenant FK removed from the migration | 1 failed | `c3c5930edcd14a0a` ✓ |
| P5 | update path loses its tenant predicate | 1 failed | `80430c7f3c55fb35` ✓ |
| P6 | tenant read from the request body instead of the session | 1 failed | `80430c7f3c55fb35` ✓ |
| P7 | trigger silently corrects a mismatch instead of raising | 1 failed | `c3c5930edcd14a0a` ✓ |
| P8 | parent FK `ON DELETE SET NULL` loses its column list | 1 failed | `c3c5930edcd14a0a` ✓ |
| P9 | bulk `sendReply` loses its tenant predicate | 1 failed | `2d6fee79f937f3ca` ✓ |
| P10 | worker parent sweep loses its tenant bound | 1 failed | `fe25e866d935fa52` ✓ |

**A process failure worth recording.** The first probe run crashed between inject and
restore — jest printed box-drawing characters that cp1252 could not decode — and **left
P1's mutation on disk**. I noticed from the file-changed notice, restored from backup and
confirmed the hash. The runner now reads output as bytes and the restore is in a
`finally`, so a crash cannot leave an injection behind again. The probe table above is
from a clean re-run against final source.

**P4, P7 and P8 are source-level, not runtime.** They prove the migration *says* the
right thing. Proving the FK and trigger *behave* needs a database (§16). This is weaker
than a DB-backed probe and is labelled as such rather than counted as equivalent.

---

## 16. Non-production schema verification

**BLOCKED. Not substituted.**

| Check | Result |
|---|---|
| migration applies | **NOT RUN** |
| backfill count | **NOT RUN** |
| no null `organization_id` | **NOT RUN** |
| no thread/message tenant mismatch | **NOT RUN** |
| composite FK rejects a cross-tenant insert | **NOT RUN** |
| direct / parent / platform-id / update isolation at the DB | **NOT RUN** |

Why, precisely:

- The T2 harness (`scripts/ci/real-schema-ci.sh`) builds a disposable PostgreSQL and is
  the right venue — but it **requires Docker**, and the Docker daemon is not running.
- Starting it is not neutral. The recorded evidence is that bringing the daemon up
  auto-starts `omnivyra-worker` (compose project `virality`, restart policy on-failure),
  whose `SUPABASE_URL` and pooler URL point at the **managed production host**, and which
  was observed on 2026-09-11 running production crons (`leadThreadQueueCleanup`,
  `confidenceCalibration`) before being stopped. The brief requires production to remain
  untouched; starting a process that executes production cron jobs would not be that.
- No native PostgreSQL exists on this machine (`psql`, `pg_ctl`, `postgres` all absent;
  no `C:\Program Files\PostgreSQL`).
- The remote non-production project `lomndxmrpyudaegddpef` cannot be used: there is no DB
  password available for a direct connection, PostgREST cannot run DDL, and those two
  tables are empty there anyway.

**A mitigation exists and is the owner's to authorize:** start Docker and immediately
`docker stop omnivyra-worker`, accepting a brief window in which a production-connected
worker runs. I did not take that decision unilaterally.

---

## 17. Tests run

**21 suites, 463 tests, 463 passed, 0 failed.**

`eng004EngagementMessageTenant` (26 new), `eng003SesProviderEvents`,
`engagementBulkDispatchAcceptance`, `engagementDispatchRecoveryP1`,
`engagementAiActionabilityF5`, `engagementAiSendBoundaryF5`, `engagementAiDiversityF6`,
`engagementBulkDmClosureP11`, `engagementBulkGovernanceP12`, `engagementUnifiedSec001`,
`sec91AEngagementReplyDraft`, `engagementWorkQueueOwnership`, `piWs5ProspectEngagement`,
`ws3Milestone7Feedback`, `engagementActionabilityPaginationF1F2`,
`engagementDraftOwnershipP11`, `engagementRawThreadRouteF7`, `engagementQueueRules`,
`engagementCapabilityMap`, `engagementMultiAccountD4`, `engagementPlatformCountsD2`.

**Typecheck 3/3 clean. Route-auth PASS** (`comments.ts` was touched; the 2 KNOWN OPEN
findings are pre-existing).

**Not run:** whole-repo jest (not authorized), T2 real-schema (§16), T3, any deployment.

**Five fixture updates.** `engagementBulkDispatchAcceptance`,
`engagementAiActionabilityF5`, `engagementAiDiversityF6`, `engagementBulkGovernanceP12`
and `engagementBulkDmClosureP11` seeded threads with a tenant but messages without one.
Once the services filtered on `organization_id`, those rows stopped resolving — a fixture
problem, not a product defect. Each fixture now sets `organization_id` equal to the
thread's, which is the invariant the migration enforces, so the mocks model the schema
instead of contradicting it. No assertion was weakened.

---

## 18. Pre-existing failures

`ws3Milestone5aInternalDispatch` and `ws3Milestone5bExternalDispatch` remain failing (38
tests). Recorded as pre-existing before ENG-003, untouched here, not attributed to
ENG-004 and not opportunistically fixed.

---

## 19. IMPLEMENTED

`engagement_messages.organization_id` with backfill, abort-on-inconsistency validation
and NOT NULL · two supporting UNIQUE constraints · composite tenant FK on the thread
edge · **composite tenant FK on the parent edge** · a write-time trigger that derives the
tenant and raises on a mismatch · three tenant indexes · tenant predicates at nine read
sites including every `parent_message_id` and `platform_message_id` site · an explicit
tenant predicate on the extension update path · a thread-predicate tightening in
`autoReplyService` · 26 tests · 10 mutation probes.

## 20. VERIFIED

**At source/T1 level only:** 463/463 across 21 suites; typecheck 3/3; route-auth PASS;
10 probes behaving with byte-identical restores; the counterfactual asserted (no
predicate ⇒ the other tenant's row is returned).

## 21. BLOCKED

Non-production schema verification (§16) — Docker down, and starting it risks a
production-connected worker. Migration application — not authorized. Full remediation of
the remaining 18 id-based reads — **owner scope decision** (§1, §3). G-19 remediation —
owner decision (§10).

## 22. DEFERRED

Inbound email and everything ENG-005 owns · G-23 cross-tenant platform-id uniqueness ·
the `autoReplyService` signature change or deletion · G-22 replacement by authoritative
sender identity · `Reject → failed` vocabulary · unsubscribe→suppression · lifecycle
producers · reply sentiment · WhatsApp convergence · all intelligence layers.

## 23. UNVERIFIED

Whether the migration applies at all · real backfill, orphan, null-tenant and mismatch
counts · whether any production thread has a NULL `organization_id` · runtime behaviour
of both composite FKs and the trigger · `ON DELETE SET NULL (parent_message_id)` on this
engine · whether the 18 unhardened reads are reachable without a prior route-level tenant
check · whether `(platform, platform_message_id)` already holds cross-tenant duplicates.

---

## 24. Remaining gaps

**G-04 — PARTIALLY CLOSED.** Schema written (unverified); 9 of 27 reads hardened.
**G-19 — CHARACTERIZED, BLOCKING ENG-005.** §10.
**G-22 — OWNER DECISION REQUIRED.** §11.
**G-23 — NEW.** `idx_engagement_messages_platform_message_global` is UNIQUE on
`(platform, platform_message_id)` across tenants, so one tenant's row can make another's
insert fail with 23505 and the error discloses existence. Low likelihood for email
(SES ids are globally unique), wrong semantics regardless. Characterized, not changed.
**G-24 — NEW.** `engagement_threads.organization_id` is nullable, so untenanted threads
can exist and their messages cannot satisfy the invariant. The migration aborts rather
than inventing a tenant; resolving those rows is a data decision with an owner.

Unchanged and still open: G-02, G-06, G-09, G-13, G-17, G-18, G-20, G-21, plus every
intelligence gap.

---

## 25. Next authorized gate

**Not ENG-005 yet.** Three things should be settled first, and two of them are decisions
rather than work:

1. **The §1 scope decision** — whether the remaining 18 id-based reads are hardened now
   or accepted as route-guarded.
2. **G-19** — add an authoritative tenant parameter and route `autoReplyService` through
   Common Outreach, or delete it. Inbound email is what gives it a caller.
3. **Schema verification** — either authorize the Docker window with an immediate
   `docker stop omnivyra-worker`, or stand up the isolated environment W2 characterized.

Once those are closed, **ENG-005 — INBOUND EMAIL** may proceed as scoped.

---

**Production status: PRODUCTION UNTOUCHED.** No deployment, no migration applied
anywhere, no SES/SNS/DNS change, no flag change, no production read, no Docker daemon
started.
