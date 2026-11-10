# Release gate: owner register (recovery records, decisions, prerequisites)

Working record for the owner. Fill in the blank fields; do not delete rows. Nothing in this file is
production evidence until a field says where the evidence file is. Companion documents:
`sql-recovery-checklist.md` (how to search and export), `release-gate-production-verification-plan.md`
(§0.1 credential, §3 session steps, §4 hashes).

Status at the time of writing: **NO-GO**. No production session has taken place.

## 1. SQL recovery records

Intake tool: `node scripts/release/recovery-intake.js <fix3|revoke8|close_anon> <file> --source "<list> / <name>"
--observed-at "<displayed time + timezone>" --exported-at "<UTC>" [--author "<as shown>"] --out <file>.intake.json`.

- Exit codes: `0` BYTE_IDENTICAL, `10` IDENTICAL_AFTER_EOL_NORMALIZATION, `11` DIFFERENT,
  `12` NO_REFERENCE_TEXT, `3` REFERENCE_HASH_MISMATCH (the checkout is wrong — fix it, not a verdict), `2` usage error.
- It refuses to overwrite an existing evidence file.
- A verdict compares **text only**. It is not evidence that the text was executed, nor that the current
  database matches; the catalog snapshot (plan §B1/B2) answers the second question.
- An artifact is recorded UNRECOVERABLE only after every place in checklist §2 has been searched across the
  wider window, and each place is listed below as searched.

### Record 1: FIX3 `20261212000000`

| Field | Value |
|---|---|
| Committed reference | `supabase/migrations/20261212000000_content_quality_collaboration_tenant_consistent.sql`, sha256 `581926201d268d5bde34b6a6b7be4ee118bac3ed8d62ef88756e7030b2d445d5` |
| Reported execution | [owner-reported] applied 2026-10-23; time and tool unrecorded |
| Primary window (UTC) | 2026-10-22 18:30 → 2026-10-24 18:30 |
| Wider window (UTC) | 2026-10-12 → 2026-10-28 |
| Search strings | `content_quality_collaboration_tenant_consistent`, `20261212000000`, `FIX3`, `content_approval_history`, `omnivyra_touch_updated_at` |
| Local records searched (agent, 2026-10-29) | repo history and all refs, PR #318 comments, CI artifacts, session scratchpads, `~/.bash_history`, PowerShell history, and all 574 local Claude Code session transcripts under `~/.claude/projects` (2026-10-29, read-only, credentials redacted). **No executed text and no apply record found.** In the primary window the only hit is the 2026-10-23 04:12Z commit command; the owner's 11:08Z "i applied that migration" (session `117745fb`) refers to `20261220000000`, not FIX3. **Local search: completed, no result.** |
| Dashboard places searched (owner) | History: ☐ · Private: ☐ · Shared: ☐ · Favorites: ☐ · restored tabs: ☐ |
| Exported file(s) / intake record(s) | |
| Verdict | ☐ RECOVERED: `________` ☐ UNRECOVERABLE |
| Searched by / date | |

### Record 2: 8-table `authenticated` revoke

Tables: `brand_memory`, `content`, `content_asset`, `content_memory`, `content_originality`, `content_revision`,
`content_variant`, `publication_lineage`.

| Field | Value |
|---|---|
| Committed reference | **None exists** in any ref, PR, artifact or doc. Do not write one. |
| Reported execution | [owner-reported] memory note `project_fix3_verified_prod_20261028` (modified 2026-10-28 16:05Z); time, tool and exact privileges unrecorded |
| Primary window (UTC) | 2026-10-23 00:00 → 2026-10-28 16:05 |
| Wider window (UTC) | 2026-10-12 → 2026-10-28 23:59 |
| Search strings | `REVOKE`, `FROM authenticated`, `brand_memory`, `publication_lineage`, `content_originality`, `content_variant`, `content_revision` |
| Local records searched (agent, 2026-10-29) | same sources as Record 1. **No execution record found.** Found instead: the revoke text **proposed to the owner** in session `117745fb` (three variants, 2026-10-28 13:06Z, 13:43Z and 15:25Z; the 15:25Z one adds a transaction and a self-verifying `DO` block), and the owner's own **outcome attestation** at 16:01:57Z: "`authenticated` has no `SELECT`, `INSERT`, `UPDATE`, or `DELETE` privileges on the eight Phase-A content tables; `service_role` retains all four". |
| Candidate texts (NOT execution records) | `C:/omnivyra-archive/evidence/release-gate-20261029/revoke8-candidate-2026-10-28T130602062Z.sql` (sha256 `39c36030…`), `…134350047Z.sql` (`867d6618…`), `…152512311Z.sql` (`3d9fe0c2…`), each with a `.provenance.json`. Which variant (if any) was run is not recorded. Not run through `recovery-intake.js`, because a `NO_REFERENCE_TEXT` record would make a proposal the reference. |
| Dashboard places searched (owner) | History: ☐ · Private: ☐ · Shared: ☐ · Favorites: ☐ · restored tabs: ☐ |
| Exported file(s) / intake record(s) | (verdict will be `NO_REFERENCE_TEXT`; the file becomes the record) |
| Verdict | ☐ RECOVERED (becomes the record) ☐ UNRECOVERABLE — only the resulting access lists can be checked (C1) |
| Searched by / date | |

### Record 3: close_anon `20261026000000` (PR #239)

| Field | Value |
|---|---|
| Committed reference | `supabase/migrations/20261026000000_close_anon_rls_exposure.sql`, sha256 `62e2371990ee020d255c9415bf3a76a7063e64f874b42d92364d3d37a589fc82` |
| Reported execution | [owner-reported] 2026-09-13 21:03:48Z with `psql -1 -f` (memory `project_prod_rls_anon_exposure`); file not hashed at apply time |
| Primary window (UTC) | 2026-09-13 18:00 → 2026-09-14 00:00 |
| Wider window (UTC) | 2026-09-10 → 2026-09-20 |
| Search strings | `close_anon`, `20261026000000`, `REVOKE ALL`, `ALTER DEFAULT PRIVILEGES`, `FROM anon` |
| Local records searched (agent, 2026-10-29) | as Record 1, plus `~/.bash_history` (13 lines) and the PowerShell PSReadLine history (2,536 lines): **0 matches** for `close_anon`, `20261026000000`, `psql … -1 … -f`. Transcripts: the 1,058 records in the primary window all belong to session `9b0c8cea`, which starts at 21:33Z, after the reported 21:03Z apply, and only quotes memory; the applying session (`49da8415`) has no surviving transcript or scratchpad. Later `psql`/`close_anon` hits (09-26, 10-19, 10-28) are reads of the file. **Local search: completed, no result.** |
| Other execution records (owner) | any terminal log or history from the machine that ran psql on 2026-09-13: ☐ |
| Dashboard places searched (owner) | History: ☐ · Private: ☐ · Shared: ☐ · Favorites: ☐ (a hit is unlikely: it was run with psql) |
| Exported file(s) / intake record(s) | |
| Verdict | ☐ RECOVERED: `________` ☐ UNRECOVERABLE |
| Searched by / date | |

## 2. Decision register

### Decision A: historical SQL that cannot be recovered

Current-state evidence cannot prove which SQL text ran, in what order, or whether anything changed the
result afterwards.

- ☐ **A1.** Accept current semantic equivalence with an explicit historical-evidence gap. Requires, per
  script: the production catalog snapshot (§B1) and grant snapshot (§C1) compared with the expected state
  (§B2), every difference listed, and written acceptance. The record reads *"Executed SQL text unrecoverable
  from available evidence; exact historical equivalence is unprovable."* For the 8-table revoke the expected
  state is a hypothesis built from the owner's description.
- ☐ **A2.** Require the exact historical SQL. Any script that cannot be recovered keeps blocker B at NO-GO.
  For close_anon (run with psql) this is likely permanent.

Decided by / date: ____________

### Decision B: pre-existing schema-parity findings

Source: the strict parity run on the **throwaway** database (`verify-schema-parity.js --strict`, exit 3,
0 BLOCKING). **Production status is UNKNOWN** until the production baseline (§A2) runs. Reasons in quotes are
the verifier's own manifest text.

| Group | Exact items | Notes |
|---|---|---|
| 16 INFO | `active_leads`: `organization_id`, `contact_id`, `opportunity_type`, `status`, `owner_user_id`, `icp_score`, `confidence_score`, `total_score`, `source_platforms`, `signal_count`, `last_activity_at`, `company_name`, `snoozed_until`, `status_changed_at`, `status_changed_by`; and `opportunity_feed_items.active_lead_id` | [memory] production `active_leads` is the legacy design; `20260817_active_leads_object_model.sql` (`CREATE TABLE IF NOT EXISTS`) never created the new one. A design decision, not a column fix. |
| 8 WARN ⚠ | `opportunity_feed_items.signal_excerpt` ("missing column makes inserts fail"); `content_performance.company_id`, `content_performance.content_id`; `learning_intelligence.company_id`, `learning_intelligence.pattern_key`; `learning_memory.model_version`; `content_prediction.company_id`, `content_prediction.explanation` | **Possible live write-path defects.** On `main`, `backend/services/opportunityFeedService.ts` writes `signal_excerpt` and `backend/services/content/predictionEngine.ts` inserts into `content_prediction` (fail-safe: returns null, never throws, so a failure is silent). These objects are absent from the 2026-08-13 production schema dump (`supabase/_schema/baseline.sql`), and their migrations (`20260718000003`, `20260818`) predate the dump's ledger cutoff, so the throwaway database never replays them. |
| Ledger desync | throwaway: 0 ledger rows vs 462 local files | Production ledger is documented as desynced (e.g. `20261223000000/01` rows absent). |

For each group, choose:

- ☐ Remediate before release (separate work; not part of this release).
- ☐ Sign off as a known baseline, **only after** the production baseline confirms the exact items one-for-one.

Signing off does not make the items harmless. Decided by / date: ____________

### Decision C: external consumers

> I confirm that no integration (Zapier, partner keys, webhooks), direct database client (psql users,
> scripts or workers outside this repository), BI tool, spreadsheet, or other application or person reads
> or writes the following tables other than through the Omnivyra server:
> `prospect_lists`, `prospect_list_members`, `prospect_campaigns`, `workflows`, `workflow_versions`,
> `execution_instances`, `execution_plans`, `execution_plan_steps`, `execution_tasks`,
> `outreach_bridge_handoffs`, `content_quality`, `content_block`, `content_recommendation`,
> `content_approval_history`, `brand_memory`, `content`, `content_asset`, `content_memory`,
> `content_originality`, `content_revision`, `content_variant`, `publication_lineage`.
>
> Known exceptions: ______________________________________________
>
> Signed: ____________ Date: ____________

Zero API-log hits do not establish that no consumers exist.

### Decisions D–G: pending evidence (do not decide or implement yet)

| | Question | Evidence required first | Decision / date |
|---|---|---|---|
| D | Explicit `REVOKE ALL … FROM PUBLIC, anon, authenticated` plus a service_role grant on the 10 stack tables? | C1 grant snapshot, C2 logs, realtime check, Decision C | |
| E | The same for the 4 FIX3 tables? `user_company_roles` keeps client access (20+ policies read it). | C1, C2, Decision C, S12 dependencies | |
| F | Record the 8-table revoke as an idempotent migration? | Record 2 outcome, then C1 | |
| G | Anon access, including MAINTAIN, on the 4 public-read tables and the 8 Phase-A tables | C1 | |

## 3. Production prerequisites

| # | Prerequisite | Status | Evidence / who / date |
|---|---|---|---|
| 1 | Written confirmation that the target is `klkiseupptzbecbxwrky` | MISSING | The logged-in Supabase CLI (`supabase projects list`, 2026-10-29) shows the ref exists in this account, named **"drishiq2-dot's Project"** (ap-southeast-1, healthy); the other project is `lomndxmrpyudaegddpef` "omnivyra-e2e". The name does not say Omnivyra, so the owner must confirm in writing that this is Omnivyra production. |
| 2 | Explicit authorization of the production session | MISSING | |
| 3 | Named operator | MISSING | |
| 4 | Fresh read-only role per plan §0.1 | MISSING | |
| 5 | Credential delivered outside chat, repository and logs | MISSING | |
| 6 | Decision on the fallback grants if `pg_read_all_data` is refused (they change every table's ACL) | MISSING | |
| 7 | Logs Explorer access | MISSING | |
| 8 | Whether `log_connections` is enabled | UNVERIFIED | |
| 9 | SQL history search outcomes (Records 1–3) | PARTIAL | Local sources searched, no executed text (Records 1–3). The SQL Editor search is still the owner's. Reading saved snippets through the CLI (`supabase snippets list --project-ref klkiseupptzbecbxwrky`, Management API, read-only) was **blocked by the local permission policy as a production read**; it needs the owner's explicit approval. The CLI exposes saved snippets only, not run history. |
