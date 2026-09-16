# SEC91-W2F — Wave-2 security gates (STEP 3AH-91)

**Base:** wave-1 integration branch `sec/3ah91-integration` @ `cc39f85` (SEC-A…F merged) · **Branch:** `sec/3ah91-w2f-gates` · **Worktree:** `C:/tmp/sec91-w2f` · not pushed, not merged.
No production system was contacted.

## 1. Inventory

| ID | Sev | Finding | Current status (evidence file:line) | Classification | Files | Fix | Tests | Conflict risk |
|---|---|---|---|---|---|---|---|---|
| W2F-1 | P2 | Route-auth gate skips routes that re-export their handler | Base `scripts/check-route-auth.js:834-836`: `isRouteFile` = `/export\s+default\b/`, so the 4 barrels (`activity-workspace/content`, `analytics/v1/system-state`, `command-center/creator-content/generate`, `intelligence/snapshot`) were counted as helper modules and never analysed | **FIX** | `scripts/check-route-auth.js`, `scripts/route-auth-allowlist.json` | A re-exporting file is a route. The re-export is followed (≤4 hops, into any repo module) and R1–R4 plus R1-METHOD run on the module that serves the route. The allowlist entry, `[segment]` ids and campaign keying stay keyed by the route path. An unresolvable export or a cycle fails closed (R1). Also: destructured `await import()` primitives are provenance-checked like static imports, and `(req.body as X)?.id` counts as a request id | `sec91W2FRouteAuthReExport` (21) | Low. It touches only the gate |
| W2F-1a | **P1** | New, found by W2F-1. `activity-workspace/content` writes another tenant's `daily_content_plans.content` | `contentRouteHandler.ts:53` takes `companyId` from the body, and `:108-113` membership-checks only that company. `activity.id` is never bound to it. Unbound writes: `persistVariantsToDb`/`persistMasterToDb` at `:182, :293, :360, :452, :723, :805, :845, :869, :896` (improve_variant, improve_variant_all, refine_variant, generate_variants) → `canonicalExecutionAdapter.ts:365-383`, which updates by activity id. `:368` interpolates the id into a PostgREST `.or()` filter string. `generate_master` (`:519-548`) is correctly bound | **Cross-workstream (SEC-A)**. Tracked as gate KNOWN OPEN (R2/R3) | — | Patch in §6.1 | Repo assertion | — |
| W2F-1b | P3 | New, found by W2F-1. `creator-content/generate` reads a campaign snapshot by an unbound `campaign_id` | `generateHandler.ts:339` calls `enforceCompanyAccess` without `campaignId`. `:451-462` reads `campaign_versions.campaign_snapshot` by `body.campaign_id` with no company predicate. The foreign variant config reaches the response (`:721-723`), and the foreign id becomes the orchestrator `campaignId` (`:534`) | **Cross-workstream (SEC-A)**. Tracked KNOWN OPEN (R3) | — | §6.2 | Repo assertion | — |
| W2F-2 | P3 | No gate for timing-unsafe secret comparisons; 3 known sites remain | `SessionAuthorityService.ts:232` (`parsed.signature !== expected \|\| cookie_signature !== expected`), `leadService.ts:240` (`cfg.secret !== webhookSecret`), `plannerSecurityGovernance.ts:293` (`f.hmac !== expected`) | **FIX** | `scripts/check-constant-time-secrets.js` (new), the 3 files (compare + import lines only) | New blocking gate, described in §2. The 3 sites now use `constantTimeEqual` (exact match, fails closed) | `sec91W2FConstantTime` (27) | Low (1–3 lines per file) |
| W2F-2a/b/c | P3 | New, found by the gate. Password compares use `!==` | `pages/api/super-admin/login.ts:91` (`providedPass !== expectedPass`), `pages/api/super-admin/content-architect-login.ts:64` (`p !== expectedPass`), `backend/services/contentArchitectSecurityService.ts:82` (`passwordHash !== expectedHash`, unsalted SHA-256 digests) | **Cross-workstream** (unowned; proposed SEC-B). Tracked as gate `KNOWN_OPEN` | — | §6.3 | Repo assertion | — |
| W2F-3 | P3 | R4 accepted secret checks that are open outside production | Base `check-route-auth.js:428` treated any `if (!s` as an explicit deny. `:438` accepted an `else` branch that rejects even when that rejection is conditional on `NODE_ENV` | **FIX** | `scripts/check-route-auth.js` | New rule **R4-ENV**: the unset-secret branch must reject in every environment. Covers `else if (NODE_ENV/VERCEL_ENV/isProd…)`, env-conditional rejects inside `else {}`, `if (!s && isProd)`, and env-conditional early allows. Env-conditional logging followed by an unconditional reject stays green. SEC-C's two fixed endpoints pass | `sec91W2FR4Env` (14); `routeAuth001Scanner` updated | Low |
| W2F-3a | P3 | New, found by R4-ENV. The WhatsApp webhook accepts unsigned payloads outside production | `pages/api/whatsapp/webhook/index.ts:48-53`: `verifySignature` returns `true` when `WHATSAPP_APP_SECRET` is unset and `NODE_ENV !== 'production'`. Production is closed | **Cross-workstream (SEC-B)**. Tracked KNOWN OPEN (R4-ENV) | — | §6.4 | Repo assertion | — |
| W2F-4 | P3 | SSRF gate misses fetch aliases; the render provider fetches the reference URL without the SSRF layer | Base `check-outbound-ssrf.js:71-75` matches only `fetch(`/`axios.*(`/`http(s).request(`. Base `openAIRenderProvider.ts:95,119`: `const doFetch = cfg.fetchImpl \|\| globalThis.fetch; doFetch(referenceUrl.trim(), …)`. The URL comes from persisted `reference_image_url` | **FIX** | `scripts/check-outbound-ssrf.js`, `openAIRenderProvider.ts` (reference fetch only) | The scanner flags raw-fetch aliases, direct `fetchImpl`/`customFetch` calls, and a raw fetch injected as a fetch implementation. Two line-scoped reviewed call sites. At runtime the reference download goes through `safeFetch` (SEC-D's 20 s AbortSignal plus a matching SSRF timeout, byte cap). An injected `fetchImpl` is unchanged | `sec91W2FSsrfAlias` (13) | Low |
| W2F-5 | — | Wire the new checks into CI | `.github/workflows/typecheck-baseline.yml` | **FIX** | workflow, `package.json`, `scripts/security/run-gate-tests.js` | New blocking step "Constant-time secret comparison gate" (`npm run check:constant-time`). The 5 `sec91W2F*` suites are added to the inventory-pinned runner. No step removed | `sec91W2FCiWiring` (10) | Workflow is SEC-F-owned only |

## 2. Fixes: before and after

**W2F-1: re-export routes**
- **Before.** The 4 barrels were "helper modules". A barrel pointing at an unauthenticated handler anywhere in the repo passed the gate.
- **After.**
  - The gate counts 1,326 route files (was 1,322) and 10 helpers (was 14); all 4 barrels are analysed through their handler module.
  - Every route passes, except confirmed binding findings, which are tracked (see Known-open below):
    - `content`: identity level, R2/R3 → W2F-1a.
    - `generate`: tenant level, R3 → W2F-1b.
    - `system-state` and `snapshot`: tenant level, clean.
- **How the re-export is resolved.**
  - `export { h as default } from 'x'`: R1 evidence is scoped to `h` and its same-module helpers, so a sibling export's primitive does not count.
  - A chain of re-exports is followed and recorded in `row.reExport`.
  - A package specifier, a missing module or a cycle fails closed.
- **Known-open.** A new allowlist section, `knownOpen`.
  - Only R2, R3 and R4-ENV can be tracked. R1, R1-METHOD and R4 can never be.
  - Each entry must carry a finding id, an owner and a reason.
  - The CLI prints every tracked violation as `KNOWN OPEN` on every run.
  - When the rule stops firing, the gate prints a WARN. An entry for a route that no longer exists is STALE and fails the gate.
- **Tests.** `sec91W2FRouteAuthReExport` has 21 tests: fixtures run through virtual modules, plus repo assertions. It fails 21/21 against the base gate.
- **Mutation.** Restoring `isRouteFile` to `export default` only makes 5 tests fail. Disabling the re-export follow makes 16 fail.

**W2F-2: constant-time gate**
- **What the gate flags.** `===`/`!==` (and loose `==`/`!=`) in `pages/api/**` and `backend/**` (tests excluded) when one operand is secret-derived and the other is not a literal. Secret-derived means:
  - `process.env.X`, `process.env['X']` or `config.X` with a credential name. `NEXT_PUBLIC_*`, `*PUBLIC_KEY*`, `*_URL`, `MAX_TOKENS` and `*_INDEX` are excluded.
  - A lexically scoped variable assigned from one of those, from another tainted variable, or from `createHmac(`/`sign…(`/`…Hmac(`/`…Signature(`.
  - An operand named `…secret` or `…hmac`.
- **What it does not flag.** `typeof` checks, `.length` comparisons, anything inside comments or strings, and lines marked `// ct-ok: <reason>`.
- **Tree result.** 11 hits in the first draft, reduced to 6 real findings after two false-positive rules:
  - Name-based `signature` taint was dropped. `recommendations/long-form/handoff.ts` uses a content fingerprint.
  - Variable taint was scoped. `imageService.ts:238` `key` had been tainted from another function.
  - Of the 6 real findings, 3 were converted and 3 are tracked `KNOWN_OPEN`.
  - Separately, the planner's `prev_hmac` chain-link compare is annotated `ct-ok`. Both sides are stored values, and `'' === ''` must hold for the first entry.
- **Conversions** (semantics unchanged; `expected` is always a non-empty HMAC):
  - `!constantTimeEqual(parsed.signature, expected) || !constantTimeEqual(cookie_signature, expected)`
  - `!cfg?.secret || !constantTimeEqual(webhookSecret, cfg.secret)`
  - `!constantTimeEqual(f.hmac, expected)`
- **Tests.** `sec91W2FConstantTime` has 27 tests: gate fixtures, a repo pass, and behaviour tests for all 3 sites. The behaviour tests cover accept exact, reject tampered/padded/empty/missing, and a spy asserting the decision goes through `constantTimeEqual`.
  - On the base source: 6 fail (the gate-verdict and spy assertions), 20 pass (preserved behaviour).
- **Mutations.**
  - Reverting SessionAuthorityService → 4 tests fail.
  - Reverting leadService → 3 fail.
  - Reverting the planner → 3 fail.
  - Disabling variable taint → 5 fail.

**W2F-3: R4-ENV**
- **Before.** `if (s) {…} else if (NODE_ENV === 'production') reject` passed. That was the pre-SEC-C `internal/metrics` shape.
- **After.** It is R4-ENV. The finding is distinct from R4 because the check does reject in production. The one instance on the tree is tracked (W2F-3a).
- **Existing test updated.** `routeAuth001Scanner.test.ts` pinned the `prodElse` fixture as fail-closed. That is exactly the behaviour this fix changes, so the assertion now expects `['INTERNAL_METRICS_SECRET (open outside production)']` / R4-ENV.
- **Tests.** `sec91W2FR4Env` has 14 tests. 10 fail on the base gate.
- **Mutation.** Disabling the R4-ENV push makes 8 fail.

**W2F-4: SSRF aliases and the render provider**
- **Before.** The base provider source was not flagged. At runtime the reference URL went to raw `globalThis.fetch`.
- **After.** The base shape is flagged `fetch-alias(referenceUrl)`. At runtime:
  - The URL goes to `safeFetch(url, { method: 'GET', signal: AbortSignal.timeout(20 s) }, { timeoutMs: 20 s })`, and the body is read with `readCapped`.
  - `https://169.254.169.254/…`, `http://…` and `https://127.0.0.1:…` are refused before any request, and generation falls back to plain text-to-image. Only `api.openai.com` reaches raw fetch.
  - An injected `fetchImpl` (a test seam, annotated `ssrf-ok`) is unchanged, and SEC-D's `sec91DProviderHardening` still passes.
- **New scanner hits and how they were resolved.**
  - 16 hits in the first draft. Generic `fetcher`/`fetchFn` parameters were then excluded: on the tree they are DB page loaders or SSRF-layer fetchers injected by their callers. For example, the CMS `fetchFn` wraps `safeFetch`, and `companyProfile` `ctx.fetcher` takes `allowedHosts`.
  - That left 4 lines:
    - 3 lines in 2 reviewed, line-scoped call sites: the global-fetch instrumentation passthrough, and the browser trace transport posting to the fixed `/api/threadRuntime/trace`.
    - 1 annotated test seam.
- **Tests.** `sec91W2FSsrfAlias` has 13 tests. Against the base scanner and provider, 10 fail.
- **Mutation.** Disabling the alias pattern makes 6 fail.

## 3. Commands run and results

- **New suites.** `sec91W2FRouteAuthReExport` 21/21, `sec91W2FR4Env` 14/14, `sec91W2FConstantTime` 27/27, `sec91W2FSsrfAlias` 13/13, `sec91W2FCiWiring` 10/10.
- **`node scripts/security/run-gate-tests.js`.** 14 suites, 306/306 pass. This used the exact CI env: `CI=true`, the placeholder vars, `env -i`, a cold cache. It includes all 9 SEC-F suites.
- **Affected existing suites.** 25 suites pass (288 passed, 4 skipped as before). They cover SessionAuthorityService, leadService, the planner, the render provider, the render executor, queue and worker, lead capture characterisations, `sec91DProviderHardening`, and `sec91CConstantTimeSecrets` + `sec91CInternalEndpointsFailClosed`.
- **Gates** (all exit 0 on the branch):

| Gate | Result |
|---|---|
| `node scripts/check-route-auth.js` | PASS: 1,326 routes, 4 re-exports analysed, 3 routes with KNOWN OPEN |
| `node scripts/check-tenant-authz.js` | PASS |
| `npm run -s check:ssrf` | PASS: 5,596 files, 2 reviewed alias sites |
| `node scripts/check-migration-quality.js` | OK |
| `node scripts/check-withrbac-binding.js` | PASS |
| `node scripts/check-orgaccess-binding.js` | PASS |
| `node scripts/check-secrets.js` | PASS (after commit; new fixtures are placeholders) |
| `node scripts/check-constant-time-secrets.js` | PASS: 3 KNOWN OPEN |
| `node scripts/security/route-auth-inventory.js --out <scratch>` | OK |

- **TypeScript.**
  - Full `tsc -p tsconfig.backend-tests.json --noEmit --incremental false`: 260 errors, all pre-existing (the same count SEC-C/SEC-D reported), and none in any file this branch touches.
  - Scoped `tsc` over the 6 touched test files and 4 touched sources (with transitive imports): exit 0. One real error was fixed along the way: a `Uint8Array<ArrayBufferLike>` passed to `Blob`.

## 4. Commits (`sec/3ah91-w2f-gates`)

- `bf3108f` fix(security-gates): route-auth gate analyses re-exported handlers; R4-ENV (W2F-1, W2F-3)
- `3c2c90e` fix(security): constant-time secret comparison gate; convert the 3 remaining compares (W2F-2)
- `242a6cf` fix(ssrf): scanner sees fetch aliases; render reference image via safeFetch (W2F-4)
- `c1d9418` ci(security-gates): wire the constant-time gate and W2F fixture suites (W2F-5)
- `6c1e221` fix(security-gates): constant-time gate also covers loose ==/!= (W2F-2)
- (this report) docs(security): SEC91-W2F report

## 5. Files changed

**New**
- `scripts/check-constant-time-secrets.js`
- `backend/tests/unit/sec91W2F{RouteAuthReExport,R4Env,ConstantTime,SsrfAlias,CiWiring}.test.ts`
- `docs/security/SEC91_W2F.md`

**Owned**
- `scripts/check-route-auth.js`
- `scripts/route-auth-allowlist.json`: only the new `knownOpen` section; no `routes` entry changed.
- `scripts/check-outbound-ssrf.js`
- `scripts/security/run-gate-tests.js`
- `.github/workflows/typecheck-baseline.yml`
- `package.json`: one script added.
- `backend/services/creator/rendering/providers/openAIRenderProvider.ts`: reference-fetch block only.
- `backend/security/SessionAuthorityService.ts`, `backend/services/leadService.ts`, `backend/services/plannerSecurityGovernance.ts`: compare lines plus one import line each. In the planner, the `ct-ok` comment is on the adjacent chain-link compare.

**Flagged: outside the listed ownership**
- `backend/tests/unit/routeAuth001Scanner.test.ts`: an existing gate fixture test. One assertion pinned the shape W2F-3 now flags; it was replaced by an R4-ENV assertion (§2).

## 6. Cross-workstream proposals (not applied)

### 6.1 W2F-1a (P1): activity-workspace content cross-tenant write (SEC-A)

**Files:** `backend/services/activityWorkspace/contentRouteHandler.ts` and `backend/services/orchestration/canonicalExecutionAdapter.ts`.

**Attack.** Any authenticated member of any company can:
1. send `companyId` = their own company, which passes the membership check at `:108-113`;
2. send `activity.id` = a `daily_content_plans` row belonging to another company;
3. run improve_variant, improve_variant_all, refine_variant or generate_variants.

The route then merges attacker-influenced variants into that row's `content` through `updateExecutionContentByActivity`, which updates by id only. That content can later be published by the victim's scheduler.

**PostgREST filter injection (plausible, not verified).** `canonicalExecutionAdapter.ts:368` builds `.or(\`id.eq.${activityId},execution_id.eq.${activityId}\`)` from the request value. An id containing `,` could add filter clauses, for example to match rows by campaign without knowing an id.

This is code-read evidence; I did not verify it at runtime (no DB).

**Patch.**
- In the handler, after the tenant is established: for every action except `generate_master` (already bound at `:519-548`), when `activityDbId` is persisted (non-`workspace-`), bind it to the tenant:
  - load `daily_content_plans.campaign_id` with `.eq('id', activityDbId)`;
  - call `enforceCompanyAccess({ req, res, companyId, campaignId })`, which binds campaign → company since ROUTE-AUTH-001; answer 403 on mismatch;
  - require `companyId` whenever a persisted activity id is written;
  - bind `body.campaignId` the same way.
  - Using `enforceCompanyAccess` also makes the route pass R2/R3 on primitives. Then delete the `knownOpen` entry for `pages/api/activity-workspace/content.ts`.
- In the adapter: reject `activityId` unless it matches `/^[A-Za-z0-9_-]{1,128}$/` before building the filter, or use two `.eq()` lookups.

### 6.2 W2F-1b (P3): creator-content/generate (SEC-A)

In `generateHandler.ts`, compute `campaignIdForVariant` before `:339` and call `enforceCompanyAccess({ req, res, companyId, campaignId: campaignIdForVariant ?? undefined })`.

Minimal alternative: add `.eq('company_id', companyId)` to the `:456-462` read and null `campaignIdForVariant` when no row is found. With this alternative the gate still needs the primitive, or a reviewed `inline-binding` entry.

Then delete the `knownOpen` entry.

### 6.3 W2F-2a/b/c: password compares (unowned; proposed SEC-B)

| File | Replace | With |
|---|---|---|
| `pages/api/super-admin/login.ts:91` | `providedUser !== expectedUser \|\| providedPass !== expectedPass` | `!constantTimeEqual(providedUser, expectedUser) \|\| !constantTimeEqual(providedPass, expectedPass)` |
| `pages/api/super-admin/content-architect-login.ts:64` | the `u`/`p` compares | the same pattern |
| `backend/services/contentArchitectSecurityService.ts:82` | `passwordHash !== expectedHash` | `!constantTimeEqual(passwordHash, expectedHash)` |

- Semantics are identical: both expected values are guarded non-empty before the compare.
- Consider a salted KDF for `contentArchitectSecurityService.ts:82`.
- Then delete the matching `KNOWN_OPEN` entries in `scripts/check-constant-time-secrets.js`.

### 6.4 W2F-3a: WhatsApp webhook (SEC-B)

In `pages/api/whatsapp/webhook/index.ts:48-53`, `verifySignature` should be `if (!APP_SECRET) return false;`.
- Production behaviour is unchanged (already `false`).
- Local webhook testing then needs `WHATSAPP_APP_SECRET`.
- Then delete the `knownOpen` entry.

### 6.5 Closure-matrix rows for the orchestrator

| ID | Status | Remaining action |
|---|---|---|
| SEC-W2F-1 / 2 / 3 / 4 / 5 | FIXED (branch) | Merge |
| SEC-W2F-1a (P1) | OPEN → SEC-A, tracked by the gate | Fix per §6.1 |
| SEC-W2F-1b | OPEN → SEC-A, tracked by the gate | Fix per §6.2 |
| SEC-W2F-2a / 2b / 2c | OPEN → SEC-B (proposed), tracked by the gate | Fix per §6.3 |
| SEC-W2F-3a | OPEN → SEC-B, tracked by the gate | Fix per §6.4 |

## 7. MANUAL OPERATION REQUIRED

None.

## 8. Remaining limitations

**Route-auth gate**
- `requestIdentifiers` does not see nested ids such as `body.activity.id`. W2F-1a was found through `companyId`/`campaignId`.
- R2/R3 remain per file.
- A named re-export whose target module itself re-exports that name is not followed; it fails closed (R1).

**R4-ENV**
- Recognises `NODE_ENV`/`VERCEL_ENV`/`APP_ENV`/`RAILWAY_ENVIRONMENT*` and `is/IS_(Prod|Dev|Local|Test)*` identifiers.
- Environment checks hidden in other helper functions (`isDevMode()` from another module) or ternaries are not recognised.

**Constant-time gate**
- It is heuristic: name- and derivation-based.
- A secret passed through function parameters with neutral names, object properties, or across modules is not tracked.
- Comparisons inside `switch`/`includes()`/`Map` lookups are not covered.
- `backend/**` is scanned wholesale, not only HTTP-facing modules. A non-credential compare there needs `ct-ok`.

**SSRF gate**
- Generic `fetcher`/`fetchFn` injected parameters are trusted. A raw fetch passed into them is caught at the injection site only when it is written as `fetchFn: fetch` / `fetchImpl: globalThis.fetch`. A variable holding the raw fetch that is passed positionally is not caught.
- The provider's injected `fetchImpl` path stays un-guarded by design (test seam; never set at runtime per `renderProviderRegistry.ts:28`).
