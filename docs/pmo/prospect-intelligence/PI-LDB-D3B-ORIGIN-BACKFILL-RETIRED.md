# PI-LDB D3(b): origin backfill RETIRED (20270211000008)

**Owner ruling, 2026-11-11 (relayed by virality-e9): "0008 a".** Drop the
`'manual'` fallback for the backfill and RETIRE 20270211000008 entirely. It was
never applied anywhere.

## The evidence that decided it

These checks ran in production, read-only and owner-approved in virality-83's
tab:

- **C8:** every table and column the sizing query reads exists.
- **C9:** the result of `PI-LDB-ORIGIN-BACKFILL-DRYRUN-PRE0005.sql` is one
  bucket, `would_classify / classifyInboundLead / manual = 18`.

All 18 `lead_intelligence` rows trace to a `leads` row with no `form_id`,
`integration_id` or `visitor_session_id`. Each would have been labelled only by
the `ELSE 'manual'` fallback.

virality-05 FAILED that fallback as a correlate for historical rows. The
backfill infers the inbound path from "a leads row exists". It cannot tell
whether those three columns were absent then or simply not yet in use, and it
has no `mode` input. Without the fallback, 0008 labels 0 rows. A no-op migration
in the ledger would claim that something was done, so it is retired rather than
shipped.

## Consequences

- **Production rows:** the 18 rows keep `origin_category` NULL, meaning unknown.
  Under D3, unknown is honest and a guess is not. A later write that asserts a
  category supersedes the NULL through 0005's trigger.
- **Write-time path:** the ruling as relayed said "write-time unchanged". Two
  later steps, on fix/leads-webhook-auth-integration-20261111, have since
  touched the write-time classifier:
  - **739852a8e:** every `createLead` call site asserts `provenance_mode`
    explicitly. `'manual'` comes only from the manual-entry route asserting it.
  - **3e3aa7ef0 (e9 decision, 2026-11-11):** `classifyInboundLead`'s no-signal
    fallback changed from `'manual'` to NULL (unknown). The guard test proves no
    production call site reaches it, so current behaviour does not change.
  - Because this changes code the owner's ruling named, it was put to the
    owner separately: **owner-approved 2026-11-11** (relayed by virality-e9).
- **Basis-2 caveat (virality-05), and its date boundary.** For any future backfill:
  `prospect_source_contributions.source_category` is only as reliable as the
  mode that chose its profile. The caveat is time-bounded; it is not general
  distrust of the column:
  - **Before `739852a8e`:** inbound-lead contributions may carry a
    fallback-derived `manual`. In particular, a website capture whose visitor
    session did not resolve was labelled `manual` and should read `website`.
    This mislabel can be identified (website-path rows written before that
    commit and labelled `manual`), so correcting it later remains possible.
  - **From `739852a8e`:** every `createLead` call site asserts its mode. That is
    the operative boundary, because the live mislabel stopped there.
  - **`3e3aa7ef0` / `8d162b8bb`** are the backstop. A caller that does not
    assert gets unknown (no contribution), and that case is reported on the
    failure channel.
  - Contributions written after the boundary are a sound basis. Do not rule out
    a future backfill on them because of this caveat.
- **Version 20270211000008: RETIRED and SPENT, never to be reused.** virality-83
  set this in the registry (f3f08b525, 056cf224f), at virality-05's request. The
  number was reviewed and referenced across sessions, so reusing it would put two
  artefacts under one version.
- **Files removed** after that mark: the migration, its rollback
  (`rollbacks/pi_ldb_origin_category_backfill_rollback.sql`), and
  `backend/tests/realschema/pildb_origin_backfill.test.ts`. The text of all
  three survives in history at 5c1ceeefc..83e614fcb.
- **Kept as evidence:** the two dry-run SQL files in this folder. They are the
  instruments behind C9.

## Kept from the 0008 work

- **f50cf4a15 / 8375c1c7b:** 0005's no-backfill guard now asserts that this run
  filled nothing, so 0005 stays re-runnable after write-time classification.
- **b9cd2b703:** the batching-counter fix. It is moot with the file retired, but
  the pattern is reviewed (count the UPDATE, upsert the snapshot) for any future
  batched backfill.
