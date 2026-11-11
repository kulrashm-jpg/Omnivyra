# Proposal: `contact_opt_out_reviews.enforced_channels`

Status: **PROPOSAL, for review.** Nothing is implemented or merged. Owner ruling E, 2026-11-08: "Prepare a separate migration and implementation proposal. The field must contain only channels with successfully persisted restriction blocks and must be a subset of `closed_channels`. Preserve existing data and semantics. No implementation or merge until the proposal is reviewed."

- **Prepared by:** Outreach (coordinator, `virality-52`).
- **Implementation owner:** Orchestration (`virality-c7`). It owns `contact_opt_out_reviews` and `backend/services/orchestration/optOutReview.ts`.
- **Unchanged:** the governance writer (`recordContactGovernance`) and `mayContact`. Both are PI's.

## 1. The discrepancy (measured at foundation head `aed1953c9`; `optOutReview.ts` is identical to `35b241c1f`)

| Line | What it does |
|---|---|
| `optOutReview.ts:749` | `closed = KNOWN_CHANNELS.filter((c) => !asked.includes(c))`: every known channel the admin did not reopen |
| `optOutReview.ts:704` | `channelsFor(anchor)`: a person anchor covers all channels; an email target covers `email`; a phone target covers `phone` and `whatsapp` |
| `optOutReview.ts:778` | Restriction rows are written only for `closed.filter((c) => channelsFor(a).includes(c))`, per anchor |
| `optOutReview.ts:821` | `closed_channels` is stored as the unfiltered `closed` |
| `pages/api/contact-optout-reviews/[id].ts:130,140` | The audit evidence and the API response report `closedChannels` as given |

**Consequence.** A review anchored only on a phone number, decided `keep_closed`, records `closed_channels = {email, phone, whatsapp}`. No email restriction row is written for it. The restrictions in force are correct; the record overstates them.

- This predates G-11 and is not a regression.
- Orchestration's held gap work (`ca5f3082f`) narrows the set to the review's held channels, but the per-anchor filter still applies after that.

## 2. Semantics

- **`closed_channels` keeps its meaning and its values:** the channels the admin chose to leave closed. It is not changed, reinterpreted or backfilled.
- **`enforced_channels` (new): the channels of `closed_channels` for which this decision confirmed a persisted restriction row on at least one of the review's anchors.**
  - A channel counts when `recordContactGovernance` returned, for that channel:
    - `created`; or
    - `already_present`, meaning an in-force row for that anchor, channel and type already existed (this review's own earlier close, or another source's).
  - A channel no anchor carries is never counted.
  - A thrown write aborts the decision, as today, so no decided row is written with an unpersisted channel.
- **It is a decision-time record, not a live status.** A restriction later revoked, lapsed or nulled by erasure does not change it. Anyone needing live state calls `mayContact`, which remains the only evaluator.
- **Legacy rows:** decided rows written before this change keep `enforced_channels = NULL`, meaning "not recorded". Readers must show NULL as unknown, never as "none" and never as equal to `closed_channels`.

**Decision point E-1 (recommend: count it).** Should an `already_present` row from another source count as enforced?
- It is a persisted, in-force block for that anchor and channel at decision time, so it meets the ruling's test.
- Excluding it would understate.

## 3. Migration (number assigned by Orchestration)

**Number: `20270129000000` (reserved by Orchestration, 2026-11-08).**
- Orchestration's `20270127` block is full: `0001`–`0006` are integrated, `0007` is held for the address/phone redaction design, `0008` is the guard hardening under review, and `0009` is held.
- `20270128*` is Outreach's.
- Orchestration opens a new block, `20270129000000`–`09`, and this takes its first slot.
- Checked free in:
  - the foundation reservations at `aed1953c9`;
  - Orchestration's `orch/c5-int`;
  - PI's `pi/ws-a1` and `feat/pi-erasure-g11-callsites`.
- PI's other branches await PI's confirmation.
- **Reserved:** Orchestration's reservations-only commit `7a34fa6ba`, merged into the foundation at `aa703406c`. `20270129000000` is slugged `opt_out_review_enforced_channels` (DESIGN_DECISION_REQUIRED); `000001`–`09` are unused.

**Schema:**
```sql
ALTER TABLE public.contact_opt_out_reviews
  ADD COLUMN IF NOT EXISTS enforced_channels text[];          -- nullable, no default: existing rows stay NULL

ALTER TABLE public.contact_opt_out_reviews
  ADD CONSTRAINT contact_opt_out_reviews_enforced_subset_of_closed
    CHECK (enforced_channels IS NULL OR enforced_channels <@ closed_channels),
  ADD CONSTRAINT contact_opt_out_reviews_enforced_only_when_decided
    CHECK (state = 'decided' OR enforced_channels IS NULL);
```

- **Known channels follow from the subset:** `closed_channels` is already CHECKed to `{email, phone, whatsapp}`.
- **No backfill.** Existing data is preserved. Section 7 lists an optional evidence-based backfill as a separate owner decision.
- **No guard-function change (recommended).** `contact_opt_out_reviews_guard` is replaced by `0003`, `0006` and the proposed `0008`, and touched by the held `0009`. Leaving it alone keeps this migration independent of their order.
  - The "a new decision always records the field" rule is held by the application and its tests (section 4).
  - If reviewers want it in the database, it belongs in the guard **after** `0008`/`0009` settle, as a follow-up: a pending→decided transition, or a changed `decided_at`, requires `enforced_channels IS NOT NULL`.
- **Privileges.** No new grant. A postcondition asserts that `anon` and `authenticated` have no SELECT on `enforced_channels`, matching the table's existing exposure. The postcondition also asserts that both CHECKs exist by name.
- **Rollback** (`rollbacks/opt_out_review_enforced_channels_rollback.sql`): drop both CHECKs, then the column. This loses only the new decision-time records, as the rollback header must state.
- **Hosted defaults.** The migration adds no table, so the hosted-Supabase default-privilege finding (`0004`) does not apply. The simulation pattern from `g11_0004_hosted_grants` is still used to show the postcondition holds when `service_role` holds ALL.

## 4. Implementation (Orchestration, `optOutReview.ts` and the route)

1. **In the close loop (`:777–790`),** collect `enforced`: add `channel` when `written.outcome` is `created` or `already_present`.
2. **In the decision write (`:817–826`),** add `enforced_channels: toPgTextArrayLiteral(KNOWN_CHANNELS.filter((c) => enforced.has(c)))`. Leave `closed_channels` unchanged.
3. **A re-decision** (rule 6: an admin may decide again) writes a fresh value from its own loop.
4. **The result type, `toReview` (`:390`, `:401`, `:426`) and the route:**
   - add `enforcedChannels`, mapped as `null` when NULL;
   - the audit evidence and API response add `enforced_channels` / `enforcedChannels`;
   - existing keys are unchanged, so no consumer breaks.
5. **`decision_race_lost` and `reconcile_incomplete` keep their behaviour.** A lost decision records nothing, so it records no `enforced_channels` either.

## 5. Tests (real schema, plus unit)

| # | Case | Expectation |
|---|---|---|
| T1 | Phone-target review, `keep_closed` | `closed_channels = {email,phone,whatsapp}`, `enforced_channels = {phone,whatsapp}` |
| T2 | Email-target review, `keep_closed` | `enforced_channels = {email}` |
| T3 | Person-anchored review | `enforced_channels = closed_channels` |
| T4 | Target review that adopted a person hold (mixed anchors) | union of the channels actually written per anchor |
| T5 | Reopen `whatsapp` on a phone target | `closed = {email,phone}`, `enforced = {phone}`; `whatsapp` absent from both |
| T6 | `already_present` row (own earlier close, and another source's) | counted, per E-1 |
| T7 | A governance write throws | no decided row; nothing recorded |
| T8 | Re-decision | the value is replaced by the new decision's |
| T9 | DB: `enforced ⊄ closed` | refused, 23514, by constraint name |
| T10 | DB: pending row with `enforced_channels` | refused, 23514 |
| T11 | Legacy decided row (NULL) | still reads; reported as unknown |
| T12 | Erasure (FK SET NULL, `0006` redaction) on a decided row | `enforced_channels` unchanged |
| T13 | Privileges | `anon`/`authenticated` have no SELECT on the column; hosted-ALL simulation passes the postcondition |
| T14 | Migration | forward, replay, rollback, rollback replay, re-apply |

**Negative controls (mutants, each must fail at least one test):**
- **M1:** write `closed` into `enforced_channels`. T1, T2 and T5 fail.
- **M2:** count only `created`. T6 fails.
- **M3:** drop the subset CHECK. T9 fails.
- **M4:** drop the pending CHECK. T10 fails.

## 6. Dependencies and ordering

- **Base:** the foundation head as it then stands. Independent of `ca5f3082f`, except a textual overlap in `decide()`. Whichever lands second rebases. The defined semantics hold either way, because `enforced` is collected from the writes actually made.
- **Independent of PI's restriction-time loader fix:** this proposal changes no evaluation.
- **No change** to `mayContact`, `recordContactGovernance` or any send path.

## 7. Owner decisions

- **E-1:** count `already_present` rows (recommended: yes).
- **E-2:** database enforcement of "a new decision records the field". Recommended: application-held now, with a guard follow-up after `0008`/`0009`.
- **E-3 (optional):** evidence-based backfill of legacy decided rows from the channels of their `closing_record_ids`. **Not recommended now:**
  - it would mix inferred and recorded values;
  - those ids cover only this review's own closes, not `already_present` rows.

No push, merge to main, deployment or production migration. Release remains NO-GO.
