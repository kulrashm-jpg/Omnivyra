# STRATEGIC-MIX-SPEC-002 — Implemented Architecture Record

**Status: CANONICAL AMENDMENT to SPEC-001.** This document records the architecture Strategic
Mix actually shipped across Release 1 (P0–P7) and Release 2 (R2-P1…R2-P5). It documents ONLY
implemented behavior — no planned features. Where the enacted design refined SPEC-001's written
vocabulary, this amendment is the record SPEC-001 §8 (I-11) requires. Change log at the end.

---

## 1. Campaign Operating System

Strategic Mix is the system of record and control for campaigns: one canonical identity
(`/campaign-planner?mode=direct` — every nav surface routes there; generator modes may not claim
the name, I-12), composing the existing pipeline stages rather than adding a generator. One
execution engine, one asset model, one assignment model, one persistence seam — verified by
architecture audit and enforced by source-scan governance tests.

## 2. Draft-first model (shipped P1)

Entering Strategic Mix creates or resumes a server Draft Campaign (`campaigns` row,
`status='draft'`, `thread_id 'planner_draft_%'` as the resume key) before any other write. All
planner state lives in the campaign's `campaign_versions` snapshot as `planner_state` with a
monotonic `planner_state_revision`; every save carries `baseRevision`, and a mismatch returns
409 with the winning server copy — the loser adopts it wholesale (deterministic, multi-tab and
multi-device safe). Browser storage is a latency cache only. The Draft Status indicator
(R2-P5) surfaces this same lifecycle: Saving… / Saved / Syncing… / Sync failed / Offline —
derived from the existing events, no second tracker.

## 3. Asset Library (shipped P2)

`creator_assets` evolved into the canonical library — one model, no second table. The versioned
`CreatorAsset` envelope (versions[], currentVersion, metadata) lives in a `library` jsonb
column; flat columns sync from the current version so every legacy reader is unchanged. Legacy
rows synthesize a v1 envelope on read. Server columns: `archived_at`, `deleted_at` (soft
delete), `usage_count`, `last_used_at`. localStorage is a write-through cache (its cap bounds
the cache, never history) with one-time transparent migration. Library UI at
`/command-center/creator-content/library`; import into campaigns is by reference — an
assignment may pin a version (`asset_version`), otherwise it follows the current one.

## 4. Assignment model (shipped P3)

Assignment is the ONLY structure↔content relationship (I-3). Entity fields: id, campaign_id,
asset_id (+optional version pin), structure_id (the slot's `execution_id`, else a deterministic
week/day/platform/type key), week, day, platform, content_type, publication slot, status,
approval, notes, ordering, timestamps, plus execution-owned sync fields (§7). All operations
are pure functions over the array (assign / unassign / bulk / move / duplicate / replace /
reorder / metadata patch); assets are referenced, never embedded; deleting an assignment never
deletes an asset; one asset serves any number of assignments. Assignments persist inside
`planner_state.assignments` through the P1 seam (I-7 — no new substrate).

**Enacted lifecycle (amends SPEC-001 §5.2's draft vocabulary):**
`draft → ready → confirmed → materialized → scheduled → publishing → published → archived`.
Planning owns the first three; execution owns the rest. `advanceAssignmentStatus` is
forward-only and the sole door into execution states. `orphaned` is a DERIVED condition
(detected and surfaced on the Board), not a stored state.

## 5. Approval workflow (shipped R2-P1)

Approval is a planning-owned Assignment property: `not_required | pending | approved |
rejected`, absent on legacy assignments (byte-identical reload). `setAssignmentApproval` is the
only mutation door — lock-guarded, unreachable by AI, outside the metadata patch. Company
enablement via `companies.require_assignment_approval` (default false; existing tenants
unchanged), read through `/api/companies/approval-settings` and the shared hook (fail-closed).
When enabled, only approved (or explicitly not_required) confirmed assignments materialize;
pending/rejected/unset skip as blocking issues and stay editable. The Board carries the
approvals panel (counts, blockers linked to Alignment, the company toggle).

## 6. Execution handoff (shipped P4)

Confirmed assignments are the canonical source for execution. At finalize, the client resolves
the library and materializes: one PRIMARY assignment per slot (lowest ordering) enriches the
matched calendar activity with `creator_asset` + `content_status='READY_FOR_PROMOTION'` — the
exact fields the existing scheduler already consumes as an asset override. Both finalize slot
paths (adapter and inline) pass them through; the version snapshot records the assignment set
for audit. Validation before handoff: asset existence, slot existence, campaign ownership,
content-type family compatibility, scheduling integrity (no duplicate asset per platform+day),
approvals (§5). Blocked assignments skip — partial campaigns finalize; unassigned slots flow to
normal generation. The execution pipeline itself is unchanged.

## 7. Execution synchronization (shipped P5, durable P7)

The engine remains the sole execution authority; Strategic Mix observes it. Events
(scheduled-post created, scheduling completed, publish started/completed/failed, archive
completed) are DERIVED on demand from the canonical records (`daily_content_plans.execution_id`
/ `scheduled_post_id` linkage, `scheduled_posts.status/error/published_at`, campaign
completion) — no polling, no timers, no second lifecycle store. The pure reducer
`applyExecutionEvents` folds them onto assignments: deterministic ordering, idempotent
(object-identity-preserving replays), forward-only, publish failure recorded SEPARATELY
(`execution_failure`, cleared by a later success) so lifecycle is never destroyed. It writes
execution-owned fields only (status, scheduled_post_id, execution_failure, execution_synced_at).
P7 runs the same fold server-side inside the events route and persists on change only, guarded
by an unchanged `planner_state_revision` (never bumped — sync never invalidates an editing
session; a concurrent planner save wins and the next load re-persists). Persisted state is a
cached projection, always reconstructible.

## 8. Campaign Board (shipped P6)

A pure projection that owns nothing: structure coverage (per-week/platform), content coverage,
assignment distribution, execution aggregation (failures, stalled), approvals, and a
deterministic Campaign Health (empty/blocked/attention/ready; coverage/scheduling/publishing/
completion percentages; mean execution progress). Every issue links to its resolution surface
(Structure / Content / Alignment) with the source entity ref; navigation switches tabs inside
one session provider so no state is lost. The AI summary is a deterministic, read-only
narrative. Board is the landing surface for existing campaigns (R2-P5 Part A); the new-campaign
flow still opens on Structure, and a fresh session presents the two-door entry
(Structure / Content as unordered peers, one shared draft, converging on the Board).

## 9. Per-item lock doctrine (shipped P4 planning-layer; R2-P2 scheduling-layer, flag-gated)

Planning layer: assignments in execution states are individually immutable (unassign / move /
replace / reorder / metadata are no-ops on them); everything else stays editable; duplicates of
locked items are fresh planning copies. Scheduling layer: `assertBlueprintMutable` keeps its
API and callers but gains the canonical decision model behind `BLUEPRINT_PER_ITEM_LOCKS`
(default off — legacy blanket freeze remains until the flag flips): an item protects the
blueprint only when publishing/published or inside ITS OWN 24h freeze window
(scheduled/failed-retryable; cancelled/draft/blocked never); campaign status never
blanket-freezes; scoped operations pass `affectedSlots` and evaluate only what they touch.

## 10. Full-move rescheduling (shipped R2-P3)

The existing reschedule endpoint moves items across week / day / platform / publication slot
(individually or combined), for scheduled and unscheduled items. Moves require a landing time,
enforce the now+1h floor, delegate eligibility to the blueprint lock guard
(`affectedSlots=[execution_id]` — whichever doctrine is active), validate platform capability
fail-closed through the canonical resolvers, enforce one-post-per-platform-per-day against the
target slot, re-resolve the social account on platform moves, and ride the existing atomic
queue re-enqueue. Legacy requests (no move fields) are byte-identical.

## 11. Canonical stage model (shipped R2-P4)

`resolveCampaignStage` is the ONLY approved lifecycle interpretation in Strategic Mix — a pure
resolver over the unchanged physical axes with the closed vocabulary
`draft planning alignment review scheduling ready executing completed paused archived`
(paused/archived also as orthogonal flags). Precedence is most-terminal-first; explicit
`execution_status='ACTIVE'` alone means executing; unknown free-text values are contained
(→ planning), never propagated; planning-space hints refine draft/planning into
alignment/review only. A writer gate (source-scan tests over the Strategic Mix module set)
fails CI on raw-axis interpretation or new `current_stage` vocabulary. Physical column
consolidation was deliberately NOT performed.

## 12. Release 2 architecture summary

R2-P1 approvals · R2-P2 per-item lock doctrine (flag) · R2-P3 full-move rescheduling ·
R2-P4 canonical stage read model + writer gate · R2-P5 Board-as-home, Draft Status, two-door
entry, this document. Every phase: characterization tests before change, pure logic in
`lib/campaign`, no new persistence substrates, flags/opt-ins defaulting to legacy behavior.

---

### Change log vs SPEC-001

1. §5.2 Assignment FSM vocabulary replaced by the enacted 8-state lifecycle (see §4);
   `orphaned` is derived, `detached` is deletion of the relationship.
2. §5.2 Approvals implemented at link-time on Assignments with a per-company flag (§5); the
   pre-publish variant remains the pre-existing version-based routing mechanism, unchanged.
3. §2 lock doctrine implemented per-item at the assignment layer unconditionally and at the
   scheduling layer behind `BLUEPRINT_PER_ITEM_LOCKS` (§9).
4. §5.1 delivered as the read-selector + writer gate (§11); physical consolidation not
   performed (explicitly out of scope in R2-P4).
5. Stage vocabulary extends SPEC-001's §5.1 list with nothing; `review` maps to the Board
   surface, `alignment` to assignment work — both derived from planner-session signals.

*STRATEGIC-MIX-SPEC-002 · records implemented behavior only · amendments continue as SPEC-003+.*
