# STRATEGIC-MIX-SPEC-004 — Content Adoption at Execution (R3-P2 + R3-P2.1)

**Status: CANONICAL AMENDMENT to SPEC-001/002/003.** Records R3-P2 as
implemented and the R3-P2.1 correctness revision (Release 3 freeze
semantics): APPROVED Content Workspace copy is the canonical publishing
source; generation is fallback only. Amendments continue as SPEC-005+.

---

## 1. Canonical content resolution

ONE pure resolver — `lib/campaign/workspaceContentResolution.ts`
(`resolveWorkspaceContent`) — decides, per plan row, whether workspace copy
publishes instead of generating. Resolution ladder (R3-P2.1):

1. `content_planning_status = 'approved'` + non-empty `draft_content.body` → **adopt** (the ONLY adoption tier)
2. `review` → **never adopted** (`review_not_eligible`). "Review" universally
   means "not yet approved"; the label and the execution consequence must
   agree (R3 Product Audit, critical issue #1). R3-P2 briefly adopted the
   review tier; R3-P2.1 removed it before any release. No exception paths.
3. `draft` / unknown status → **not eligible** (planning material)
4. no workspace fields / malformed envelope → **not adopted**, never throws

Adopted bodies publish **verbatim** (trimmed only). No re-adaptation: the
workspace produced platform-native copy at planning time; adapting again
would duplicate adaptation logic.

## 2. Consumers (both text lanes, no new pipeline)

- **`processBlockSchedule`** (inline lane → `scheduled_posts`): per-row
  resolution ahead of the pre-existing `variant → master` chain. Fully
  adopted cards skip the master AND variant LLM calls; mixed cards generate
  once for their non-adopted rows only. Long-form blog rows in fully adopted
  cards record the workspace body as the blog content (master = workspace).
- **`generateContentForDailyPlans`** (two-phase lane → row envelopes →
  `scheduleFromDailyPlans` batch insert): identical per-row resolution; the
  contentMap carries adopted bodies into the unchanged batch inserter.

Everything downstream is untouched: scheduler queue, enqueue, idempotency
keys, repurpose indexing, char-limit safety trim, same-platform dedup law,
schedule floor, retry/collision handling, publishing workers, creator-asset
override, assignment lifecycle, execution sync.

## 3. Ownership boundary

Execution READS `draft_content`/`content_planning_status` and never writes
them — the finalized envelope write-back spreads the prior envelope, so
planner-owned fields survive byte-identically (locked by characterization
BEFORE this change). Adopted rows additionally gain the execution-owned
audit markers `content_source: 'workspace'` + `content_source_tier`.

## 4. Manual edits

Manual edits are authoritative twice over: the planner refuses silent AI
overwrite (SPEC-003 §4), and at execution an approved manually-edited body
publishes verbatim — proven by simulation. Execution never regenerates
adopted content; regeneration happens only when the planner explicitly
requests it (workspace regenerate → status returns to draft → not adopted
until re-approved).

## 5. Backward compatibility

Rows without workspace fields resolve not-adopted and flow through the
byte-identical pre-R3-P2 path (locked by the 7-test characterization written
before the change). BOLT Text/Creator, Intelligent Mix, and all existing
campaigns are unchanged; the creator lane never consults the resolver.

### Change log vs SPEC-003
1. SPEC-003 §5's "execution does not yet read draft_content" is superseded:
   both text lanes now consume it through the single resolver (§1–2).
2. `content_source`/`content_source_tier` added to the finalized-envelope
   vocabulary (execution-owned, audit-only; the only tier value is
   `approved` as of R3-P2.1).
3. **R3-P2.1:** review-tier adoption removed pre-release. Approved is the
   sole execution candidate; Review and Draft are planning states only.
   Legacy/generation behavior byte-identical (block-processor
   characterization passed unchanged across the revision).

*STRATEGIC-MIX-SPEC-004 · records implemented behavior only.*
