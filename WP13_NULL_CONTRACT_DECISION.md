# WP-13 — Strict Null Contract: Engineering Decision

**Workstream:** REPORT-1-COMPLETION-PARALLEL-ORCHESTRATION-012, Track L (WP-13)
**Base:** `3d643f5c` (= `origin/main`, the production-verified Report 1 release)
**Worktree:** `C:/tmp/r1-wp13`, branch `r1/wp13-null-contract`
**Upstream read (read-only):** WP-12, closed at T1 PASS — `6dd5e487` (implementation) and
`34681e6a` (contract fix), on `r1/wp12-competitive-baseline` in `C:/tmp/r1-wp12`.
**Wave type:** DECISION-ONLY. No production source file was modified. The reasoning for keeping
it decision-only now that WP-12's ownership lock has lifted is in §6.

---

## 1. THE DECISION

> **Remedy (d) — a narrowly scoped architectural fix, built entirely from conventions this
> repository already owns, in three parts:**
>
> 1. **Structural.** Make the existing `CRAWL_OBSERVED_DIMENSIONS` /
>    `CRAWL_UNOBSERVED_DIMENSIONS` partition the only sanctioned way production code may
>    iterate comparison dimensions. All three zero-collapse defects were *uniform iteration
>    over a dimension set that is not uniform*. The repository already exports the correct
>    partition and **no production file consumes it** (§3.6).
> 2. **Arithmetic.** One import-free leaf module, `comparisonArithmetic.ts`, deduplicating the
>    **four existing private copies of two functions** that already implement the correct
>    guard.
> 3. **Enforcement.** A source-text tripwire test. This is not a fallback — §3.4 proves by
>    measurement that **no compiler configuration and no type shape can catch a `?? <default>`**,
>    and three of WP-12's four defect classes were written that way or as a silent duplicate
>    declaration.
>
> Plus two concrete repairs: an honest `MetricDeltas` type that removes the last four
> nullability-discarding casts, and the one **still-live** zero-collapse defect in
> `visualIntelligenceHelpers.ts`.
>
> **No compiler-option change. No wire-format change. No new type vocabulary. No schema, no
> migration.**

**Rejected:** a `Measured<T> | Unavailable` wrapper — not because it is weak (it is the *only*
option with real compile-time teeth, measured in §3.4), but because it still would not have
caught two of the four defects, it diverges from this repository's own established
`ScoreEnvelope` convention, and it changes a persisted payload shape (§3.6, §3.7, §5).

---

## 2. THE CENTRAL QUESTION, ANSWERED DIRECTLY

> *Can the contract make "unmeasured / unavailable" structurally distinct from "measured zero",
> and prevent unavailable metrics entering arithmetic as though they were observations?*

**Partly — and the part it cannot reach is where the damage actually happened.**

Measured, not assumed (full output in §3.4–3.5):

| Hazard form | Example from the real defects | `strict:false` (today) | `strictNullChecks` | State-bearing union |
|---|---|---|---|---|
| bare arithmetic on an absent value | `a.pf - b.pf` | **silent** | caught (TS18047) | caught (TS2339) |
| member read, then default | `Number(delta.geo_presence ?? 0)` — **defect 2b / B1 / B3** | **silent** | **silent** | caught (TS2339) *only if the absent branch omits the property* |
| whole-object default | `company ?? EMPTY_COMPARISON_METRICS` — **defect 2a / B2** | **silent** | **silent** | **silent** |
| duplicate contradicting declaration | **defects 1 and 3** | **silent** | **silent** | **silent** |

So: structural distinction buys real protection against *arithmetic* — the hazard the original
test header names, and the one that is **already correctly guarded at all eight seam sites**
(§3.9.A). It buys **nothing** against `?? <default>`, which is how two of the four real defects
were written, and nothing against a duplicate declaration, which is how the other two were.

`X ?? Y` is well-typed whenever `Y` is well-typed. No compiler setting and no type shape changes
that. **That single fact decides this workstream.** The contract must be enforced by something
that is not the type system, and the type work should be confined to what is cheap, honest and
non-churning.

---

## 3. EVIDENCE

### 3.1 The actual typecheck setup

```
$ node -e "console.log('tsc', require('typescript/package.json').version)"
tsc 6.0.3
```

`package.json`:

```
typecheck                        = node scripts/typecheck-all.js
typecheck:ci                     = node scripts/typecheck-baseline.js
typecheck:backend-tests          = tsc -p tsconfig.backend-tests.json --noEmit --incremental false
typecheck:certification          = node scripts/typecheck-certification.js
typecheck:certification:baseline = node scripts/typecheck-certification.js --update-baseline
```

**There are TWO governed surfaces, not one.** The brief's "3 projects, baseline 0 / actual 0" is
the first of them.

| Surface | Script | Projects | Baseline artefact | Baseline |
|---|---|---|---|---|
| Aggregate (required CI check) | `scripts/typecheck-baseline.js` → `scripts/typecheck-all.js` | `tsconfig.json`, `tsconfig.backend.json`, `tsconfig.scripts.json` | `scripts/typecheck-baseline.json` | **0** |
| Backend certification | `scripts/typecheck-certification.js` | `tsconfig.backend.json`, `tsconfig.backend-tests.json` | `…-certification-baseline.json` + `…-certification-fingerprints.json` | **0** / **260** |

The certification surface carries a second, stricter ratchet: a per-error *identity* fingerprint
`(file, TS code, normalized message)`. Fixing one baselined error and introducing a different one
leaves the scalar flat and **still fails**. Any remedy that moves a single diagnostic on either
project must clear that, not just the count.

Measured baseline of the project owning the five files:

```
$ node ./node_modules/typescript/bin/tsc -p tsconfig.backend.json --noEmit --incremental false
EXIT=0
```

### 3.2 Which projects cover the five files; is `backend/tests` excluded?

`tsconfig.backend.json` and `tsconfig.scripts.json` both carry `"backend/**/*.ts"` in `include`,
so the five files are root files of both. `tsconfig.json` does not list `backend/**`, but its
`include` carries `pages/**/*.ts`, and `pages/api/reports/*` import backend services — `exclude`
filters `include` globs, it does not stop a file entering a program through an import, so the
five are in the root program transitively as well.

**`backend/tests` is excluded from all three — verified empirically, not from config text:**

```
$ for p in tsconfig.json tsconfig.backend.json tsconfig.scripts.json; do
    n=$(tsc -p $p --noEmit --incremental false --listFiles | grep -ci "backend/tests/"); \
    echo "$p : backend/tests files in program = $n"; done
tsconfig.json : backend/tests files in program = 0
tsconfig.backend.json : backend/tests files in program = 0
```

The third run was stopped by the background time limit before completing and is therefore **not
reported as measured**. Its `exclude` list is byte-identical to `tsconfig.backend.json`'s
(`"backend/tests"`, `"**/*.test.ts"`, `"**/*.spec.ts"`), and nothing imports a test file, so
nothing pulls one in transitively. Close it with
`tsc -p tsconfig.scripts.json --listFiles | grep -c "backend/tests/"` run alone.

**Correction to the premise:** "excluded from all three" is not "unchecked".
`tsconfig.backend-tests.json` exists precisely to type-check that surface (PB-009), and
`report1CompetitiveBaselineIntegrity.test.ts` is inside it. Its header states why it must exist:
root `tsconfig.json` sets `"isolatedModules": true`, so **ts-jest is transpile-only and never
type-checks**. A green jest run is not evidence that a test type-checks.

### 3.3 Scoped `strictNullChecks` — MEASURED, and infeasible

**TypeScript 6.0.3 has no per-file or per-directory strictness.** No `// @ts-strict` pragma, no
per-path override. Strictness is a *program* option, so "scoped narrowly" can only mean "a
separate `tsc` project", and a project that includes a file type-checks that file's entire
transitive import graph under the same flag.

**Measurement A — whole backend project:**

```
$ tsc -p tsconfig.backend.json --noEmit --incremental false --strictNullChecks
errors:       585
unique files: 186
```

585 against a baseline of 0.

**Measurement B — the narrowest scope that can exist.** Scratch config (deleted before commit),
`include` = exactly the five subject files, `extends ./tsconfig.json`, `strictNullChecks: true`:

```
$ tsc -p tsconfig.wp13-scratch.json --noEmit --listFiles
exit=2
errors in program:                      84
repo .ts files pulled into the program: 723
```

```
  18  backend/services/companyProfileServiceRest1Rest2Competitors.ts
  11  backend/services/companyProfile/entityArchetype.ts
   9  backend/services/companyProfile/governance.ts
   6  backend/services/reportCompetitorIntelligenceServiceHelpers.ts   <-- subject
   6  backend/services/companyProfileServiceCore.ts
   5  backend/services/reportCompetitorIntelligenceServiceEngine.ts    <-- subject
   5  backend/services/companyProfileServiceRest1Enrich.ts
   4  backend/services/serpAcquisitionService.ts
   3  backend/services/engagementNormalizationService.ts
   2  lib/redis/usageProtectionRuntime.ts
   2  backend/services/leadIntelligenceOrchestration/orchestrator.ts
   2  backend/services/engagementIngestionService.ts
   2  backend/services/companyProfileServiceRest1Rest2Pulse.ts
   2  backend/services/companyProfile/userGuidance.ts
   2  backend/services/aiGatewayCore.ts
   1  backend/services/reportInputResolver.ts
   1  backend/services/planResolutionService.ts
   1  backend/services/googleProviderReadinessService.ts
   1  backend/services/communityAiAutoRuleService.ts
   1  backend/services/ai/aiGuardLua.ts
```

**84 errors; 11 (13%) in the subject files; 73 (87%) in 18 unrelated modules; 723 repo files in
the program.** Five files is already the floor, and the floor cascades.

**And the 11 in-scope errors are not the hazard:**

```
Engine(245,51): TS2345: CompetitorComparisonEntry[] (Model) not assignable to … (Helpers)
Engine(438,7):  TS2322: 'ComparisonMetrics | null' is not assignable to 'ComparisonMetrics'
Engine(459,63): TS2345: ComparisonMetrics (leaf) not assignable to ComparisonMetrics (local)
Engine(658,7):  TS2322: 'ComparisonMetrics | null' is not assignable to 'ComparisonMetrics'
Engine(722,63): TS2345: ComparisonMetrics (leaf) not assignable to ComparisonMetrics (local)
Helpers(1097,5): TS2322: Type 'number | null' is not assignable to type 'number'
Helpers(1098,5): TS2322: …
Helpers(1100,5): TS2322: …
Helpers(1127,5): TS2322: …
Helpers(1128,5): TS2322: …
Helpers(1130,5): TS2322: …
```

Not one is `null` in arithmetic. All eleven are symptoms of **defect class 1** — the duplicate
`ComparisonMetrics` at `…Helpers.ts:35` typing all seven dimensions as plain `number`. WP-12
deleted it in `6dd5e487`, so even that 13% is now moot.

**Verdict on (a): infeasible at any scope — and §3.4 shows it catches neither `??` defect.**

### 3.4 THE DECIDING MEASUREMENT — can anything catch a `??` default?

```
$ cat nullish.ts
type Nullable = { pf: number | null };
export function d1(x: Nullable): number { return Number(x.pf ?? 0); }          // defect 2b shape
type Metrics = { pf: number | null };
const EMPTY: Metrics = { pf: 0 };
export function d2(m: Metrics | null): Metrics { return m ?? EMPTY; }          // defect 2a shape
type DimA = { state: 'measured'; value: number } | { state: 'unavailable'; value: null };
export function d3(x: { pf: DimA }): number { return Number(x.pf.value ?? 0); }
type DimB = { state: 'measured'; value: number } | { state: 'unavailable' };
export function d4(x: { pf: DimB }): number { return Number(x.pf.value ?? 0); }
export function d5(x: { pf: DimB }): number { return Number(x.pf ?? 0); }
export function d6(x: { pf: DimB }, y: { pf: DimB }): number { return x.pf.value - y.pf.value; }

$ tsc --noEmit --strict false --target ES2020 nullish.ts
nullish.ts(15,66): error TS2339: Property 'value' does not exist on type 'DimB'.
  Property 'value' does not exist on type '{ state: "unavailable"; }'.
nullish.ts(17,76): error TS2339: Property 'value' does not exist on type 'DimB'.
nullish.ts(17,89): error TS2339: Property 'value' does not exist on type 'DimB'.
exit=2

$ tsc --noEmit --strict false --strictNullChecks --target ES2020 nullish.ts
   ...byte-identical output, exit=2
```

Read off the line numbers:

- **d1 (line 5) — `Number(x.pf ?? 0)`, the shape of defects 2b / B1 / B3: NO ERROR, in BOTH modes.**
- **d2 (line 9) — `m ?? EMPTY_COMPARISON_METRICS`, the shape of defect 2a / B2: NO ERROR, in BOTH modes.**
- d3 (line 13) — state-bearing union that keeps `value` on both branches: **NO ERROR**. A union
  alone is not enough; the absent branch must omit the property.
- d4 (line 15) — union with the property omitted: **TS2339, both modes.** Caught.
- d5 (line 16) — `Number(x.pf ?? 0)` on that same union: **NO ERROR** (`Number()` accepts
  anything). Runtime gives `NaN` rather than `0` — louder, but not a compile error.
- d6 (line 17) — bare arithmetic on the union: **TS2339, both modes.** Caught.

**Conclusions, all measured:**

1. **`strictNullChecks` catches neither `??` defect.** This rejects remedy (a) on *correctness*,
   independently of the 84/585 cost: it would have caught nothing that actually happened.
2. **A property-omitting discriminated union is the only shape with compile-time teeth** — and it
   has them **under `"strict": false`, identically**. Strictness is not the lever; shape is.
3. **Nothing catches `whole ?? wellTypedDefault`.** Defect 2a is unreachable by any type-system
   configuration. That is the hard limit, and it is why §4's enforcement is a tripwire.

### 3.5 Branding, and the stated premise, for completeness

```
$ cat union.ts   (excerpt)
type MeasuredNum = number & { readonly __measured: unique symbol };
export function brandedNullAssign(): MeasuredNum { const x: MeasuredNum = null; return x; }

$ tsc --noEmit --strict false --target ES2020 union.ts
exit=0                                 <-- null assigned to a branded number: NO ERROR
$ tsc --noEmit --strict false --strictNullChecks --target ES2020 union.ts
union.ts(20,9): error TS2322: Type 'null' is not assignable to type 'MeasuredNum'.
```

Under `"strict": false`, `null` is assignable to every type, so **branding buys nothing**.

The brief's premise, confirmed verbatim:

```
$ cat nullarith.ts
type M = { pf: number | null };
export function bad(a: M, b: M): number { return a.pf - b.pf; }
export function bad2(a: M): number { return a.pf * 0.3; }
export function cmp(a: M): boolean { return a.pf >= 8; }

$ tsc --noEmit --strict false --target ES2020 nullarith.ts
exit=0
$ tsc --noEmit --strict false --strictNullChecks --target ES2020 nullarith.ts
nullarith.ts(3,10): error TS18047: 'a.pf' is possibly 'null'.
nullarith.ts(3,17): error TS18047: 'b.pf' is possibly 'null'.
nullarith.ts(6,10): error TS18047: 'a.pf' is possibly 'null'.
nullarith.ts(9,10): error TS18047: 'a.pf' is possibly 'null'.
exit=2
```

### 3.6 The existing project conventions — found, and one of them unused

Reusing an established convention beats inventing one. Two exist; the second is the useful one.

**(i) `ScoreState` / `ScoreEnvelope`** — `backend/services/snapshotReport/canonicalScoreState.ts`:

```ts
export type ScoreState = 'measured' | 'inferred' | 'insufficient_signal' | 'unavailable';
export type ScoreEnvelope = {
  value: number | null;
  state: ScoreState;
  confidence: ConfidenceBand;
  evidence_count: number;
  evidence_sources: EvidenceSourceTag[];
  freshness: { last_observed_at: string | null; age_hours: number | null };
};
```

It is live — `snapshotReportService.ts:431` builds one via `measuredEnvelope(...)`. **Note the
shape: `value: number | null` paired with a `state` tag.** This repository's own canonical
"score that might be unavailable" is *exactly* the `d3` shape from §3.4 — the one measured to
give **no** compile-time protection. A property-omitting union would therefore not be reusing the
house convention; it would diverge from it and leave `ScoreEnvelope` standing beside it as a
second, weaker standard. WP-12 already extended the sound half of this convention
(`metrics_state` / `metrics_basis`, now also `company_metrics_state` / `company_metrics_basis`);
that pairing stays exactly as it is.

**(ii) The dimension partition — the convention that actually matches the defects.**
`backend/services/competitor/competitorMetricsEvidence.ts:106,122`:

```ts
export const CRAWL_OBSERVED_DIMENSIONS:   readonly (keyof ComparisonMetrics)[] = [...];  // 4
export const CRAWL_UNOBSERVED_DIMENSIONS: readonly (keyof ComparisonMetrics)[] = [
  'publishing_frequency', 'engagement_score', 'geo_presence',
];
```

Every consumer, measured:

```
$ grep -rn "CRAWL_OBSERVED_DIMENSIONS\|CRAWL_UNOBSERVED_DIMENSIONS" backend/services backend/tests pages --include="*.ts"
backend/services/competitor/competitorMetricsEvidence.ts:106:export const CRAWL_OBSERVED_DIMENSIONS…
backend/services/competitor/competitorMetricsEvidence.ts:122:export const CRAWL_UNOBSERVED_DIMENSIONS…
backend/tests/unit/d8CompetitorEvidenceIntegrity.test.ts:53:  CRAWL_OBSERVED_DIMENSIONS,
backend/tests/unit/d8CompetitorEvidenceIntegrity.test.ts:54:  CRAWL_UNOBSERVED_DIMENSIONS,
backend/tests/unit/d8CompetitorEvidenceIntegrity.test.ts:232:    for (const dimension of CRAWL_UNOBSERVED_DIMENSIONS)
backend/tests/unit/d8CompetitorEvidenceIntegrity.test.ts:236:    expect(CRAWL_OBSERVED_DIMENSIONS).toEqual(
```

**Zero production consumers. One test.** The repository already states, as data, which three
dimensions can never be observed — and no production code asks.

That is the root cause of every zero-collapse defect. Each one iterates a dimension set as if it
were uniform:

- **defect 2b / B1:** seven values, fixed denominator **7**;
- **defect 2a / B2:** a seven-field zero literal;
- **B3 (still live):** five values including `geo_presence`, denominator **5**.

Three instances of one mistake. The constant that prevents it has existed the whole time.

### 3.7 `ComparisonMetrics` is a persisted payload shape

`backend/services/snapshotReportService.ts:515` writes `competitor_intelligence:
competitorIntelligence` into the snapshot report, and
`pages/api/reports/reportComposedMapper.ts:200-206` reads
`report.competitor_intelligence.comparison?.competitors[].deltas_vs_company` back out of a
**stored** report. Changing `number | null` to `{state, value}` on the wire would break every
already-persisted report and every downstream reader. This is the structural reason remedy (c)
cannot be applied where it would have teeth.

### 3.8 How many files genuinely consume `ComparisonMetrics`? MEASURED — 10 (5 production)

```
$ grep -rln "ComparisonMetrics" --include="*.ts" --include="*.tsx" . | grep -v node_modules
./backend/services/competitor/competitorMetricsEvidence.ts          PRODUCTION
./backend/services/competitor/competitorMetricsTypes.ts             PRODUCTION (declaring module)
./backend/services/reportCompetitorIntelligenceServiceEngine.ts     PRODUCTION
./backend/services/reportCompetitorIntelligenceServiceHelpers.ts    PRODUCTION
./backend/services/reportCompetitorIntelligenceServiceModel.ts      PRODUCTION
./backend/tests/unit/d8CompetitorEvidenceIntegrity.test.ts          TEST
./backend/tests/unit/d8SeamTypeBoundary.test.ts                     TEST
./backend/tests/unit/report1CompetitiveBaselineIntegrity.test.ts    TEST
./backend/tests/unit/reportCompetitorIntelligenceService.test.ts    TEST
./backend/tests/unit/unionMatrixReport1.test.ts                     TEST
count = 10
```

**Five production files — exactly WP-12's owned set. Verified independently.**

The "~130" estimate came from matching *field names*. That sweep returns **64 files**, nearly all
in an unrelated engagement/analytics domain that never references the type —
`lib/blog/growthEngine.ts` (14 hits), `lib/blog/performanceEngine.ts` (10),
`backend/services/engagementOpportunityEngine.ts` (10),
`backend/services/marketPositioningEngine.ts` (7), and so on. `engagement_score` is a popular
column name; a field-name sweep is not a type-usage measurement.

### 3.9 Runtime blast radius — every arithmetic site on the three nullable dimensions

**A. Correctly guarded today (no change needed):**

| Site | Guard |
|---|---|
| `…Helpers.ts:1086-1087` `delta()` | `typeof left === 'number' && typeof right === 'number'`, else `null` |
| `…Helpers.ts:1113-1116` `averagePresent()` | `.filter((v): v is number => typeof v === 'number')`, `null` when empty |
| `…Engine.ts:212-214` `gapBetween()` | same pair guard |
| `…Engine.ts:217-220` `meanPresent()` | same filter guard |
| `…Engine.ts:231` `buildGapDefinitions` | `if (params.companyMetrics == null) return []` |
| `…Engine.ts:246` | `if (!averageMetrics) return []` |
| `…Engine.ts:250,268,286,304,322` | every `gap !== null && gap >= N` tests null before the threshold |
| `snapshotReport/competitorSummaryHelpers.ts:135-137` | the 0.3 publishing-cadence radar weight is explicitly `typeof`-guarded |

Eight sites, all correct, all shipped with REMEDIATION-003. **This is why remedy (b) alone is not
the answer: the guards are already there and the defects still happened elsewhere.**

**B. Zero-collapse — the real defect class, three instances:**

| # | Site | Defect | Status |
|---|---|---|---|
| B1 | `pages/api/reports/reportViewUtils.ts:85-94` | `Number(delta.x ?? 0)` over seven dimensions, `/ 7`. Three are null on every report, so every verdict was dragged 3/7 toward parity; a competitor 12 points ahead reported "At Par". | **FIXED by WP-12** `6dd5e487` |
| B2 | `…ServiceModel.ts:303,412` | `comparison.company ?? EMPTY_COMPARISON_METRICS` published a baseline of **zero on all seven dimensions** — a measurement claim that the company has no content, no authority, no coverage. | **FIXED by WP-12** `6dd5e487` |
| B3 | `backend/services/snapshotReport/visualIntelligenceHelpers.ts:250-258` | `averageNumber([… Number(deltas.geo_presence ?? 0) …])` over five values, feeding `clamp(parity − avgDelta × slope)`. `geo_presence` is null on **every** report, so a measured zero enters and every standing score is diluted 1/5 toward parity (60). `.filter(Number.isFinite)` does not help — `0` is finite. | **STILL LIVE** |

B3 is confirmed outside WP-12's file set:

```
$ git -C C:/tmp/r1-wp12 diff --name-only 3d643f5c 34681e6a
backend/services/competitor/competitorMetricsEvidence.ts
backend/services/reportCompetitorIntelligenceServiceEngine.ts
backend/services/reportCompetitorIntelligenceServiceHelpers.ts
backend/services/reportCompetitorIntelligenceServiceModel.ts
backend/tests/unit/report1CompanyBaselineObservation.test.ts
pages/api/reports/reportComposedTypes.ts
pages/api/reports/reportViewUtils.ts

$ git -C C:/tmp/r1-wp12 diff --name-only 3d643f5c 34681e6a -- backend/services/snapshotReport/visualIntelligenceHelpers.ts | wc -l
0
```

**B1 and B3 are the same bug written twice.** WP-12 fixed one because it happened to own that
file. That is the evidence that a per-site guard is not a contract.

**C. Declarations contradicting the runtime value:**

| Site | Problem | Status |
|---|---|---|
| `…Helpers.ts:35-43` duplicate `ComparisonMetrics`, all seven `number` (**defect 1**) | the nullable contract was not in force in the module owning the arithmetic | **FIXED by WP-12** `6dd5e487` |
| `reportComposedTypes.ts:233-241` `deltas_vs_company` all `number?` (**defect 3**) | producer emits `null` | **FIXED by WP-12** `34681e6a` |
| `…Helpers.ts:1093-1103` `subtractMetrics(): ComparisonMetrics` with `delta(...) as number` ×4 | a delta is **not** a measurement; typing it as one forces four casts that deliberately launder `number \| null` into `number` | **STILL PRESENT** at `34681e6a` — verified by reading `6dd5e487:…Helpers.ts` |

**D. Defect class 4 — `resolveCompetitorMetrics(companyMetrics)`.** Confirmed as WP-12 reports.
Both real callers (`…Engine.ts:453-457` sync, `…Engine.ts:708-712` async) pass a company baseline
whose three mirrored dimensions are `null` by construction — the sync path observes nothing, and
`resolveCompanyMetrics` hard-codes all three to `null`. So `companyMetrics?.publishing_frequency
?? null` always yields `null` today: a latent architectural risk, not a live defect. It is covered
by tripwire rule 9 (D5) rather than by a code change; narrowing the parameter type is listed as
optional hardening in D8.

### 3.10 Test state at the base commit

```
$ node ./node_modules/jest/bin/jest.js backend/tests/unit/report1CompetitiveBaselineIntegrity.test.ts --runInBand --forceExit
PASS backend/tests/unit/report1CompetitiveBaselineIntegrity.test.ts (94.742 s)
  REMEDIATION-003 — competitive baseline integrity
    √ never lets a null coerce to zero in a delta — strict is false, so this is runtime-enforced
    A. the synthesized company baseline no longer exists
      √ returns null for the inputs that previously produced seven numbers (9 ms)
      √ emits no numeric baseline under any input — the constants are unreachable (2 ms)
    B. genuine competitor observation is preserved
      √ keeps the four crawl-derived dimensions when the company baseline is absent (3 ms)
      √ no longer mirrors the company baseline onto a competitor (1 ms)
      √ an unobserved competitor still yields null metrics and keeps its outcome (2 ms)
    C. competitor observed, company unavailable
      √ emits NO gaps rather than treating the competitor value as the gap (165 ms)
      √ does not substitute zero, a constant or a floor (2 ms)
    D. both sides supported
      √ still produces a gap when the comparison is mathematically meaningful (2 ms)
      √ subtractMetrics computes real deltas and nulls the unsupported dimensions (3 ms)
    E. company supported, competitor unavailable
      √ emits no gap from an unobserved competitor (1 ms)
      √ averaging an all-unobserved set is null, never zeroes (1 ms)
      √ both sides unavailable yields no gap

Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
Time:        102.142 s
[exited with code 0]
```

13/13 green — and B3 was live the whole time. The suite proves the *seam* is correct; it says
nothing about the boundary. That gap is what §4's tripwire closes.

---

## 4. IMPLEMENTATION SPECIFICATION

For the follow-on wave, **on top of `34681e6a`**. One new file, seven edited, two test files. No
compiler option, no baseline artefact, no schema, no migration, no wire-shape change.

### D1 — New leaf module `backend/services/competitor/comparisonArithmetic.ts`

Imports **nothing** (same leaf discipline as `competitorMetricsTypes.ts`, so the native
architecture dependency-cycle gate stays green).

```ts
/**
 * The ONLY sanctioned way to read a possibly-unavailable comparison dimension as a number.
 *
 * This project compiles with "strict": false, so `null` in arithmetic is not a type error.
 * More importantly, WP-13 measured that `x ?? 0` is well-typed under EVERY compiler setting and
 * every type shape — so no compiler configuration can enforce this contract. It is enforced by
 * funnelling reads through this module and by
 * backend/tests/unit/report1NullContractTripwire.test.ts.
 */
export const isMeasured = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** A delta needs BOTH sides. Either side unavailable yields null, never 0. */
export const deltaOf = (left: number | null | undefined, right: number | null | undefined): number | null =>
  isMeasured(left) && isMeasured(right) ? left - right : null;

/** Mean of the values that exist; null when none does. Never averages an absence as zero. */
export const meanOfMeasured = (values: ReadonlyArray<number | null | undefined>): number | null => {
  const present = values.filter(isMeasured);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
};
```

This **deduplicates four existing private copies of two functions** — `delta` + `averagePresent`
(Helpers), `gapBetween` + `meanPresent` (Engine). Consolidation, not new surface.

One deliberate behavioural difference: `isMeasured` adds `Number.isFinite`. Today's guards use
bare `typeof v === 'number'`, and `typeof NaN === 'number'`, so a `NaN` dimension passes every
guard and survives `clampMetric` (`Math.max(0, Math.min(100, Math.round(NaN))) === NaN`). **No
evidence was found that a crawl signal reaches `NaN` today**, so this is hardening, not a fix for
an observed defect. If the follow-on wave wants strictly zero behavioural change, drop
`Number.isFinite` and keep the bare `typeof`; nothing else in this spec depends on it.

### D2 — Move the dimension partition into production use (the structural part)

In `backend/services/competitor/competitorMetricsTypes.ts`, add the comparable-dimension list
next to the type it indexes, and re-export it from `competitorMetricsEvidence.ts` so no existing
import breaks:

```ts
/**
 * The dimensions on which a competitor comparison may be stated.
 *
 * WP-13 — identical to CRAWL_OBSERVED_DIMENSIONS, declared here because every consumer of a
 * comparison must iterate THIS, never a seven-element literal and never Object.keys. Three of
 * the seven dimensions are unobservable by construction on BOTH sides, so a uniform loop over
 * all seven silently averages three absences in as measured values. That single mistake is
 * defects B1, B2 and B3.
 */
export const COMPARABLE_DIMENSIONS = [
  'content_depth', 'authority_score', 'seo_coverage', 'aeo_readiness',
] as const satisfies readonly (keyof ComparisonMetrics)[];
```

Then replace the hand-written dimension lists in the comparison *consumers* with it:
`…Helpers.ts:185` `METRIC_KEYS`, `…Model.ts:293` `METRIC_KEYS`,
`reportViewUtils.buildCompetitorStanding`, and `visualIntelligenceHelpers` (D4). Keep the
all-seven enumeration **only** where a full record must genuinely be constructed —
`subtractMetrics`, `averageCompetitorMetrics`, `resolveCompetitorMetrics`, `resolveCompanyMetrics`.

### D3 — `MetricDeltas`: a delta is not a measurement

In `competitorMetricsTypes.ts`:

```ts
/**
 * The pairwise difference between two `ComparisonMetrics`. EVERY dimension is nullable here,
 * including the four always present in a measurement: a delta exists only where BOTH sides were
 * observed. Typing a delta as `ComparisonMetrics` is what required four `as number` casts.
 */
export type MetricDeltas = { readonly [K in keyof ComparisonMetrics]: number | null };
```

On top of `34681e6a`:

- `…Helpers.ts` — `subtractMetrics(left: ComparisonMetrics, right: ComparisonMetrics): MetricDeltas`;
  **delete all four `as number` casts**; replace local `delta` with `deltaOf` and local
  `averagePresent` with `meanOfMeasured`.
- `…Helpers.ts` **and** `…Model.ts` — `CompetitorComparisonEntry.deltas_vs_company: MetricDeltas | null`.
  The two declarations must stay structurally identical; `Engine(245,51)` in §3.3 is what happens
  when they drift.
- `…Engine.ts` — replace private `gapBetween` with `deltaOf` and private `meanPresent` with
  `meanOfMeasured`. The five `const xGap = …; if (xGap !== null && xGap >= N)` call sites keep
  their shape.
- Re-export `MetricDeltas` from `…Model.ts` and `…Engine.ts` beside the existing
  `export type { ComparisonMetrics }`.

### D4 — Fix the one still-live zero-collapse (B3)

`backend/services/snapshotReport/visualIntelligenceHelpers.ts:250-258`. Replace:

```ts
const avgDelta = averageNumber([
  Number(deltas.content_depth ?? 0),
  Number(deltas.authority_score ?? 0),
  Number(deltas.seo_coverage ?? 0),
  Number(deltas.geo_presence ?? 0),
  Number(deltas.aeo_readiness ?? 0),
].filter((value) => Number.isFinite(value)));
if (avgDelta == null) return null;
```

with:

```ts
// WP-13 — only dimensions that were actually compared may enter the average. `geo_presence` is
// unobservable on both sides and is null on every report; `?? 0` previously averaged that
// absence in as measured parity and pulled every standing score 1/5 toward parity (60).
const avgDelta = meanOfMeasured(COMPARABLE_DIMENSIONS.map((key) => deltas[key]));
if (avgDelta == null) return null;   // nothing compared -> no standing score
```

importing `meanOfMeasured` from `../competitor/comparisonArithmetic` and
`COMPARABLE_DIMENSIONS` from `../competitor/competitorMetricsTypes`. This is the same
transformation WP-12 applied to `buildCompetitorStanding`, now expressed through the shared
partition so it cannot drift again. `averageNumber` stays for its other callers.

### D5 — The enforcement: `backend/tests/unit/report1NullContractTripwire.test.ts`

Still a test, because §3.4 proves the compiler cannot bind here — but it enforces the *contract*
rather than re-checking behaviours. The repository already uses source-text tripwires; the
precedent is `backend/services/prospectLifecycle/outcomeProvenance.ts`.

```ts
const COMPARISON_PATH_FILES = [
  'backend/services/competitor/competitorMetricsEvidence.ts',
  'backend/services/competitor/competitorMetricsTypes.ts',
  'backend/services/reportCompetitorIntelligenceServiceEngine.ts',
  'backend/services/reportCompetitorIntelligenceServiceHelpers.ts',
  'backend/services/reportCompetitorIntelligenceServiceModel.ts',
  'backend/services/snapshotReport/visualIntelligenceHelpers.ts',
  'backend/services/snapshotReport/competitorSummaryHelpers.ts',
  'pages/api/reports/reportViewUtils.ts',
  'pages/api/reports/reportComposedMapper.ts',
];
const UNOBSERVABLE = ['publishing_frequency', 'engagement_score', 'geo_presence'];
```

Rules:

1. **Every listed file resolves and the match set is non-empty.** Assert the resolved count
   equals `COMPARISON_PATH_FILES.length` *before* scanning. A tripwire that silently matches
   nothing is worse than none.
2. **Strip comments before scanning.** Mandatory: every one of these files documents the three
   dimension names at length in prose, and the `outcomeProvenance` precedent fires on a word even
   inside a comment. Without stripping, the tripwire fails on its own rationale.
3. **No zero-defaulting of an unobservable dimension** — fail on
   `/(publishing_frequency|engagement_score|geo_presence)\s*(\?\?|\|\|)\s*0\b/`.
4. **No zero-defaulting of a delta member** — fail on
   `/deltas?(_vs_company)?\.\w+\s*(\?\?|\|\|)\s*0\b/` and `/Number\(\s*deltas?\.\w+\s*\?\?\s*0/`.
5. **No whole-metrics default** (defect 2a — the shape §3.4 proves no compiler can catch, so it
   *must* live here) — fail on `/comparison\??\.company\s*\?\?\s*(?!null\b)/` and on any
   identifier matching `/EMPTY_[A-Z_]*METRICS/`.
6. **No bare arithmetic on an unobservable dimension** — fail on
   `/\.(publishing_frequency|engagement_score|geo_presence)\s*[-+*/]\s/` and
   `/[-+*/]\s*[\w$.?]*\.(publishing_frequency|engagement_score|geo_presence)\b/`.
   `comparisonArithmetic.ts` is deliberately not on the list and is the sole exception.
7. **No uniform iteration over all seven dimensions** (the structural rule, D2) — in the
   comparison consumers, fail on an array literal or `Object.keys` enumeration containing any
   member of `UNOBSERVABLE` outside the four full-record constructors named in D2. Positively
   assert `COMPARABLE_DIMENSIONS` is imported by `reportViewUtils.ts` and
   `visualIntelligenceHelpers.ts`.
8. **No nullability-discarding cast in `subtractMetrics`** — extract its body and fail on
   `/as\s+number\b/`.
9. **Defect class 4 fence** — assert `resolveCompetitorMetrics`'s mirrored block still reads
   `companyMetrics?.<dim> ?? null` for all three, so a future edit cannot start mirroring an
   observed company number onto a competitor without failing here.
10. **The canonical module is a leaf** — `comparisonArithmetic.ts` contains no `import` or
    `require`.

Every failure message must name the file, the matched text and the rule.

**Write each regex on a SINGLE line.** Two-line regex literals silently match nothing under this
repository's jest configuration — a known project failure mode, and it would turn this tripwire
into a no-op.

### D6 — Behavioural tests

Appended to `report1CompetitiveBaselineIntegrity.test.ts` (inside `tsconfig.backend-tests.json`):

1. `deltaOf(40, null) === null`; `deltaOf(null, 40) === null`; `deltaOf(null, null) === null`;
   `deltaOf(40, 10) === 30`; **`deltaOf(0, 0) === 0`** — zero is a measurement and must survive.
2. `meanOfMeasured([null, null]) === null`; `meanOfMeasured([10, null, 20]) === 15` (denominator
   **2**, not 3); `meanOfMeasured([]) === null`; `meanOfMeasured([0, 0]) === 0`.
3. `subtractMetrics` returns all seven keys; the four observed are numbers, the three
   unobservable are `null`; the result is assignable to `MetricDeltas`.
4. **B3 regression:** drive the `visualIntelligenceHelpers` standing path with four observed
   deltas of `+14` and `geo_presence: null`. Assert the score equals the one for `avgDelta = 14`
   (four values) and **explicitly assert it is not** the pre-fix `avgDelta = 11.2` value.
5. **Guards on WP-12's fixes** (same suite, so one file owns the contract):
   `buildCompetitorStanding` with all-null deltas returns `'Not Observed'`;
   `enforceFinalCompetitorIntelligenceSync` with no company baseline leaves
   `comparison.company === null`.

### D7 — Verification commands

```
node ./node_modules/jest/bin/jest.js backend/tests/unit/report1NullContractTripwire.test.ts --runInBand --forceExit
node ./node_modules/jest/bin/jest.js backend/tests/unit/report1CompetitiveBaselineIntegrity.test.ts --runInBand --forceExit
node ./node_modules/jest/bin/jest.js backend/tests/unit/report1CompanyBaselineObservation.test.ts --runInBand --forceExit
node ./node_modules/jest/bin/jest.js backend/tests/unit/d8CompetitorEvidenceIntegrity.test.ts --runInBand --forceExit
node ./node_modules/jest/bin/jest.js backend/tests/unit/d8SeamTypeBoundary.test.ts --runInBand --forceExit
node ./node_modules/jest/bin/jest.js backend/tests/unit/unionMatrixReport1.test.ts --runInBand --forceExit
node ./node_modules/jest/bin/jest.js backend/tests/unit/reportCompetitorIntelligenceService.test.ts --runInBand --forceExit
npm run typecheck:ci                 # must stay at baseline 0            -- HOLD THE TYPECHECK MUTEX
npm run typecheck:certification      # 0 / 260 AND net-new fingerprints 0 -- HOLD THE MUTEX
npm run lint
```

`typecheck:certification` is the likeliest to trip: `MetricDeltas` reaches
`tsconfig.backend-tests.json`, where a **new error identity** fails even at an unchanged total.
Do not re-baseline to make it pass. Both typecheck commands run at an ~8 GB heap on a 4-CPU /
16 GB machine — run them one at a time, under the orchestrator's mutex.

### D8 — Out of scope, and optional hardening

Out of scope: any `tsconfig*.json` or `scripts/typecheck-*` change; any baseline or fingerprint
artefact; the wire shape of `ComparisonMetrics` / `deltas_vs_company`; the engagement/analytics
modules that merely share field names (§3.8); any schema, migration, flag, data or deploy action.

Optional (defect class 4, §3.9.D), only if wanted and as a separate commit: narrow
`resolveCompetitorMetrics`'s `companyMetrics` parameter from `ComparisonMetrics | null` to
`Pick<ComparisonMetrics, 'publishing_frequency' | 'engagement_score' | 'geo_presence'> | null`,
so the four observable dimensions are not even in scope at the mirror. That makes republishing an
observed company number as competitor evidence un-expressible rather than merely un-done.
Tripwire rule 9 covers the risk without it.

---

## 5. WHY NOT THE ALTERNATIVES

| Remedy | Verdict | Decisive evidence |
|---|---|---|
| **(a) scoped `strictNullChecks`** | **Rejected — would not have caught the defects, and is infeasible anyway** | §3.4: `strictNullChecks` gives **no error** on either `Number(x.pf ?? 0)` or `m ?? EMPTY` — the shapes of defect classes 2a and 2b. §3.3: TS 6.0.3 has no per-file strictness; the narrowest possible project (five files) yields **84 errors** over a **723-file** program, **87% in 18 unrelated modules**; the whole backend project yields **585** against a baseline of **0**; and the **11** in-scope errors were all symptoms of defect class 1, which WP-12 has already removed. |
| **(b) explicit runtime guard** | **Rejected as the whole answer — necessary, not sufficient** | §3.9.A: **eight** correct guards already exist at every seam site and shipped with REMEDIATION-003. The same change still left B1, B2 and B3 live outside them, and B1/B3 are literally the same bug in two files. A guard fixes a site; it does not make the next site safe. Retained as *part* of (d) — funnelled through one module and made mandatory by a tripwire. |
| **(c) discriminated / branded contract** | **Rejected — real teeth, wrong target, wrong convention, breaks persisted data** | §3.4: a property-omitting union **is** caught (TS2339) under `"strict": false` — the only shape with compile-time teeth. But it still gives **no error** on `m ?? EMPTY` (defect 2a) or `Number(x ?? 0)`. §3.6: this repository's own established envelope, `ScoreEnvelope`, is `value: number \| null` + `state` — measured as shape `d3`, which gives **no** protection; a property-omitting union would *diverge* from the house convention, not reuse it. §3.7: `deltas_vs_company` and `comparison.company` are persisted and read back by `reportComposedMapper.ts`, so changing the wire shape breaks stored reports. §3.5: branding gives nothing at all — under `"strict": false`, `null` is assignable to every type. |
| **(d) boundary-scoped architectural fix** | **CHOSEN** | Uses the partition the repo already exports and **no production file consumes** (§3.6) to remove the root cause of all three zero-collapse defects; one import-free module replacing four existing duplicates; an honest `MetricDeltas` removing the last four laundering casts; the one still-live defect fixed; and a tripwire covering precisely the cases §3.4 proves no type system can. Narrow: **1 new source file, 7 edited, 2 test files, 0 schema, 0 config.** |

---

## 6. WAVE SCOPE — WHY THIS STAYS DECISION-ONLY

WP-12 is closed, so the §4 ownership collision has lifted and implementation is now permitted.
It is nevertheless **deliberately deferred**, for three reasons:

1. **Merge conflict by construction.** This worktree is based on `3d643f5c`. WP-12's `6dd5e487`
   and `34681e6a` are unmerged, on a different branch. Four of the five target files differ
   between my base and WP-12's tip — including the exact regions D3 edits (the duplicate type at
   `…Helpers.ts:35`, `EMPTY_COMPARISON_METRICS` at `…Model.ts:303`). Implementing here would edit
   the pre-WP-12 text and conflict with WP-12 in every one of those hunks. The spec is written
   against `34681e6a` precisely so it applies cleanly once that lands.
2. **The gate cannot be run.** A production edit to files inside `tsconfig.backend.json` cannot be
   certified without `typecheck:ci` and `typecheck:certification`, and those are now a centrally
   held global mutex on this 4-CPU / 16 GB machine. Shipping an unverified edit to a
   release-certified path is worse than shipping a spec.
3. **Coherence.** B3 alone is a one-line guard — exactly the "a guard is not a contract" pattern
   this decision diagnoses. The partition, the module, the type and the tripwire should land as
   one reviewable change.

**However — B3 is a live production defect**, diluting every competitor-standing score on every
report, in a file **no workstream owns**. It should be item one of the follow-on wave, not a tail
item.

---

## 7. HOW WP-12's WORK CHANGES THIS SPEC

Written against `34681e6a`, read read-only. Status of each item:

**Already done — do NOT re-apply:**
- Duplicate `ComparisonMetrics` in Helpers removed (defect 1). The eleven in-scope
  `strictNullChecks` errors in §3.3 are therefore **stale** — do not expect 84 again; re-measure
  if that argument is ever reopened.
- `EMPTY_COMPARISON_METRICS` removed, `comparison.company` is `ComparisonMetrics | null` (defect 2a).
- `buildCompetitorStanding` filters to measured dimensions and returns `'Not Observed'` when none
  (defect 2b). D5 rule 4 must therefore **pass** on `reportViewUtils.ts` as committed; if it
  fails, the regex is wrong, not the file.
- `reportComposedTypes.deltas_vs_company` widened to `number | null` (defect 3, `34681e6a`).

**Still required, verified present at `34681e6a`:**
- The four `as number` casts in `subtractMetrics` (D3).
- B3 in `visualIntelligenceHelpers.ts` (D4) — proven outside WP-12's file set in §3.9.B.
- No enforcement mechanism of any kind (D5).
- `CRAWL_OBSERVED_DIMENSIONS` / `CRAWL_UNOBSERVED_DIMENSIONS` still have zero production
  consumers (D2).

**Changes the spec must accommodate:**
1. **The company baseline is now real.** `resolveCompanyMetrics` derives the subject's own four
   observable dimensions from its own crawl (`resolveCompanyComparisonBaseline` in the Engine
   drives it) and sets the three unobservable ones to `null`. The gap capability is no longer
   dormant, so **`subtractMetrics` now runs with a non-null company side in production for the
   first time** — B3 and the casts move from latent to reachable. This raises D3/D4's priority; it
   does not change their content.
2. **`comparison` gained `company_metrics_state?: ScoreState` and `company_metrics_basis?: string`**
   in both Helpers and Model. D3's `CompetitorComparisonEntry` edits go *alongside* these.
3. **`deriveCrawlObservedDimensions(signals)` is now the single shared derivation** for both
   sides. D1's module sits beside it — do not merge them; `comparisonArithmetic.ts` must stay
   import-free or the leaf/cycle property is lost.
4. **`report1CompanyBaselineObservation.test.ts` (498 lines) is new.** Read it before writing D5
   and D6 so the tripwire does not duplicate it and the new cases do not contradict it.

**What would genuinely invalidate this spec:** a later change to `subtractMetrics`'s return type
(D3 would then need conflict-checking, not re-applying); any change to the wire shape of
`deltas_vs_company` (D4 and every D5 regex would need re-deriving); or
`visualIntelligenceHelpers.ts` / `reportComposedTypes.ts` being assigned to another workstream, in
which case D4 must be handed over under brief §4 rather than executed.

Every measured number in this document except §3.3 Measurement B is independent of WP-12's
content.

---

*WP-13 is decision-only. Nothing in §4 has been implemented. Implementation is deferred to the
wave after WP-12.*
