# Outreach foundation: follow-up register

Work discovered after the five-checkpoint sequence (`PROGRAMME-DASHBOARD.md`). These items do not rewrite or substitute for that sequence. As of 2026-11-09, foundation head `ae88fe6bc` before this docs commit (earlier: `aa703406c`) (local, unpushed). **Release: NO-GO.**

## Summary

| ID | Item | Owner | State | Exact references |
|---|---|---|---|---|
| FU-G1 | Hosted-Supabase default grants on `contact_enrolment_closures` (`0004`) | Orchestration | **Integrated locally**, owner ruling B | `5e4ad5527` + `069bfd953`, merged at `bdc45d8d2` |
| FU-G2 | Orchestration G-11 gap work | Orchestration; PI for the fingerprints | **Held** | `ca5f3082f` |
| FU-G3 | `enforced_channels` | Orchestration (implements); Outreach (spec) | **Proposal**, awaiting owner review | `ENFORCED-CHANNELS-PROPOSAL.md`; version `20270129000000` reserved (FU-G9) |
| FU-G9 | Orchestration migration block `20270129000000`–`09` | Orchestration | **Integrated locally**: reservations only, no migration file | `7a34fa6ba` merged at `aa703406c` |
| FU-G4 | WhatsApp broadcast recipient person | Outreach; Orchestration (adapter) | **Integrated locally** | `a37bb85f4` → `5829c6f9d`; `c36a112df` → `f89277e66` |
| FU-G5 | Decided-reason redaction `0006` | Orchestration; PI (policy row) | **Integrated locally** | `e3cc7f877`, `35b241c1f` → `6e8d763bb` |
| FU-G6 | Address/phone-anchored redaction `0007` | Orchestration | **Design queue** (ruling F). Orchestration has built an uncommitted draft on `ca5f3082f`, sent to PI for review; not integrated | `refs/preserve/orch-c5-g11-0007-wip`, diff `4d04f4f7…` |
| FU-G7 | Guard hardening `0008` | Orchestration | **Untouched; outside the integration branch** (ruling G); in the review queue | re-cut diff `54a921a6…` on `35b241c1f` (applies there; on the foundation only `version-reservations.json` conflicts, by adjacency). Earlier cut `e66d203f` on `ca5f3082f` superseded |
| FU-G8 | Block re-deciding `0009` | Orchestration | **Held** until PI's finalize-erasure marker exists | — |
| FU-P1 | Restriction-time fail-open (clock skew) | PI | **Authorised for PI** (ruling C). PI's package is **pending review, not a completed implementation** (owner, 2026-11-08) | `contactGovernance.ts:201`; PI worktree `C:/tmp/pi-cg-clock` on `23a0a586` |
| FU-P2 | Restriction-time fail-open (text comparison) | PI | Same fix as FU-P1 | `contactGovernance.ts:201`, `contactGovernanceRepository.ts:71` |
| FU-P3 | Outreach callers to pass the loader's time | Outreach | **Not authorised** (ruling D) | `whatsappBroadcastService.ts:431`, `:580` |
| FU-O1 | Reopen time stamped from the app clock | Orchestration | Fix in progress; comes to Outreach as its own patch | — |
| FU-D1 | `merge_unified_persons` while the loser holds live person governance | PI | **Design queue**; Orchestration reports its owner ruled "refuse with a named error", not confirmed by this owner | — |
| FU-D2 | Quota release for restricted recipients | Outreach | **Design queue**; contract is queue-based | — |
| FU-D3 | Recipient personal-data erasure | PI + Outreach | **Design queue**; policy approved | — |
| FU-W1 | Community acting-account proof (Work Item 1) + closure A | Outreach; Orchestration (closure B) | **Held, not merged** until closure B is done and reviewed | `8e4d9edb0`, `a5ea2d95b` on `outreach/community-acting-account` |
| FU-W1B | Closure B: the acting account inside the passkey-signed approval binding | Orchestration's owner | **Blocked** on Orchestration's owner; raised again 2026-11-08 | `communityApprovalBinding.ts` |
| FU-W2 | WhatsApp send-once (Work Item 2, L-4) | Outreach | **Integrated locally**, combined T2 with 0 new failures | `d37ebefed` merged at `ae88fe6bc` |
| FU-W2A | Adapter: represent `WhatsAppEnqueueUncertainError` as uncertain | Orchestration | **Request sent** (owner-approved); not started, needs Orchestration's owner | `whatsappEngineAdapter` |
| FU-RA | Reply-assistance enablement prerequisites RA-1..RA-7 | Several (see the decision record) | **Recorded, none implemented** | `OWNER-DECISIONS-20261108-REPLY-ASSISTANCE.md` |
| FU-OWN | Owners of `outreach_decisions` and `engagement_authors` | Programme owner | **Unassigned**; not to be assumed | same |

## FU-G1: `0004` hosted-grant fix

**Problem.** Hosted Supabase is assumed, not measured, to give `service_role` ALL on a new table. `0004`'s postcondition forbids DELETE, so `0004` would RAISE at apply time.

**Fix.** `REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON public.contact_enrolment_closures FROM service_role;`
- MAINTAIN is included by Orchestration's owner ruling.
- PG17-only syntax: production runs 17.6 and CI runs PG17.

**Integration (owner ruling B):**
- Merge `bdc45d8d2` (parents `aed1953c9`, `069bfd953`).
- Pair diff sha256 `85fac3a1…`. Diffs: `5e4ad5527` = `e1144be8…`, `069bfd953` = `660a7c2a…`.
- Both files are blob-identical to `069bfd953`.
- Preserve refs:
  - `refs/preserve/outreach-foundation-pre-0004grant` = `aed1953c9`;
  - `refs/preserve/outreach-foundation-0004grant` = `bdc45d8d2`;
  - `refs/preserve/orch-c5-0004-grant-5e4ad552`;
  - `refs/preserve/orch-c5-0004-grant-069bfd95`.

**Verification at `bdc45d8d2`:**

| Check | Result |
|---|---|
| Real-schema suites (`g11_0004_hosted_grants`, `g11_optout_review`, `g11_reason_redaction`, `g11_outreach_producers`, `whatsapp_broadcast_person_restriction`, `orch_engines_real`) | **133/133**, including hosted-grant 6/6 and G-11 64/64 |
| `0004` migration on a disposable database (136 migrations) | replay on an applied database, rollback (table gone), rollback replay, re-apply: all OK |
| Mutant: MAINTAIN dropped from the fix line | hosted-grant suite fails 5/6; restored byte-identical |
| Mutant: fix line removed | hosted-grant suite fails 5/6; restored byte-identical. The first attempt was invalid (pg-sandbox start failed on a reused port) and was re-run |
| migration-quality | the same violations as the baseline (the known 23, GD-4) |
| Tree | `bdc45d8d2`, clean before and after |

Caveat: the hosted default is ASSUMED, not measured against hosted Supabase. Both mutants also trip the suite's text-extraction test, so part of the kill is textual. In the line-removed mutant, the "with the fix" behavioural test (postcondition) also fails.

## FU-G2: `ca5f3082f`

- Channel-scoped operator opt-out, `contact_suppressed`, and the reopen matrix.
- Also carries four PI fingerprint updates (034/036/037/040) that need independent PI review.
- **Known defect:** `orch_contract_journey` ("a person opted out of everything is not contacted through community") is stale against its own A4 gate. Orchestration is sending a test-only fix as its own commit.
- Held pending owner authorisation.

## FU-G3: `enforced_channels`

**Discrepancy, confirmed in the code at the foundation:**
- `optOutReview.ts:749` closes every unrequested known channel.
- `:778` writes restriction rows only for the channels each anchor carries.
- `:821` stores the unfiltered set as `closed_channels`.

**Effect.** A phone-target review records `email` as closed with no email row. The restrictions themselves are correct; the record overstates them.
- This predates G-11.
- The foundation, without `ca5f3082f`, overstates more than the gap branch.

**Approved direction (owner ruling E):**
- a separate field containing only channels with successfully persisted restriction blocks;
- the field is a subset of `closed_channels`;
- existing data and semantics are preserved;
- no implementation or merge until the proposal is reviewed.

**Proposal:** `ENFORCED-CHANNELS-PROPOSAL.md`.

## FU-G4: WhatsApp broadcast person-level restriction

See the register section "Redaction and WhatsApp broadcast fix integrated".
- Focused real-schema 141/141.
- Combined T2 at `f89277e66`.

## FU-P1 / FU-P2: restriction-time fail-open (PI, P0 for PI's owner)

**Defects:**
1. **Clock skew.** `isInForce` compares a DB-stamped `effective_from` with the caller's JS time. When the app clock is behind, a just-recorded STOP, unsubscribe or opt-out reads as not yet in force, and `mayContact` permits contact.
   - Measured by Orchestration on the sandbox: Node behind Postgres in 1458 of 1485 samples, by up to 1.9 ms.
   - The skew between Railway and Supabase in production is unmeasured.
2. **Text comparison.** `contactGovernance.ts:201` compares strings. The repository passes DB values through raw (`contactGovernanceRepository.ts:71`), while callers pass `toISOString()`.
   - With UTC offsets the error is sub-millisecond: `….123456+00:00` sorts before `….123Z`, so a hold lapses about 456 µs early. This is Outreach's correction, accepted by PI.
   - With a non-UTC offset it is hour-scale: a 5.5 h fail-open in Outreach's worked example.
   - The test fixtures are all JS-format, and the real-schema suites mock the PostgREST read seam (55 mock `writeOwner`, 39 mock `supabaseClient`). So no suite saw the production format.

**PI's revised ruling, authorised by this owner (ruling C) and independently by PI's owner:**
- The comparison stays only in `mayContact`. SQL comparison is rejected.
- The loader returns the DB's `now()` in the same query as the rows. Callers pass it through.
- Both sides are converted to **integer epoch microseconds**: offset normalised, 6 fractional digits, safe-integer validated.
  - `Date.parse` alone truncates to milliseconds and leaves a sub-millisecond fail-open; that was Outreach's point, accepted by PI.
- Any unexpected format, offset or value **fails closed**. The session-timezone measurement stays as a tripwire.
- Conservative rounding is recorded as a principle only, not implemented, so it cannot read as a tolerance.
- **Tests:** the microsecond and non-UTC cases with DB-format fixtures. Mutants (string comparison restored, millisecond precision, offsets ignored) must fail.

**PI's delivery:**
- Worktree `C:/tmp/pi-cg-clock`, branch `fix/pi-contact-governance-clock`, base `23a0a586`.
- PI's owner forbids PI to commit. PI offers instead:
  - the diff sha256 against the base;
  - per-file sha256 and CR counts;
  - T1 and mutation evidence;
  - the written loader contract.

**Owner position (2026-11-08):** PI's package is treated as **pending review, not a completed implementation**. The Outreach call sites stay unchanged.

**Base check by Outreach:**
- `contactGovernance*.ts` and `contactGovernanceRepository.ts` are byte-identical between `23a0a586` and the foundation.
- The foundation has 3 governance callers that main lacks, all Orchestration's: `individualIntelligence.ts`, `journeyPolicy.ts`, `journeyResponses.ts`. Reported to PI and Orchestration.

## FU-P3: Outreach call sites

- `whatsappBroadcastService.ts:431` (enqueue screening) and `:580` (`processBatch`) pass a JS time today.
- **Not to be changed** until PI delivers and this owner authorises separately (ruling D).
- **Contract:** each evaluation, every send and every retry, uses the time returned with its own loader read, never a cached one.

## FU-O1: reopen time (Orchestration)

- An admin reopen of a manual closure stamps `reopened_at` from JS, while `closed_at` is DB-stamped.
- A CHECK can then refuse a legitimate reopen with a 503.
- Fix: stamp `reopened_at` in the DB. It comes to Outreach for review as its own patch.

## FU-D1..D3: design queue (ruling F; no implementation authorised)

- **FU-D1 `merge_unified_persons`.** The `0006` redaction fires on any person-row delete, including a merge. PI's options:
  - refuse the merge while the loser holds live person-anchored governance; Orchestration reports its owner chose this;
  - re-assert the holds on the survivor.
- **FU-D2 quota release.** `checkAndConsume` is a daily Redis counter per `phone_number_id`, incremented at enqueue. There is no reservation, settlement or billing, and the RPC `increment_wa_usage` does not exist. A release mechanism would be new design. Since FU-G4, recipients already restricted at enqueue are not counted.
- **FU-D3 recipient personal-data erasure.** `contact_name`, `encrypted_phone` and `hashed_phone` are read only by `whatsappBroadcastService`. Suppression lives in `contact_governance_records`. Retention, consumers, queued/sent/failed behaviour, idempotency and tenant isolation must be established first.
- **FU-G6 address/phone redaction (`0007`).** Open: whether `pre_existing` holds count (recommended: no), and a separate function versus extending the re-anchor.

## Not merged and not to be merged in this integration

- `0007` and `0008` (ruling G).
- `ca5f3082f` and its test fix.
- The four PI fingerprint updates.
- `0009`.
