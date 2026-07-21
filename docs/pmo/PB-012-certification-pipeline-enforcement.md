# PB-012 — Certification Pipeline Enforcement (CI)

**Status:** Engineering complete; **enforcement NOT complete** — see §8.
**Authority:** PMO-002. **Program:** B. **Agent:** 1 (Platform/Core).
**Zone:** CI / governance / documentation only — no runtime, product, Platform, test, or
`tsconfig*` change. **Date:** 2026-07-21.

Changes: `.github/workflows/typecheck-certification.yml` (**new**) ·
`docs/TYPESCRIPT-VALIDATION-STRATEGY.md` · `docs/ENGINEERING-GOVERNANCE.md` · this doc.
**No `scripts/**` file was modified.** Certification semantics established by PB-009/PB-010/
PB-011 are reused verbatim, not re-implemented and not altered.

---

## 1. The gap PB-012 closes

PB-009 built the coverage assertion, PB-010 lowered the baseline, PB-011 added the per-error
identity ratchet with attribution. The result was a complete, passing, dependency-free guard
that **no workflow referenced**. `typecheck:certification` appeared in `package.json`, in two
documents, and nowhere in `.github/workflows/**`.

A guard that no build invokes cannot fail anything. Every anti-gaming property PB-011 proved
— net-new identity detection, coverage assertion, parser completeness, cross-artifact
integrity — was inert in practice. PB-012 arms it.

## 2. What PB-012 does **not** do

**It does not make the check block a merge.** That is a GitHub *branch-protection* setting,
not a file in this repository. See §8. This document deliberately refuses to describe the
check as "enforced" until that admin action is performed.

## 3. The workflow

`.github/workflows/typecheck-certification.yml`

| Property | Value | Why |
|---|---|---|
| Workflow name | `Backend TypeScript Certification` | — |
| **Job name (status-check identity)** | **`Backend TypeScript certification`** | Exactly the name already used in `docs/ENGINEERING-GOVERNANCE.md` §4, so the doc and the check agree. **Renaming it silently un-registers the check.** |
| Triggers | `pull_request` (default types), `push: [main]`, `workflow_dispatch` | See §3a |
| Runner | `ubuntu-latest` | Matches the existing required job |
| Node | `22` + `cache: npm` | Matches `package.json` `engines` and `typecheck-baseline.yml`; the cache only speeds `npm ci` |
| `fetch-depth` | `0` | PB-011 attribution resolves `git merge-base origin/$GITHUB_BASE_REF HEAD`; a shallow clone has no `origin/main`. Attribution is **evidence only** — an unattributed net-new error still fails — so this changes **no verdict**, only diagnostics |
| `timeout-minutes` | `30` | Local wall clock is ~3m15s; this is headroom, not a target |
| `CI` | exported as `'true'` on the job | Guarantees `--update-baseline`'s CI refusal is armed. `CI` is read by the guard for that refusal and nothing else |
| Concurrency | per-ref, `cancel-in-progress: true` | A superseded commit's run is replaced by the newer commit's run |
| Permissions | `contents: read` | Least privilege; the job writes nothing back |

### 3a. Trigger justification

- **`pull_request`, with no `paths` filter.** Deliberate. A path-filtered required check never
  reports on PRs that skip it, which blocks those PRs forever. It is also wrong on the merits:
  a `package.json` dependency bump, a `tsconfig` edit, or a `lib/**` signature change can
  introduce backend type debt without touching `backend/**`.
- **`push: [main]`.** An admin-override merge, a direct push, or two PRs that were each green
  in isolation but conflict once merged can all land debt that no PR run ever saw. This gives
  `main` its own certification history and makes a post-merge regression visible immediately.
- **`workflow_dispatch`.** On-demand re-run after a re-baseline, without an empty commit.

### 3b. The gate step

```yaml
- name: Backend TypeScript certification
  id: certification
  shell: bash
  run: |
    set -o pipefail
    npm run typecheck:certification 2>&1 | tee typecheck-certification.log
```

`set -o pipefail` is **load-bearing, not decoration**. Without it `tee` is the last command in
the pipeline and its exit code (`0`) becomes the step's exit code — the guard would fail and
the job would go green. Verified both ways in §7.

There is **no** `continue-on-error`, **no** `|| true`, and **no** output suppression on this
step or on the preflight step. The only two `|| true` in the file are inside the
`if: always()` job-summary step, on `grep` calls that must not abort the summary when they
find nothing; that step cannot change the job's conclusion.

### 3c. Preflight step

A read-only existence check for the six pipeline files and the `typecheck:certification` npm
script, which turns a bare `npm ERR! Missing script` into an explicit statement of what is
absent from the ref (see §5). It has no certification semantics.

### 3d. Diagnostics

- **Job summary** (`$GITHUB_STEP_SUMMARY`, `if: always()`): a verdict line
  (PASS / FAIL / INCOMPLETE / UNKNOWN), a headline block (`coverage:`, `errors:`,
  `fingerprints:`, `attribution source:`, `RESULT:`), an explicit **failing conditions** block
  (every line containing `FAIL`), the full report in a collapsed `<details>` (last 400 lines),
  and a footer restating that pre-existing debt never fails and how to re-baseline. A failure
  is therefore readable on the run's summary page without opening raw logs.
  An `INCOMPLETE` verdict is emitted when the log exists but contains no `RESULT:` line — a
  crash, OOM or timeout — so an aborted run is never mistaken for a pass.
- **Artifact**: `typecheck-certification.log` uploaded on success and failure, matching the
  evidence pattern already used by `governance-verification.yml`.

## 4. How each required failure condition fails the job

All four verdicts inside `scripts/typecheck-certification.js` set the same `failed` flag and
funnel into one `process.exit(failed ? 1 : 0)` at the end of the script. The gate step
propagates that exit code verbatim.

| # | Condition | Where it is decided (unmodified PB-009/PB-011 code) | Exit |
|---|---|---|---|
| 1 | **Net-new backend type debt** | `errors > baseline` → `failed = true`; **and** `diff.netNewCount > 0` → `failed = true` (identity ratchet: fires even when the scalar total is unchanged) | `1` |
| 2 | **Certification coverage regression** | `missing.length > 0` → `failed = true` (disk enumeration vs `tsc --listFiles`) | `1` |
| 3 | **Parser integrity failure** | `!FP.assertParseComplete(...).ok` → `failed = true` | `1` |
| 4 | **Baseline / fingerprint inconsistency** | `diff.baselineTotal !== baseline` → `failed = true`; also a missing per-project fingerprint baseline → `failed = true` | `1` |
| — | tsc could not be executed | `spawnFailed` → `failed = true` | `1` |

**Preserved, and explicitly not failures:** pre-existing baselined debt (informational);
debt **reduction** (`errors < baseline`, or resolved fingerprints) which **passes** and prints
the re-baseline instruction.

## 5. Required commit set (blocking prerequisite)

At the time PB-012 was written, the certification pipeline was **present in the working tree
but not in git**. A workflow cannot run a script that is not on the branch. All of the
following must be committed for this workflow to be anything other than red:

```
scripts/typecheck-certification.js                    (untracked)
scripts/lib/typecheckFingerprint.js                   (untracked)
scripts/typecheck-certification-baseline.json         (untracked)
scripts/typecheck-certification-fingerprints.json     (untracked)
tsconfig.backend-tests.json                           (untracked)
package.json                                          (modified — adds typecheck:backend-tests,
                                                       typecheck:certification,
                                                       typecheck:certification:inventory,
                                                       typecheck:certification:baseline)
.github/workflows/typecheck-certification.yml         (new, PB-012)
```

The preflight step names precisely which of these is missing rather than failing obscurely.

### 5.1 CORRECTION (PB-012R) — the list above is necessary but **NOT sufficient**

> **Do not commit the seven files above on their own.** PB-012R measured it: a clean checkout
> of `HEAD` + exactly those seven files produces
> `errors: 504 (baseline 470)` · `FINGERPRINT FAIL — 38 net-new` · **`RESULT: FAIL`, exit 1**.
> The workflow's *first ever run* would be red, and the redness would be entirely
> self-inflicted.

The reason is that the `470` / `1` baselines and the `1111` / `2961` coverage denominators were
measured against the **working tree**, not against `HEAD`. The baseline therefore encodes the
state of the whole Program-B working tree, and the pipeline cannot be committed in isolation:

* **PB-010's ten test-layer fixes are uncommitted modifications.** Without them a fresh
  checkout reintroduces 38 errors (32 `TS2451`/`TS2393` global-script collisions + collateral,
  plus 1 `TS2305` in `backend/tests/utils/createSupabaseMock.ts`). 470 + 38 = 508 — PB-009's
  original opening baseline.
* **Two untracked Program-B test files carry 4 errors that are counted *inside* the 470**
  (`gatewayProviderCapabilities.test.ts` ×1, `perplexityAdapterCapabilityAdoption.test.ts` ×3 —
  the PB-005/PB-008 errors §6.2 grandfathers). Omit them and the artifacts describe files that
  are not in the repository.
* Those tests import Platform modules that are themselves untracked or modified, so the
  transitive closure pulls in the Program-B gateway/metadata/identity/capability layer.

`504 = 470 + 38 − 4`, exactly. The complete, empirically validated commit set — a clean
`HEAD` checkout plus these files reproduces `1/1`, `470/470`, `2961/2961`, `1111/1111`,
`RESULT: PASS`, exit 0 — is specified in the PB-012R deployment checklist. Nothing in this
document's §1–§4 or §6–§8 changes; only this list was incomplete.

> **`package.json` hazard.** This repository has previously had pre-commit tooling strip
> `package.json` script edits. After committing, re-verify that the four
> `typecheck:certification*` / `typecheck:backend-tests` scripts survived — if they are
> stripped, the preflight step fails the job with `MISSING: package.json script
> "typecheck:certification"`, which is loud and correct, but the pipeline is disarmed until
> they are restored.

## 6. Baseline update and approved re-baselining procedure

**A baseline change is a governance change, not a build artifact.** CI never writes one.

### 6.1 The two artifacts

| Artifact | Holds |
|---|---|
| `scripts/typecheck-certification-baseline.json` | per-project **scalar** totals — currently `tsconfig.backend.json: 1`, `tsconfig.backend-tests.json: 470` |
| `scripts/typecheck-certification-fingerprints.json` | every individual diagnostic's **identity** `(file, TS code, normalized message) + count` |

They must always be regenerated **together**. The guard fails (condition 4) if their totals
disagree, so a half-update cannot reopen the scalar hole.

### 6.2 When you are allowed to re-baseline

| Situation | Action |
|---|---|
| You **reduced** debt (guard PASSES and prints a re-baseline instruction) | Re-baseline to lock the gain, in a dedicated commit |
| You **introduced** net-new debt | **Fix it.** Re-baselining is not the remedy |
| Net-new debt is an unavoidable, accepted cascade | Re-baseline **with `--accept-new-debt`**, which prints every absorbed fingerprint into the review record — and state the justification in the commit message |
| Totals rose for any other reason | Refused by the tool; the certification baseline ratchets **down only** |

### 6.3 The procedure

```bash
# 1. Confirm the current state and read the instruction the guard prints.
npm run typecheck:certification

# 2. Re-baseline. Locally. Never in CI.
npm run typecheck:certification:baseline
#    …or, only when absorbing accepted net-new debt:
node scripts/typecheck-certification.js --update-baseline --accept-new-debt

# 3. Re-run the guard clean.
npm run typecheck:certification        # expect RESULT: PASS

# 4. Commit BOTH artifacts together, in a dedicated commit, stating the reason.
```

`--update-baseline` **refuses**:

- **under CI** — `CI` env set (the workflow exports `CI: 'true'` explicitly, so an automated
  rewrite is impossible even if someone wired the wrong npm script into a job);
- when **coverage is failing** — otherwise it would lock in a number lowered by exclusion;
- when the **parser was incomplete** — a baseline built from a partial parse has blind spots;
- when a total would **rise**;
- when **net-new fingerprints** would be absorbed, unless `--accept-new-debt` is passed
  explicitly, in which case each absorbed fingerprint is printed.

## 7. Validation

### 7.1 Certification is green at baseline (unchanged)

`CI=true node scripts/typecheck-certification.js` → **`RESULT: PASS`, exit 0**:

```
=== certification typecheck: tsconfig.backend.json ===
coverage: 2961/2961 expected files in program
errors:   1 (baseline 1)              PASS — at baseline, no regression
fingerprints: 1 baselined file(s) / 1 baselined error(s) · net-new 0 · resolved 0
=== certification typecheck: tsconfig.backend-tests.json ===
coverage: 1111/1111 expected files in program
errors:   470 (baseline 470)          PASS — at baseline, no regression
fingerprints: 115 baselined file(s) / 470 baselined error(s) · net-new 0 · resolved 0
RESULT: PASS
```

**Measured wall clock: 193 s (3 m 13 s)** for both non-incremental `tsc` passes
(2,961 + 1,111 files). Peak sampled `node` working set: **~3.1 GB**. This is comfortably
practical per PR; no narrowing of the check was necessary. See §9 for the runner-memory risk.

### 7.2 Net-new debt fails the exact gate pipeline

An untracked `backend/__pb012_exitcode_probe.ts` containing one deliberate type error was run
through the workflow's literal gate command
(`set -o pipefail; npm run typecheck:certification 2>&1 | tee typecheck-certification.log`):

```
coverage: 2962/2962 expected files in program        <- disk walk stays honest
errors:   2 (baseline 1)
FAIL — 1 new TypeScript error(s) above baseline
fingerprints: … net-new 1 · resolved 0
FINGERPRINT FAIL — 1 net-new type error(s) whose identity is NOT in the baseline
  [ATTRIBUTED  ] backend/__pb012_exitcode_probe.ts
      TS2322: Type 'string' is not assignable to type 'number'.
RESULT: FAIL
GATE_EXIT=1        <- the exit code the workflow step propagates
```

The probe was then deleted; `git status` shows no residue, and both baseline artifacts are
byte-identical (SHA-256 `4f4ebf84…` / `042f392e…`) before and after. The **second** full run
also measured **173 s**, consistent with §7.1.

Rendering of the job-summary step was exercised under GitHub's exact shell
(`bash --noprofile --norc -eo pipefail`) against a PASS log, this FAIL log, a heap-limit log
with no `RESULT:` line, and a missing log — producing `PASS`, `FAIL` (with the failing
conditions block populated), `INCOMPLETE`, and `UNKNOWN` respectively, each with exit 0 so the
summary can never alter the job's verdict.

### 7.3 `pipefail` is load-bearing

```
pipefail + tee, command exits 1   -> propagated exit=1
pipefail + tee, command exits 0   -> propagated exit=0
WITHOUT pipefail, command exits 1 -> swallowed exit=0     <-- the bug this avoids
```

### 7.4 Existing gate untouched

`.github/workflows/typecheck-baseline.yml` is **byte-identical to `HEAD`**
(SHA-256 `8f48f9ed…` both sides); its job name `Non-regression TypeScript baseline` — the
repository's one required check — is unchanged, and the new job name
`Backend TypeScript certification` collides with no existing job name across the now-ten
workflows.

`npm run typecheck:ci` re-run: **`RESULT: PASS`, exit 0, actual 54 vs baseline 86** (435 s).
Notably it held **~5.4 GB** resident — the *existing required* gate is the heavier of the two;
the PB-012 certification job peaked around **3.1 GB**.

### 7.5 Behaviour unchanged

Jest regression baseline re-run: **16 suites, 440/440 passed** (12 Program-B gateway/provider/
adapter suites + `uploadMediaDirect`, `uploadMediaFinalize`, `rescheduleApi`,
`creatorAuditTrail`). PB-012 touched no runtime, product, test or `scripts/**` file, so this is
a control, not a claim of coverage.

### 7.6 What is **not** verified

**A GitHub Actions workflow cannot be proven green without pushing it.** What was validated
locally is: the YAML parses and has the intended structure; the exact commands the workflow
invokes run locally with the expected exit codes; no step suppresses a failure. **The first
real CI execution remains unverified** until the owner pushes the branch and opens a PR.

## 8. The branch-protection gap (why this is NOT yet enforcement)

> **A workflow file makes a check RUN. It cannot make a check REQUIRED to merge.**

Marking a status check as required is a GitHub branch-protection setting, configured in repo
admin / the GitHub API. It is not a file in this repository and PB-012 cannot perform it.

**To actually block merges, the owner must register this exact check name:**

```
Backend TypeScript certification
```

on the `main` branch-protection rule (Settings → Branches → `main` → Require status checks to
pass before merging), alongside the existing `Non-regression TypeScript baseline`. The check
must have reported at least once (i.e. after the first push) before GitHub will offer it in
the picker.

**Until that registration is performed, a red certification run is visible but advisory: a PR
can still be merged over it.** `docs/ENGINEERING-GOVERNANCE.md` §4 therefore continues to
classify this check as **Advisory**, and §6's required-check list continues to name only
`Non-regression TypeScript baseline`, because that is the truth on the ground.

**Do not rename the job.** Branch protection keys on the job name; a rename silently
un-registers the check and the protection is lost without any error.

## 9. Risks

1. **Advisory until registered (§8).** The single largest gap. Nothing in this repository can
   close it.
2. **Inert until the pipeline is committed (§5).** Until the untracked `scripts/**`,
   `tsconfig.backend-tests.json` and the `package.json` scripts land, the workflow fails at
   preflight on every PR. It fails loudly and explains itself, but it is red, not green.
3. **Runner memory.** The guard spawns each `tsc` with `--max-old-space-size=8192` (PB-009
   code, unmodified). A standard GitHub-hosted `ubuntu-latest` runner has ~7 GB (16 GB on
   larger runners). The flag is a *cap*, not a reservation, and the locally sampled peak was
   ~3.1 GB, so it should fit — and the **already-required** `typecheck:ci` job runs heavier
   (~5.4 GB locally) on the same runner class today without incident. If OOM is nonetheless
   observed on CI, the correct fix is a larger runner label, **not** narrowing what is checked.
4. **Runtime.** ~3m15s of `tsc` plus `npm ci` and checkout. Acceptable per PR; the npm cache
   keeps the install cheap. If the backend surface grows enough to make this impractical, the
   documented alternative is to keep it required on PRs with caching, or split it into a
   scheduled job — **not** to reduce coverage or switch to incremental compilation, either of
   which would change what the guard proves.
5. **Concurrency cancellation.** A superseded run reports `cancelled`, not `success`. This is
   the standard pattern already used by `governance-verification.yml`; the newest commit's run
   is the one branch protection evaluates.
6. **`package.json` stripping (§5).** Fails closed and loudly, but disarms the pipeline until
   restored.

## 10. Rollback

Delete `.github/workflows/typecheck-certification.yml` and revert the two documentation edits.
No runtime, product, Platform, test, `tsconfig`, `scripts/**` or baseline-artifact impact —
none of those were touched.
