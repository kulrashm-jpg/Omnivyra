# Governance Harness Certification (OMNI-32 / S2)

This document is the Harness Certification Matrix and Report for the Claude + Jira + JEV governance
harness. It is checked by `backend/tests/unit/jevHarnessCertification.test.ts`: every row must be
present, use the result vocabulary below, cite tests that exist, and keep the preserved findings.

**This harness is NOT certified as fully governed.** Work that enters through `gov` is governed end to
end. Entry into `gov` stays optional, and deployment is not gated by Jira. Both are recorded below as
deliberate deferrals (N-14 enforcement / B1, N-18 / B2). H-13 is a FAIL.

## How to read the matrix

- **Result** is one of `PASS`, `FAIL`, `DEFERRED`, `INSUFFICIENT_EVIDENCE`.
  - H rows: `PASS` means the row's authority boundary is proven by the cited deterministic evidence.
    Live operation is reported separately in Notes as `Live: …`; a `PASS` row does not claim live
    operation unless Notes says so.
  - N and B rows: `PASS` means the refusal or detection is proven. `DEFERRED` means a human owner
    decision deliberately leaves it open. `FAIL` means it is open and was not deliberately accepted.
- **Negative Test** cites tests as `` `<file>: <exact text from the test title>` ``. Every cited file is
  in `backend/tests/unit/`.
- **Evidence Hash**:
  - `S2:<registry id>` is the matching item of this Story's own `gov verify` bundle, which runs every
    cited test.
  - `sha256:<64 hex>` is a stored artifact outside git (`GOV_HOME`): an evidence bundle, an intake
    proposal or a live Jira snapshot.
- **Commit**:
  - `S2 HEAD` is the governed commit of this Story.
  - Other hashes are the commits that introduced the boundary, or the HEAD of an earlier live run.
- **Live snapshots** were captured on 2026-10-08 with GET requests only. The JSON snapshot was read
  with an administrator token. The service-identity snapshot was taken with the reader and advisory
  identities themselves.
  - `sha256:55df064f31399df81991e09239018c9b91328762d194328371da0ac9c50a9210` holds the OMNI
    workflow transitions and conditions (`jira-transitions-55df064f3139.json`).
  - `sha256:51a65c56511a298ab74cca9cbdc235d9aae65fe82e15cf5914eb3635464f35fe` holds the transitions
    visible to the reader and advisory identities (`service-identity-transitions.txt`).

## Harness Certification Matrix — entry and continuation paths

| ID | Path | Classification | Authority | Command/API | Deterministic Evidence | JEV Role | Human Gate | Negative Test | Result | Evidence Hash | Commit | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| H-01 | gov intake → new Story/AC | supported entry | Claude proposes; human applies | `gov intake`; human `gov intake --apply sha256:…` → `POST /rest/api/2/issue` | proposal hash, intake audit line, `gov-intake-<hash12>` label | none | typed hash, interactive terminal, own Jira identity, credential freshness | `jevFlowIntake.test.ts: 1. NEW_WORK: proposes a Story + deterministic ACs and creates nothing`; `jevFlowIntake.test.ts: creates the Story + ACs with allowlisted fields only`; `jevFlowIntake.test.ts: 13. a wrong typed hash fails closed before any Jira call`; `jevFlowIntake.test.ts: 15. a gate field on a create form fails closed and nothing is created` | PASS | S2:jev.unit; sha256:094fb092bca97e53a1d7a52e12cbc8e14798dd59700991ef3583f73b72b33aeb | c96d470b | Live: PASS. Applied by the human on 2026-10-08: proposal 7d7b1a05… created OMNI-27 + 4 ACs and proposal 094fb092… created OMNI-32 + 5 ACs (intake audit `apply` lines). |
| H-02 | existing Story → gov start | supported entry | human or Claude; reader identity | `gov start --story --slug --repo --base` (Jira GET only) | packet hash, binding ledger line | none | Story creation and READY | `jevFlowCli.test.ts: ready Story → worktree requested, packet stored, binding mode new, start command printed (never launched)`; `jevFlowCli.test.ts: Story with no AC → NOT_READY 10; no worktree, nothing under GOV_HOME`; `jevFlowCli.test.ts: identity: missing / wrong identity or an over-privileged reader token → REFUSED 11 before any Jira read` | PASS | S2:jev.unit; sha256:29354e03110208d2ea0ead5ab737651b2173b7b40e4a22d713e4a7ea83cfa00b | 20039f3e | Live: PASS. OMNI-9, OMNI-13 and OMNI-32 (this Story, packet 29354e03…, base a39402e8). See finding F-6: the session `gov start` binds is not necessarily the one that does the work. |
| H-03 | existing Claude session → gov attach --base | supported entry | human or Claude | `gov attach --story --session --base` | packet hash, transcript sha256 (transcript unchanged) | none | none | `jevFlowCli.test.ts: attaches an existing transcript read-only (bytes unchanged) and prints resume steps`; `jevFlowCli.test.ts: dirty repo, non-descending HEAD, no --base, missing transcript → REFUSED 11 with no packet/binding written`; `jevFlowSession.test.ts: refuses binding a session to a different Story (one session governs one Story)` | PASS | S2:jev.unit | 20039f3e | Live: NOT RUN. No live attach with `--base` is recorded; the live attaches (OMNI-6, OMNI-23) used adoption (H-04). |
| H-04 | pre-governance work → adoption baseline → gov attach | supported entry | **human** makes the baseline commit | `git commit -m … -m "Governed-By: OMNI-n"` (human); `gov attach` without `--base` | baseline commit plus `adoption` record in the binding | none | adoption-baseline commit | `jevFlowAdoptionCli.test.ts: (2) clean HEAD with Governed-By and no Gov-Packet, no --base, no prior binding → OK`; `jevFlowAdoptionCli.test.ts: (3) HEAD without Governed-By / for another Story / with a Gov-Packet → REFUSED 11`; `jevFlowAdoptionCli.test.ts: tampered adoption record (baseline != base, bad classification, non-commit) → 13 fail-closed` | PASS | S2:jev.unit; sha256:b63acd3ba89912c5a871167e9024e4475b51a54b895d7f682f4d545aace6fbaf; sha256:23a723744fd692faf2471ccf5f220a9aedfc3675d5e090f51c5a7429bae510e0 | 1448c892 | Live: PASS. OMNI-6 (baseline 6dd5e487, bundle b63acd3b…) and S0 OMNI-23 (baseline 1448c892, bundle 23a72374…, check-merge 10/10 OK). |
| H-05 | gov verify → deterministic evidence bundle | supported continuation | registry commands only (no shell) | `gov verify --story --worktree` | content-addressed bundle and logs in GOV_HOME | none | none | `jevFlowCli.test.ts: governed commit → OK 0 with EV lines and a bundle hash`; `jevFlowVerify.test.ts: scope violation -> SCOPE_VIOLATION, runner never called`; `jevFlowVerify.test.ts: real run: exit 1 -> VERIFICATION_FAILED with stored bundle`; `jevFlowProtectedPaths.test.ts: a hand-made Story authorizing supabase/** cannot change a migration` | PASS | S2:jev.unit; sha256:31ec53b0f2af133e947f17ef7538a1b15835c60caf47e51113e406e2cf76cfcf; sha256:47248e7e6a8c9ccc1465b72d293f8fe4f5be94e66f613d78feedc22410b08dc9 | S2 HEAD | Live: PASS. OMNI-13 and OMNI-9; a FAIL bundle is kept as evidence (OMNI-9 6f98f544…). S2 adds the protected-path step (B3). |
| H-06 | gov judge → explicit bounded JEV invocation | supported continuation | explicit `--invoked-by`; reader identity (advisory with `--write-back`) | `gov judge --story --worktree --evidence --invoked-by [--write-back]` | bundle and packet integrity re-checked before any JEV call | bounded advisory, model pinned jev-1.13.0 | `--write-back` is human-run | `jevFlowJudge.test.ts: the provider body carries only the AC statement, invariants, summary and evidence metadata; model jev-1.13.0 by default`; `jevFlowCli.test.ts: reader identity: judges every AC, never writes, never transitions`; `jevFlowAdoptionSafety.test.ts: only judgeFlow.ts imports jev-bjc/judge`; `jevFlowJudge.test.ts: duplicate evidence ids → REFUSED, no JEV call, nothing written` | PASS | S2:jev.unit | S2 HEAD | Live: NOT RUN in this certification. The single authorized bounded JEV smoke needs the reader identity, which the implementing session could not load. PASS covers the boundary only; it does not mean a real provider call through `gov judge` has been observed. |
| H-06b | `jev-jira judge-ac [--write-back]` (second JEV entry point) | supported entry outside `gov` | explicit CLI; reader or advisory identity | `scripts/jev-jira/cli.ts judge-ac` | AC + evidence metadata only | bounded advisory | `--write-back` is human-run | `jevJiraIntegration.test.ts: reader identity: preflight, then GET AC → GET Story → JEV; only the reader token is ever sent`; `jevJiraIntegration.test.ts: CLI: usage errors exit 64 and missing Jira credentials exit 64 without any request`; `jevJiraIntegration.test.ts: no product code and no npm script imports or runs the orchestrator` | PASS | S2:jev.unit | a39402e8 | Live: NOT RUN in this certification. Same advisory boundary as H-06, but it bypasses gov packets and evidence bundles. It cannot override deterministic evidence (H-11). |
| H-06c | `jev-bjc judge` (standalone BJC) | supported entry outside `gov` | explicit CLI; no Jira access | `scripts/jev-bjc/cli.ts judge` | caller-supplied bounded request | bounded advisory | none (writes nothing to Jira) | `jevBjcIsolation.test.ts: hash prints the canonical input hash; judge without a key exits 2 and is audited`; `jevBjcIsolation.test.ts: no product code imports BJC`; `jevBjcIsolation.test.ts: BJC exports no hook registration surface` | PASS | S2:jev.unit | a39402e8 | Live: NOT RUN in this certification. No Jira credential is read, so it cannot write or transition anything. |
| H-07 | gov submit → human Record Result / Record Verification | supported continuation | prints only; a human records | `gov submit --story --evidence`; Jira transitions 111 and 121 (Engineers role) | the Evidence References line | none | Record Result, Record Verification | `jevFlowCli.test.ts: prints the pinned human Record Result values; no Jira call, no file written`; `jevFlowCli.test.ts: unknown evidence → 11; wrong worktree → 11` | PASS | S2:jev.unit; sha256:55df064f31399df81991e09239018c9b91328762d194328371da0ac9c50a9210 | 20039f3e | Live: PASS. OMNI-6, OMNI-9 and OMNI-13 were recorded by humans. In the live snapshot, transitions 111/121 are limited to Engineers 10043. Finding F-5: submit prints the bundle's Deterministic Result for Judgment ACs too. |
| H-08 | gov check-merge → governance enforcement | supported continuation | human or CI | `gov check-merge --story --worktree --evidence` | named checks: binding, packet, evidence, HEAD, clean tree, deterministic, scope, protected-paths, commits, trailers | none | merge | `jevFlowCli.test.ts: commits without trailers → 13`; `jevFlowAdoptionCli.test.ts: (6) later commit missing Gov-Packet → 13`; `jevFlowProtectedPaths.test.ts: check-merge recomputes protected paths from git` | PASS | S2:jev.unit; sha256:23a723744fd692faf2471ccf5f220a9aedfc3675d5e090f51c5a7429bae510e0 | S2 HEAD | Live: PASS. OMNI-13 9/9 and OMNI-23 10/10, both before the protected-paths check existed. check-merge is NOT a required GitHub check (see B1). |
| H-09 | Jira → JEV stays orchestrator-mediated | continuation boundary | orchestrator only | `runAcJudgment` (jev-jira) / `runJudgeFlow` (gov) | — | bounded input: AC, invariants, summary, evidence metadata | — | `jevJiraIntegration.test.ts: reads exactly the AC and its parent Story with explicit field lists — nothing else`; `jevJiraIntegration.test.ts: sends JEV no Story objective, architecture, prohibited paths or gate result`; `jevJiraIntegration.test.ts: loading every orchestrator module performs no network call` | PASS | S2:jev.unit | a39402e8 | Live: NOT RUN in this certification (see H-06). |
| H-10 | JEV → Jira write-back limited to the four advisory fields | continuation boundary | advisory identity (Browse + Edit only) | `PUT /rest/api/2/issue/{key}` with 4 fields, then read-back | read-back and protected-field snapshot | writes JEV Verdict, Confidence, Model and Input Hash only | none | `jevJiraIntegration.test.ts: 12. writes exactly the four advisory fields and verifies them by read-back`; `jevJiraIntegration.test.ts: the client refuses every human-only field before any request`; `jevJiraIntegration.test.ts: 'T3 Evidence Reference', 'customfield_10078'` | PASS | S2:jev.unit | S2 HEAD | Live: NOT RUN in this certification. The advisory-safe AC edit screen was live-verified on 2026-10-01 (editmeta = the 4 JEV fields). S2 adds the missing T3 Evidence Reference (10078) refusal. |
| H-11 | deterministic vs JEV → BJC precedence | continuation boundary | BJC `combine()` | `judge()` | deterministic result derived from evidence items | advisory input only | human disposition for Judgment ACs | `jevBjcJudge.test.ts: 4. deterministic PASS + JEV CONTRADICTS => PASS_DISPUTED, review, never FAIL`; `jevBjcJudge.test.ts: 5. deterministic FAIL + JEV SUPPORTS stays FAIL (conflict surfaced)`; `jevFlowJudge.test.ts: deterministic FAIL + JEV SUPPORTS → combined FAIL, never PASS; Jira JEV verdict CONFLICT` | PASS | S2:jev.unit | a39402e8 | Live: PASS for the Jira side. AC Verify (T41) refuses JEV Verdict CONFLICT; runtime-verified on 2026-10-01 against fixtures OMNI-4 and OMNI-5. |
| H-12 | T1 / T2 / T3 gates → authority boundaries | human authority | human; Jira roles | Jira Verify (41) conditions; Release (61) Release Approvers | Gate Result, Verified ACs | none (cannot write gate fields or transition) | T1, T2, T3 | `jevJiraIntegration.test.ts: 15. the parent Story (Gate Result) is never written`; `jevFlowIntake.test.ts: 15. a gate field on a create form fails closed and nothing is created`; `jevJiraIntegration.test.ts: 16/17. the integration has no transition path` | PASS | S2:jev.unit; sha256:55df064f31399df81991e09239018c9b91328762d194328371da0ac9c50a9210; sha256:51a65c56511a298ab74cca9cbdc235d9aae65fe82e15cf5914eb3635464f35fe | a39402e8 | Live: PASS (snapshots). Story Verify needs Gate Result PASS and every sub-task Verified; Workstream and Epic Verify need Gate Result PASS. T2/T3 content is human judgment with no deterministic link. Findings F-3 and F-4. |
| H-13 | integration / release / deployment → human-only authority | human authority | human | merge; Jira Integrate (51) / Release (61); `npm run deploy:prod`; Railway deploy on merge | none tied to a Story | none | integration, release, deployment | `jevFlowCli.test.ts: registers no hooks and has no Jira transition / write path of its own`; `jevJiraIntegration.test.ts: 16/17. the integration has no transition path` | FAIL | sha256:55df064f31399df81991e09239018c9b91328762d194328371da0ac9c50a9210; sha256:51a65c56511a298ab74cca9cbdc235d9aae65fe82e15cf5914eb3635464f35fe | — | Preserved finding F-1: Integrate (51) has no transition condition on any OMNI issue type, so any Engineer can integrate a Verified item. Release (61) is limited to Release Approvers. Deployment is not gated in code (N-18 DEFERRED). JEV and gov hold no integration, release or deploy path, and the service identities see zero transitions (N-12/N-13). The boundary is human by Jira role and convention, not enforced. Not changed here: Jira configuration is out of scope. |
| H-14 | gov admit → governed session admission | read-only admission in front of the entries | the asking session, identified from agreeing evidence; the user decides | `gov admit [--worktree] [--session] [--base]` | identity only when the injected session id, the registry record, a live pid and the session pipe agree; intake’s own classifier; nothing written | none | an explicit yes before the printed command is run | `jevFlowAdmission.test.ts: one proven live session + a clean branch with no Story → NEW_WORK, prints (never runs) gov intake --intent`; `jevFlowAdmission.test.ts: a real governed binding (gov attach) → GOVERNED_RESUME with the packet step`; `jevFlowAdmission.test.ts: cmdAdmit has no write, bind, store, audit, Jira-write, JEV, git-write or process surface` | PASS | S4:jev.unit | S4 HEAD | OMNI-38. Live: PASS 2026-10-09, read-only, in session 26b18a5f: GOVERNED_RESUME on OMNI-38; `--session` naming another live session and a forged id both refused SESSION_MISMATCH; GOV_HOME and refs byte-identical. The actual process start is not compared on Windows (F-9). |

## Negative / bypass certification

| ID | Path | Classification | Authority | Command/API | Deterministic Evidence | JEV Role | Human Gate | Negative Test | Result | Evidence Hash | Commit | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| N-01 | stale human Jira credential | refusal | intake identity | `gov intake --check-forms` / `--apply` | freshness check before any Jira request | none | — | `jevFlowIntakeFreshness.test.ts: stale token / stale email: refused with the fixed message naming only the variable`; `jevFlowIntake.test.ts: --check-forms refuses before any Jira request`; `jevFlowIntake.test.ts: --apply refuses before the prompt and before any Jira request` | PASS | S2:jev.unit | c96d470b | Covers only the human intake identity. The reader and advisory tokens have no freshness check (finding F-8). |
| N-02 | ambiguous / multiple live sessions | refusal | intake | `gov intake` | DUPLICATE_SESSION, AMBIGUOUS_OWNERSHIP, SESSION_BOUND_ELSEWHERE | none | — | `jevFlowIntake.test.ts: 8. two live sessions claiming one worktree fail closed (DUPLICATE_SESSION)`; `jevFlowIntake.test.ts: dirty work with no owning session fails closed (AMBIGUOUS_OWNERSHIP)`; `jevFlowIntake.test.ts: 9. a session already bound to another Story fails closed (SESSION_BOUND_ELSEWHERE)` | PASS | S2:jev.unit | c96d470b | Proven at intake. Finding F-6: nothing ties a commit to the session that made it. |
| N-03 | missing / invalid Story binding | refusal | gov | packet, verify, judge, check-merge | "no binding" refusal; CONFLICTING_BINDINGS; tampered adoption → 13 | none | — | `jevFlowCli.test.ts: no binding for story+worktree → REFUSED 11`; `jevFlowAdoptionCli.test.ts: tampered adoption record (baseline != base, bad classification, non-commit) → 13 fail-closed`; `jevFlowIntake.test.ts: an invalid binding (packet or ancestry) or two Stories on one worktree is CONFLICTING_BINDINGS` | PASS | S2:jev.unit | 20039f3e | — |
| N-04 | wrong Story / AC | refusal | gov | readiness, binding, check-merge, judge | not-an-AC-of-this-Story, session bound elsewhere, wrong Governed-By, bundle Story mismatch | none | — | `jevFlowReadiness.test.ts: an issue that is not an AC of this Story fails closed`; `jevFlowAdoptionCli.test.ts: (8) wrong Governed-By → 13`; `jevFlowJudge.test.ts: bundle story key disagreeing with the packet → INTEGRITY_FAILED` | PASS | S2:jev.unit | 20039f3e | — |
| N-05 | unauthorized path | refusal | gov | verify / check-merge | SCOPE_VIOLATION before any command | none | — | `jevFlowCli.test.ts: change outside authorized paths → SCOPE_VIOLATION 15`; `jevFlowScope.test.ts: outside authorized -> not ok` | PASS | S2:jev.unit | 20039f3e | — |
| N-06 | prohibited path | refusal | gov | verify / intake | SCOPE_VIOLATION; PROHIBITED_PATH_TOUCHED | none | — | `jevFlowCli.test.ts: prohibited path → SCOPE_VIOLATION 15`; `jevFlowScope.test.ts: prohibited wins over authorized`; `jevFlowIntake.test.ts: 16. a prohibited path fails closed` | PASS | S2:jev.unit | 20039f3e | — |
| N-07 | protected migration without exact authorization | refusal | gov | intake, verify, check-merge | exact reviewed authorization cited by id and digest | none | reviewed `intake-rules.json` change | `jevFlowIntakeAuthorization.test.ts: an unauthorized protected path is still refused even with the flag`; `jevFlowProtectedPaths.test.ts: a hand-made Story authorizing supabase/** cannot change a migration`; `jevFlowProtectedPaths.test.ts: check-merge recomputes protected paths from git`; `jevFlowProtectedPaths.test.ts: a hand-written citation of an id the reviewed rules do not define` | PASS | S2:jev.unit | S2 HEAD | Before S2 this was covered at intake only (gap B3). S2 enforces it in verify and check-merge. |
| N-08 | missing deterministic evidence | refusal | gov / BJC | judge, check-merge | INSUFFICIENT_EVIDENCE; unknown bundle → 11 | none | — | `jevFlowJudge.test.ts: a Deterministic AC with no matching evidence item is INSUFFICIENT_EVIDENCE, never PASS`; `jevFlowJudge.test.ts: a bundle with no PASS/FAIL deterministic result → REFUSED, never treated as PASS`; `jevFlowCli.test.ts: missing --evidence → 64; unknown evidence hash → 11; tampered evidence → 13` | PASS | S2:jev.unit | S2 HEAD | S2 adds the three previously untested judgeFlow branches: malformed item, duplicate ids, no result. |
| N-09 | JEV contradicts deterministic PASS | precedence | BJC | `combine()` | PASS_DISPUTED, never FAIL | advisory | human review | `jevFlowJudge.test.ts: deterministic PASS + JEV CONTRADICTS → PASS_DISPUTED, conflict, review — never an automatic FAIL`; `jevJiraIntegration.test.ts: 6. deterministic PASS + contradictory JEV → PASS_DISPUTED; Jira CONFLICT; not promoted` | PASS | S2:jev.unit | a39402e8 | — |
| N-10 | deterministic FAIL + JEV support | precedence | BJC + Jira T41 | `combine()`; AC Verify | FAIL stands; Jira CONFLICT blocks Verify | advisory | — | `jevFlowJudge.test.ts: deterministic FAIL + JEV SUPPORTS → combined FAIL, never PASS; Jira JEV verdict CONFLICT`; `jevJiraIntegration.test.ts: 7. deterministic FAIL + supportive JEV → FAIL stands; Jira CONFLICT, never PASS` | PASS | S2:jev.unit | a39402e8 | T41 refusing CONFLICT was runtime-verified on 2026-10-01. |
| N-11 | JEV unavailable / failure | refusal | BJC / gov | judge | JUDGMENT_UNAVAILABLE, nothing written | unavailable | — | `jevFlowJudge.test.ts: no transport → JUDGMENT_UNAVAILABLE, no writes`; `jevJiraIntegration.test.ts: 10. timeout twice → JUDGMENT_UNAVAILABLE: no fabricated verdict, no Jira write, failure audited`; `jevFlowCli.test.ts: no JEV transport → JUDGMENT_UNAVAILABLE 16` | PASS | S2:jev.unit | a39402e8 | Deterministic evidence and check-merge do not depend on JEV. |
| N-12 | JEV attempting a Jira transition | refusal | Jira + code | — | no transition method in any JEV / gov client | cannot transition | — | `jevJiraIntegration.test.ts: 16/17. the integration has no transition path`; `jevJiraIntegration.test.ts: no transition (or any non-issue) endpoint is ever called`; `jevFlowJudge.test.ts: has no Jira transitions, no direct advisory update, no HTTP of its own` | PASS | S2:jev.unit; sha256:51a65c56511a298ab74cca9cbdc235d9aae65fe82e15cf5914eb3635464f35fe | a39402e8 | Preserved finding F-2: the reader and advisory identities see zero transitions on Story and AC in Backlog, Verified and Integrated (live, 2026-10-08). Not sampled: Ready, In Progress, In Review, Released, Workstream, Epic. The live re-check was not repeated in this certification. |
| N-13 | JEV attempting a T2 / T3 / release disposition | refusal | Jira + code | — | Gate Result, T3 Evidence Reference, Deployment Authorized By / At refused before any request | cannot write gate fields | — | `jevJiraIntegration.test.ts: 'T3 Evidence Reference', 'customfield_10078'`; `jevJiraIntegration.test.ts: 'Deployment Authorized By', 'customfield_10079'`; `jevJiraIntegration.test.ts: 15. the parent Story (Gate Result) is never written` | PASS | S2:jev.unit; sha256:51a65c56511a298ab74cca9cbdc235d9aae65fe82e15cf5914eb3635464f35fe | S2 HEAD | Preserved finding F-2 (zero service-identity transitions, same sampling limits as N-12). S2 adds the missing 10078 refusal case. |
| N-14 | Claude bypassing governed entry | detection | gov (read-only) | `gov audit-branch --worktree [--base]`; `gov check-merge` | every commit classified; untrailered commits refused by check-merge | none | merge | `jevFlowAuditBranch.test.ts: N-14: plain Claude work on a branch is detected, never treated as governed`; `jevFlowAuditBranch.test.ts: N-14: plain work (no trailer) is UNGOVERNED, whatever the lookups say`; `jevFlowCli.test.ts: commits without trailers → 13` | PASS | S2:jev.unit | S2 HEAD | Plain Claude work cannot be treated as governed: it is detected (owner decision A1(b)) and check-merge refuses it. It is NOT prevented from reaching main, because no required check runs either command. That residual is B1 (DEFERRED). |
| N-15 | unauthorized Jira identity attempting intake/create | refusal | intake | `gov intake --apply` | service account, reserved tokens, missing Create permission refused | none | — | `jevFlowIntake.test.ts: 11. a service account fails closed`; `jevFlowIntake.test.ts: resolveIntakeCredentials refuses provisioning / reader / advisory tokens and service accounts`; `jevFlowIntake.test.ts: 10. missing Create permission fails closed before any write` | PASS | S2:jev.unit | c96d470b | — |
| N-16 | automatic / hidden JEV invocation | absence | repo | — | no hooks, no plugin enablement, no automatic import path | none | — | `jevBjcIsolation.test.ts: no repo Claude setting registers hooks or enables the claude-jev plugin`; `jevFlowInstallation.test.ts: no .claude/settings*.json declares a hooks key`; `jevFlowAdoptionSafety.test.ts: no module contains Claude Code hook tokens or settings writes` | PASS | S2:jev.unit | 20039f3e | Proven for the repository only. User-level configuration is B4. |
| N-17 | unauthorized Jira field write-back | refusal | client | `assertAdvisoryOnly` | every non-advisory field refused before any request | four fields only | — | `jevJiraIntegration.test.ts: the client refuses every human-only field before any request`; `jevJiraIntegration.test.ts: the update touches only advisory fields`; `jevFlowAdoptionSafety.test.ts: the only Jira writes in jev-flow are Phase 2 writeAdvisoryFields in judgeFlow.ts and intake issue creation in intakeJira.ts` | PASS | S2:jev.unit | a39402e8 | — |
| N-18 | release / deployment without a human gate | deliberate classification | human | `npm run deploy:prod`; Railway deploy on merge to main | none | none | deployment | — | DEFERRED | — | — | Owner decision A2(c). `deploy:prod` checks the SHA and a clean tree but never reads Jira or Deployment Authorized By. The Railway worker deploys about 5 s after a merge to main, so the human merge is the worker's deployment gate. Not PASS: no code enforces a human deployment decision. |
| N-19 | admission: self-identification mismatch | refusal | gov admit | `gov admit` | session id, registry, pid, socket and pipe must agree; any disagreement refuses before classification | none | — | `jevFlowAdmission.test.ts: env session id disagreeing with the registry → SESSION_MISMATCH`; `jevFlowAdmission.test.ts: registry/socket disagreement → SOCKET_MISMATCH`; `jevFlowAdmission.test.ts: a pid with no live record (dead, stale or unknown) → PROCESS_NOT_LIVE`; `jevFlowAdmission.test.ts: 9. a live pid whose session pipe is gone is a reused pid (PID_REUSED)` | PASS | S4:jev.unit | S4 HEAD | OMNI-38. Identity is never inferred from a cwd; incomplete self evidence never falls back to `--session`. |
| N-20 | admission: forged session id | refusal | gov admit | `gov admit --session <uuid>` | an explicit id must be a live, unique registry session (same strict validation) | none | — | `jevFlowAdmission.test.ts: with no self evidence at all, --session gets the same live-registry validation`; `jevFlowAdmission.test.ts: explicit --session with no self evidence follows the same live-registry validation` | PASS | S4:jev.unit | S4 HEAD | OMNI-38. A forged, stale or reused-pid id is refused. |
| N-21 | admission: forked session | refusal | gov admit + intake classifier | `gov admit [--session <origin>]` | a session may only admit itself; the origin’s binding refuses the fork (DUPLICATE_SESSION) | none | — | `jevFlowAdmission.test.ts: --session equal to the proven self is accepted; any other session is refused (forks gain no authority)`; `jevFlowAdmission.test.ts: a forked session (its own id) on its origin` | PASS | S4:jev.unit | S4 HEAD | OMNI-38. Owner decision: forks have no admission authority. |
| N-22 | admission: user declines | zero trace | gov admit | `gov admit` | admission writes nothing and runs nothing; every CLI case byte-compares the repo, GOV_HOME and transcripts | none | the user’s yes or no | `jevFlowAdmission.test.ts: declining is the default: admission leaves zero trace (no ledger, proposal, audit, git or transcript change)` | PASS | S4:jev.unit | S4 HEAD | OMNI-38. Declining is simply not running the printed command. |

## Bypass paths

| ID | Path | Classification | Authority | Command/API | Deterministic Evidence | JEV Role | Human Gate | Negative Test | Result | Evidence Hash | Commit | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| B1 | plain `claude` → commit → PR → required checks → merge | bypass | human merge | GitHub PR merge (7 required checks, none about governance) | `gov audit-branch` detects it; `gov check-merge` refuses it | none | merge | `jevFlowAuditBranch.test.ts: N-14: plain Claude work on a branch is detected, never treated as governed` | DEFERRED | — | — | Owner decision A1(b): detection only. Enforcement option A1(a), a required check running the trailer or audit check, is an authority change and was not chosen. Governance remains opt-in. |
| B2 | `npm run deploy:prod` / Railway deploy on merge | bypass | human | deploy tooling | none | none | deployment | — | DEFERRED | — | — | Owner decision A2(c), same as N-18: deploy tooling reads no Jira authorization, and the Railway worker deploys on every merge to main. |
| B3 | a Story created by hand in Jira that authorizes protected paths | bypass (closed) | gov | verify / check-merge | exact reviewed authorization, recomputed from git | none | reviewed rules change | `jevFlowProtectedPaths.test.ts: a hand-made Story authorizing supabase/** cannot change a migration`; `jevFlowProtectedPaths.test.ts: check-merge recomputes protected paths from git`; `jevFlowProtectedPaths.test.ts: without an injected policy verify loads the reviewed rules itself` | PASS | S2:jev.unit | S2 HEAD | Owner decision A3: closed in S2. Enforcement only refuses and grants nothing. It applies wherever verify or check-merge is actually run (see B1). |
| B4 | `claude-jev` plugin installed but disabled at user level | configuration residual | user | `~/.claude` plugin flag | none | would route prompts if re-enabled | user configuration | — | INSUFFICIENT_EVIDENCE | — | — | User-level `~/.claude` configuration is outside the repository and no test inspects it. One flag would re-enable prompt routing. |

## Harness Certification Report

### Supported entry paths

`gov intake` (H-01), `gov start` (H-02), `gov attach --base` (H-03) and adoption via `gov attach` (H-04)
are the supported governed entries. Two further JEV entry points exist outside `gov`: `jev-jira judge-ac`
(H-06b) and `jev-bjc judge` (H-06c). Both are explicit, bounded and advisory, and neither can transition
Jira or override deterministic evidence. `gov admit` (H-14, OMNI-38) is a read-only admission in front of these entries:
it proves the asking session, classifies the work with intake’s classifier and prints the next command; it runs nothing.

### Certified continuation paths

`gov verify` (H-05), `gov judge` (H-06, boundary only), `gov submit` (H-07) and `gov check-merge` (H-08).
JEV stays mediated (H-09), write-back is limited to four fields (H-10), and BJC keeps deterministic
precedence (H-11). `gov audit-branch` is new in S2 and is detection only.

### Prohibited / bypass paths

- B1 (ungoverned merge to main): DEFERRED.
- B2 (deployment): DEFERRED.
- B3 (hand-made Story reaching protected paths): closed in S2.
- B4 (user-level plugin flag): INSUFFICIENT_EVIDENCE.

### Deterministic evidence coverage

Every PASS row cites tests that `jevHarnessCertification.test.ts` resolves against their files. All of
them run under the `jev.unit` registry entry of this Story's `gov verify`.

S2 adds:

- `jevFlowProtectedPaths.test.ts` (B3 / N-07);
- `jevFlowAuditBranch.test.ts` (N-14 detection);
- three judgeFlow branches in `jevFlowJudge.test.ts`: malformed item, duplicate ids, no result;
- the T3 Evidence Reference (10078) refusal in `jevJiraIntegration.test.ts`;
- this matrix's conformance test.

### JEV boundary proof

JEV is reached only through `gov judge`, `jev-jira judge-ac` or `jev-bjc judge`, each explicitly invoked.

- **Input:** it receives only the AC statement, invariants, summary and evidence metadata.
- **Output:** it writes at most four advisory fields.
- **Authority:** it cannot transition Jira or write any gate field, and it cannot turn a deterministic
  FAIL into a PASS (H-06, H-09 to H-11, N-09 to N-13, N-16, N-17).

No live provider call through `gov judge` is part of this certification (H-06, Live: NOT RUN).

### Jira authority proof

From the live snapshot `sha256:55df064f…`:

- **Gate fields:** Story Verify requires Gate Result PASS and every sub-task Verified; Workstream and
  Epic Verify require Gate Result PASS.
- **AC transitions:** AC Verify requires deterministic PASS + VERIFIED with JEV Verdict ≠ CONFLICT, a
  human disposition, or WAIVED. Record Result (111) and Record Verification (121) are limited to
  Engineers.
- **Release:** Release (61) is limited to Release Approvers on every type.
- **Integrate:** Integrate (51) has no condition (F-1).

From `sha256:51a65c56…`: the reader and advisory service identities see zero transitions in the sampled
states (F-2).

### T1 / T2 / T3 authority proof

| Tier | Gate |
|---|---|
| T1 | Story Gate Result plus every AC Verified; set and moved only by humans (H-12) |
| T2 | Workstream Gate Result; human only |
| T3 | Epic Gate Result; human only, Release by Release Approvers |

T2 and T3 carry no deterministic link to evidence. They are human decisions recorded in Jira.

### Findings (preserved, not fixed here)

- **F-1 (H-13): Integrate has no transition condition** on any OMNI issue type. Jira configuration is
  outside this Story's authority and was not changed.
- **F-2 (N-12 / N-13): zero transitions for the reader and advisory identities,** proven live only for
  Story and AC in Backlog, Verified and Integrated. Other states and the Workstream and Epic types were
  not sampled.
- **F-3: no Gate Result condition on Story and Workstream Release (61).** Only Release Approvers is
  required. The Epic Release requires both.
- **F-4: Reopen transitions (81, 91) have no condition.**
- **F-5: `gov submit` prints the bundle's Deterministic Result for Judgment ACs too.** It is a
  presentation issue only, because the human decides the disposition.
- **F-6: the binding does not prove which session did the work.**
  - OMNI-32 is bound to the session `gov start` minted (582b3622…). The implementation was carried out
    by another session, c1fb7752…, after the human handed it the packet.
  - gov has no mechanism linking commits to a session.
  - S4 (`gov admit`) identifies sessions but does not attribute commits.
- **F-7: this Story's jest runs use the hermetic `CI=true` mode.** `.env*` is a prohibited path for
  OMNI-32, so the governed session did not create the gitignored `.env.test` placeholder.
  `backend/tests/setupEnv.ts` accepts no env file only under `CI=true`; its production-marker check runs
  in every mode.
- **F-8: credential freshness covers only the human intake identity.**
- **F-9: `gov admit` does not compare the actual process start with the registry’s procStart on Windows.**
  Reading another process’s start time needs a process launch, which admission does not make. The only
  PID-reuse mitigation is the session’s named pipe, which normally ends with its process and is enumerated,
  never opened. This does not prove process identity and does not eliminate PID-reuse risk; the residual
  risk is accepted as an open limitation. Where a start-time probe is available it must match, and a start
  that cannot be established refuses.

### Remaining gaps

- B1: ungoverned work can reach main.
- B2 / N-18: deployment is not Jira-gated.
- B4: user-level plugin configuration is not inspected.
- H-06: no live JEV run.
- F-1 to F-9 above.

### Deliberate deferrals

- **A1:** enforcement of governed entry (B1). Detection is delivered as `gov audit-branch`.
- **A2(c):** deployment gating (N-18, B2).
- **S4:** none. Session admission (H-14, N-19 to N-22) is delivered by OMNI-38; F-9 records its limit.

### Certification SHA

The certification SHA is the HEAD of branch `omni-32/harness-certification` at which
`gov verify --story OMNI-32` produced a PASS bundle. It is recorded in that bundle, in the `gov submit`
output that a human copies into Jira Evidence References, and in `GOV_HOME/evidence/harness/PROGRESS.md`.
It cannot be written into this file, because this file is part of the verified tree.
`S4:<registry id>` and `S4 HEAD` mean the same for OMNI-38 (session admission): its own `gov verify` bundle and governed commit.
