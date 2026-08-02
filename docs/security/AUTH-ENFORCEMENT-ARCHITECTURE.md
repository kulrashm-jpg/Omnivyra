# API Authentication & Authorization Enforcement Architecture

**Status:** DESIGN v5 — Option D approved; Phase 0 implemented, Phase 1 infrastructure + declaration wave implemented (§6).
**Date:** 2026-08-02 (v1: 2026-08-01 · v2: 2026-08-02 · v3: 2026-08-02 · v4: 2026-08-02 · v5: 2026-08-02)
**Trigger:** SEC-001 — four confirmed unauthenticated cross-tenant routes
**Scope:** 1301 API route files; 526 GET-only routes analysed in depth
**Related:** `PERFORMANCE_OPTIMIZATION_LEDGER.md`

**Changes in v2:** policy validation layer (§4), policy schema versioning (§3.4), formal architecture invariants (§1), expanded CI gate (§5), webhook trust models separated into receiver vs. management (§2), SEC-001 decoupled from the migration as Phase 0 (§6).

**Changes in v5 (Design Change v5 — approved 2026-08-02):** trust-domain terminology formalized as **Principal Trust** (who may request) / **Publication Trust** (whether content is public) / **Delivery Trust** (under what delivery conditions public content may be served) — §3.8. `checkFormOrigin()` is classified as **Delivery Trust**: not authorization, not publication, and it remains handler business logic that Phase 2 enforcement and V-11 cleanup must never replace or bypass. The Batch 2b Public Contract is approved and named **Embeddable Configuration** (generalized from "Form Configuration" so the registry stays reusable for future embeddable resources). Drift warnings are organized into three conceptual layers — **Implementation Drift**, **Category Drift**, **Contract Drift** — with all existing warning identifiers unchanged for Phase 1. Documentation only: no schema or runtime changes.

**Changes in v4 (Design Change v4 — approved 2026-08-02):** the single-policy-per-route assumption is recorded as a **known architectural limitation** (§3.6). Repository verification during the Task 3b assessment found routes whose trust model differs **by HTTP method** — `leads/index.ts` is the confirmed instance (GET: company-scoped via `enforceCompanyAccess`; POST: public webhook/embed sink with signature validation). Documentation-only: the single-policy model is unchanged for Phase 1, no current implementation is blocked, and the limitation is revisited during Phase 2 planning.

**Changes in v3 (Design Change v3 — approved 2026-08-02):** the Phase 0 "410 if no callers" rule is **replaced** by the contract-preservation rule (§6 Phase 0). A lack of repository call sites is insufficient evidence that an API contract is obsolete; security remediation preserves API contracts whenever reasonably possible. Endpoints with no verified in-repo callers are **guarded, not retired** — no `410`. API retirement is a separate lifecycle requiring independent evidence and approval. Trigger for the change: the Phase 0 impact assessment found the three `companies/[id]` routes' only caller (`components/admin/BrandIntelligencePanel.tsx`) is unmounted dead code, and `governance/company-analytics` has no in-repo caller at all — the v2 rule would have retired all four routes on repo-local evidence alone.

---

## 1. Architecture Invariants

These hold at all times. Each is stated so it can be mechanically checked; the enforcement column names the layer that guarantees it.

| ID | Invariant | Enforced by | Statically checkable |
|---|---|---|---|
| **INV-1** | A tenant identifier arriving in a request (path, query, body, header) is an **assertion**, never an **authority**. It must be validated against server-resolved membership before any data access. | Policy gate | Partial — via `companyIdFrom` declaration |
| **INV-2** | Authorization completes before business logic begins. No handler executes with an unresolved principal. | Route factory ordering | Yes |
| **INV-3** | Every API route has **exactly one** policy declaration. Zero ⇒ deny. More than one ⇒ build error. | CI gate + factory | Yes |
| **INV-4** | Public endpoints are public **by explicit declaration with written justification**, never by omission. | Policy schema | Yes |
| **INV-5** | Business logic never resolves authentication independently. Handlers read the verified principal from request context. | Convention + CI lint | Partial — detect identity calls inside handler bodies |
| **INV-6** | A response derived from tenant-scoped data is never emitted with a shared-cache directive (`public`, `s-maxage`). | Policy validation | Yes |
| **INV-7** | Machine-to-machine callers (cron, worker, webhook) authenticate by secret or signature, never by session. | Policy validation | Yes |
| **INV-8** | Identity is resolved **at most once** per request and memoised in the execution context. | Route factory + ALS | Partial |
| **INV-9** | Every deny decision is attributable: route, category, principal (or absence), and reason are recorded. | Policy gate | No — runtime property |
| **INV-10** | Policy evaluation is **fail-closed**. Any error inside the gate denies the request; it never falls through to the handler. | Policy gate | Yes — by test |

**INV-10 is a deliberate departure from repository convention.** `createApiRoute` today is documented as fail-safe: *"an instrumentation/context failure degrades to running the handler directly."* That is correct for observability and wrong for authorization. The policy gate must be the one layer that fails closed. This distinction must be explicit in the implementation, or the existing fail-safe idiom will be copied and silently defeat the whole design.

---

## 2. Route Classification

### 2.1 Categories

Eleven categories. Webhooks are split because receiver and management endpoints have **incompatible trust models** — one authenticates a third-party signature with no user present, the other authenticates a human operator.

| # | Category | Identity source | Tenant binding | Authorization | Cache directive | Est. |
|---|---|---|---|---|---|---|
| 1 | `public` | none | forbidden | none | `public, s-maxage` permitted | ~15 |
| 2 | `authenticated-user` | `resolvePrincipal` → 401 | none (self-scoped) | identity only | `private` | ~40 |
| 3 | `tenant-scoped` | required | **server-derived only** | membership | `private` | ~250 |
| 4 | `company-scoped` | required | asserted id validated vs. membership | company role | `private` | ~200 |
| 5 | `admin` | required | within tenant | admin role | `private, no-store` | ~60 |
| 6 | `super-admin` | required | cross-tenant by design | platform super-admin + audit | `no-store` | ~82 |
| 7 | `internal` | service identity | n/a | secret / network | `no-store` | ~9 |
| 8 | `worker-cron` | shared secret | n/a | constant-time secret compare | `no-store` | 28 |
| 9 | `webhook-receiver` | **provider signature** | provider → tenant mapping | signature + replay window | `no-store` | ~12 |
| 10 | `webhook-management` | `resolvePrincipal` → 401 | tenant | admin role | `private, no-store` | ~8 |
| 11 | `system-health` | none or secret | n/a | none | short `public` or `no-store` | ~9 |

Counts are estimates pending the Phase-2 classification pass. Only categories 8 and 9+10 combined were enumerated exactly (28 cron, ~20 webhook-ish).

### 2.2 Why 9 and 10 must not share a category

A receiver is called by Stripe or a social platform. There is no user, no session, and no tenant in the request — the tenant is *derived* from the payload's provider account id. Authentication is HMAC signature verification plus a replay window.

A management endpoint ("list my configured webhooks", "rotate signing secret") is called by a human admin in a browser. It has a session, a tenant, and a role requirement.

Collapsing these into one category would force the policy validator to accept "either a signature or a session," which defeats INV-7 and would let a session-authenticated caller reach a receiver path. They are separate categories with disjoint validation rules.

### 2.3 Evidence notes

- **Cron:** 27 of 28 verify `CRON_SECRET`. `cron/report-automation.ts` does not → **SEC-002**.
- **Webhook:** billing receivers (`billing/settlement-webhook/[provider].ts`, `billing/checkout/verify.ts`) verify signatures correctly and are the reference implementation. `community-ai/webhooks.ts` shows no signature check → **SEC-003**, and must first be classified as 9 or 10.
- **Super admin:** three mechanisms coexist (`requireSuperAdmin`, `isSuperAdmin`, `getLegacySuperAdminSession` + cookie bridge) → **SEC-004**. Consolidation is desirable but is **not** a prerequisite.

---

## 3. Enforcement Architecture

### 3.1 Current lifecycle and the defect

```
Edge → proxy.ts ────────── content-architect cookie allowlist only; else pass
     → createApiRoute ──── observability + ALS scope.  opts.use DORMANT
     → handler body ────── ★ ONLY enforcement point; opt-in; 47+ idioms
     → response
```

Both upstream layers self-document their abstention. `proxy.ts`: *"Auth enforcement lives in individual API route handlers."* `routeFactory`: *"Pass-through by construction"*, `opts.use` *"Reserved for later waves; Batch A ships no middleware."*

The defect is not idiom sprawl — it is that **omission is silent**. Nothing distinguishes "deliberately public" from "author forgot."

### 3.2 Target

```
                  TODAY (fail-OPEN)          TARGET (fail-CLOSED)
Edge/proxy        content-architect only      unchanged
Route factory     ▓ nothing                   █ POLICY GATE
                                                ├ validate policy (build-time)
                                                ├ resolve identity  (once)
                                                ├ bind + verify tenant
                                                ├ RBAC / capability
                                                └ DENY if undeclared
Handler body      █ everything, opt-in        ▓ business logic only
```

### 3.3 Reusable primitives (no new security machinery required)

| Primitive | Location | Role in target design |
|---|---|---|
| `resolvePrincipal(req)` | `backend/security/IdentityResolver.ts` | Canonical identity. Discriminated union; handles Supabase, legacy cookie bridge, session authority, precedence. |
| `RequestExecutionContext` | `lib/platform/requestContext.ts` | `setPrincipal`/`getPrincipal`/`getTenantId`. Satisfies INV-8. |
| `withTenantGuard` | `backend/security/withTenantGuard.ts` | Tenant binding; already correct HOF shape. |
| `requireCapability` | `backend/security/requireCapability.ts` | 389 uses; capability registry exists. |
| `resolveCompanyAccess(req,res,companyId)` | `backend/services/contentArchitectService.ts` | Company membership + role. Returns `{userId,role} \| null`, writes its own 400/401/403. **Basis of the SEC-001 hotfix.** |
| `opts.use: RouteMiddleware[]` | `lib/platform/routeFactory.ts` | The dormant seam this design activates. |

*Note:* `resolveCompanyAccess` living in `contentArchitectService.ts` is a misplacement for a general authorization primitive. Relocating it is desirable cleanup, **not** a prerequisite — the hotfix should import it where it is.

### 3.4 Policy schema (versioned)

Every declaration carries `v`, the policy **schema** version — not a route version. It exists so the validator and gate can evolve interpretation without ambiguity, and so a future `v: 2` with different defaults cannot be silently misread as `v: 1`.

```
type RoutePolicy =
  | { v: 1; category: 'public'; justification: string }
  | { v: 1; category: 'authenticated-user' }
  | { v: 1; category: 'tenant-scoped';  tenantFrom: 'context'; capability?: Capability }
  | { v: 1; category: 'company-scoped'; companyIdFrom: PolicySource; capability?: Capability }
  | { v: 1; category: 'admin';          companyIdFrom: PolicySource; role: AdminRole }
  | { v: 1; category: 'super-admin';    audit: true }
  | { v: 1; category: 'internal';       secret: SecretRef }
  | { v: 1; category: 'worker-cron';    secret: SecretRef }
  | { v: 1; category: 'webhook-receiver';   provider: string; signature: SignatureScheme; replayWindowSec: number }
  | { v: 1; category: 'webhook-management'; companyIdFrom: PolicySource; role: AdminRole }
  | { v: 1; category: 'system-health';  exposure: 'public' | 'secret' };

type PolicySource = 'query.<field>' | 'path.<field>' | 'body.<field>' | 'context';
```

**Rules baked into the type:** `public` cannot carry a tenant source. `company-scoped` cannot omit one. `webhook-receiver` cannot carry a role. The discriminated union makes a large class of misconfiguration a **compile error**, before CI is even reached.

Unknown or missing `v` ⇒ reject at build. Absent `policy` ⇒ deny at runtime, fail CI.

### 3.5 Declaration example

```
createApiRoute(handler, {
  route: '/api/companies/:id/learnings',
  policy: {
    v: 1,
    category: 'company-scoped',
    companyIdFrom: 'path.id',        // the ASSERTION — validated, never trusted
    capability: COMPANY_ANALYTICS_VIEW,
  },
})
```

Gate sequence: resolve identity → 401 · memoise principal (INV-8) · validate asserted company id against membership → 403 (INV-1) · capability check → 403 · invoke handler with verified principal and tenant in context (INV-2).

---

### 3.6 Known limitation — single policy per route (Design Change v4)

The v1 schema (§3.4) and INV-3 assume **one authorization policy per route file**. Repository verification (Task 3b assessment, 2026-08-02) demonstrated this assumption is not universally true: a route's trust model can differ **by HTTP method**.

**Confirmed instance:** `pages/api/leads/index.ts` — `GET` lists leads behind `enforceCompanyAccess` (category `company-scoped`), while `POST` accepts lead submissions from external embeds and signed webhooks (category `webhook-receiver`/public-ingestion trust model). No single `RoutePolicy` value describes both truthfully, so the route is **excluded from declaration** rather than mis-declared.

**Candidate future directions** (evaluation deferred to Phase 2 planning; none is chosen here):
1. **Per-method policies** — `policy` becomes `RoutePolicy | Partial<Record<HttpMethod, RoutePolicy>>`. Most expressive; complicates INV-3's "exactly one" and the validator/inventory.
2. **Route splitting** — refactor mixed-mode files into one route per trust model (e.g. `leads/index.ts` GET vs. a dedicated ingestion endpoint). Keeps the schema simple; costs URL churn for external callers (webhook URLs are long-lived — migration burden is real).
3. **Method-level metadata** — keep one primary policy plus a declared `methodOverrides` exception list, validated so overrides cannot *loosen* the primary policy silently.

**Status and scope:**
- The single-policy model is **unchanged for Phase 1**. INV-3 stands as written for every route that has one trust model — which is every route in the Task 3b declaration wave.
- **No current implementation is blocked by this limitation.** Mixed-mode routes are simply not declared in Phase 1; they remain governed by their existing in-handler guards, and the C-4 inventory records them as undeclared (visible, not hidden).
- **Revisit during Phase 2 planning**, where the mixed-mode population must be enumerated as part of the category-3 classification pass before choosing among the directions above.

### 3.7 Public justification structure and Public Contracts (Batch 2a refinement, approved 2026-08-02)

INV-4 makes a `public` declaration carry a written justification. As of Batch 2a, every public justification is internally structured around three concepts, serialized into the existing `justification: string` field (no schema change) with labeled segments:

```
justification: 'Purpose: <why the endpoint exists>. Exposure: <exactly what data leaves>. Rationale: <why public access is safe/intended>. Contract: <Public Contract name>.'
```

- **Purpose** — what the endpoint is for. *Future validator work: mechanically checkable* (label presence, non-placeholder content).
- **Exposure** — precisely which fields/data are emitted. *Future validator work: mechanically checkable* (label presence; field-list cross-checks are aspirational).
- **Rationale** — why public access is intended and safe. **Permanently human-reviewed** — this is the INV-4 judgment that cannot be mechanized (§4.2).

**Public Contracts** — named, reusable patterns of legitimate public exposure. A public declaration identifies which contract it satisfies, so reviewers evaluate "does this route honor its contract?" instead of re-deriving safety from scratch. Initial contract vocabulary:

| Contract | Meaning | Instance |
|---|---|---|
| **Published Content** | Serves only content an owner explicitly published; the publish action is the authorization | `blogs/[id]/public.ts` |
| **Search Engine Content** | Exists to be crawled/indexed; minimal metadata (slugs, dates) | `blog/sitemap.ts` |
| **Embeddable Content** | Consumed by external sites via embed/feed; published-only, reduced field set, CORS-open | `blogs/public.ts` |
| **Embeddable Configuration** (v5) | Serves per-resource configuration to embedding sites; trust boundary is the owner-configured origin allowlist (Delivery Trust, §3.8) plus an unguessable resource id; exposure includes the identifiers the embed needs to function; no publish gate exists | `forms/[id]/embed.ts` |

The contract vocabulary grows as new public shapes are verified (Embeddable Configuration was generalized from "Form Configuration" at approval precisely so future embeddable resources reuse it). Contracts are documentation-layer today: no validator or schema enforcement in Phase 1; `CONTRACT-DRIFT-1` (warn-only) checks that every public declaration names a registry contract, and a future validator may go further.

**Public drift warnings (Batch 2a, warn-only — never blocking, excluded from `ROUTE_POLICY_STRICT`):** because public declarations rest on intent rather than mechanical derivation, `check:route-policy` pins the intent's *observable* residue: **PUB-DRIFT-1** — declared `public` but a principal-authorization helper appears in the file; **PUB-DRIFT-2** — declared `public` with in-file service-role DB reads and no published-status filter (may false-positive if a refactor moves the filter into a service — the acceptable failure direction for a warning); **PUB-DRIFT-3** (partial INV-6/V-6) — a declared **non**-public route whose source emits a shared-cache directive (`public`/`s-maxage`). Limits per §4.2: service-layer indirection, column-emission changes, and store/view redefinition remain human-review properties.

### 3.8 Trust domains (Design Change v5, approved 2026-08-02)

Three orthogonal trust domains, replacing informal "public vs. guarded" talk:

| Domain | Question it answers | Mechanism examples | Owned by |
|---|---|---|---|
| **Principal Trust** | *Who may request?* | `resolveCompanyAccess`, `requireCapability`, session/secret/signature verification; the RoutePolicy categories and the policy gate | Policy layer (gate + declarations) |
| **Publication Trust** | *Is this content public at all?* | publish actions, `status='published'` filters, the published-only pillar of Published/Embeddable Content contracts | Content model + handler queries |
| **Delivery Trust** | *Under what delivery conditions may public content be served?* | origin allowlists (`checkFormOrigin`), CORS policy, cache directives (INV-6) | Handler business logic |

**Classification ruling:** `checkFormOrigin()` belongs to **Delivery Trust**. It is not authorization (no principal is evaluated) and not publication (no publish state is consulted) — it constrains *where* owner-published configuration may be delivered. It therefore **remains handler business logic permanently**: the Enforcement Gate (Phase 2) evaluates Principal Trust only and is a structural no-op for category `public`, so it cannot bypass Delivery Trust checks; and **V-11 cleanup (which removes in-handler *principal* resolution) must never remove or replace Delivery Trust checks.** A route can be `category: public` (no Principal Trust required) while still enforcing Publication Trust and Delivery Trust in its handler — the three domains compose, they do not substitute.

**Drift layers (v5 terminology; Phase 1 warning identifiers unchanged):**

| Layer | Detects divergence between… | Current rules |
|---|---|---|
| **Implementation Drift** | a declaration and the mechanical implementation it was derived from | DRIFT-1, DRIFT-2, DRIFT-3, DRIFT-4 |
| **Category Drift** | a declared category and in-file trust signals | PUB-DRIFT-1, PUB-DRIFT-2, PUB-DRIFT-3 |
| **Contract Drift** | a public declaration and its documented Public Contract | CONTRACT-DRIFT-1, FORM-DRIFT-1, FORM-DRIFT-2 |

---

## 4. Policy Validation Layer

Static validation runs at build time, before any request is served. It rejects declarations that are *syntactically* valid but *semantically* unsafe.

### 4.1 Rejection matrix

| # | Invalid combination | Violates | Severity |
|---|---|---|---|
| V-1 | `public` + any tenant source (`companyIdFrom`/`tenantFrom`) | INV-4 | **error** |
| V-2 | `tenant-scoped`/`company-scoped` with no tenant source | INV-1 | **error** |
| V-3 | `worker-cron` or `internal` with no `secret` | INV-7 | **error** |
| V-4 | `webhook-receiver` with no `signature` scheme | INV-7 | **error** |
| V-5 | `webhook-receiver` with no `replayWindowSec` | INV-7 | **error** |
| V-6 | `admin`/`super-admin`/tenant categories emitting `public`/`s-maxage` | INV-6 | **error** |
| V-7 | `public` route whose handler reaches a tenant-scoped table | INV-4 | **error** (best-effort import-graph analysis) |
| V-8 | Missing or unknown `v` | §3.4 | **error** |
| V-9 | More than one policy per route file | INV-3 | **error** |
| V-10 | `public` with empty or placeholder `justification` | INV-4 | **error** |
| V-11 | Identity resolution called inside a handler body | INV-5 | **warn** → error after migration |
| V-12 | `companyIdFrom` naming a field the handler never reads | drift | **warn** |
| V-13 | `super-admin` without `audit: true` | INV-9 | **error** |

### 4.2 What validation cannot prove

Honesty about the limits matters more than the list above:

- **V-7 is heuristic.** Import-graph reachability to a tenant table is an approximation. Dynamic dispatch, service indirection, and raw SQL defeat it. It catches careless mistakes, not determined ones.
- **Correct-but-wrong declarations are undetectable.** A route declared `company-scoped` with `companyIdFrom: 'query.orgId'` when the handler actually reads `query.companyId` passes every check and enforces nothing useful. V-12 mitigates this by warning, but cannot see through indirection.
- **Runtime authorization semantics are out of scope.** Whether `resolveCompanyAccess` correctly implements membership is a property of that function, tested separately.

Static validation raises the floor. It does not remove the need for review on tenant-scoped routes.

---

## 5. CI Gate — `check:route-policy`

Matches the existing `check:ssrf` / `check:authz` gate pattern.

| Check | Rule | Phase introduced |
|---|---|---|
| C-1 | Every `createApiRoute` call under `pages/api/**` declares a `policy` | 3 (warn in 2) |
| C-2 | Full §4.1 rejection matrix (errors) | 2 |
| C-3 | §4.1 warnings reported, non-blocking | 1 |
| C-4 | Policy inventory artifact emitted per build (route → category → tenant source) | 1 |
| C-5 | Diff alert when a route changes category, or any route becomes `public` | 2 |

**C-4 is the durable audit answer.** "List every public endpoint" becomes reading one generated file. This audit needed three passes over 47+ idioms and still ended with 68 Unknowns; that failure mode becomes structurally impossible.

**C-5 is the regression control.** A route silently becoming `public` in a large PR is exactly how SEC-001-class defects are reintroduced.

---

## 6. Migration Roadmap

**Phase 0 is independent of everything below it. Phase 0 was implemented on 2026-08-02 (all four routes guarded via `resolveCompanyAccess`, per Design Change v3); Phases 1–3 remain design-only.**

### Phase 0 — SEC-001 hotfix (immediate, does not wait on the architecture) — ✅ IMPLEMENTED

Four routes. Per route: derive the company id already being read, then

```
const access = await resolveCompanyAccess(req, res, companyId);
if (!access) return;   // helper has already written 400/401/403
```

- `companies/[id]/learnings.ts` · `companies/[id]/efficiency-score.ts` · `companies/[id]/outcome-history.ts` · `governance/company-analytics.ts`
- **Contract preservation (Design Change v3, replaces the v2 "410 if no callers" rule):** a lack of repository call sites is insufficient evidence that an API contract is obsolete. An endpoint with no verified in-repo callers is preserved and guarded with the required authorization — never converted to `410` as part of security remediation. API retirement is a separate lifecycle requiring independent evidence and approval.
- **Risk:** low. Additive guard using a pattern already live in `company-profile/completeness.ts`.
- **Rollback:** revert per file.
- **Validation:** unauthenticated request returns 401/403; authenticated member still returns 200; non-member returns 403.

### Phase 1 — Observe (zero behaviour change) — infrastructure ✅ IMPLEMENTED (Task 3a, 2026-08-02); first declarations pending (Task 3b)

- Add optional `policy` to `CreateApiRouteOptions`. Absent ⇒ today's behaviour exactly. **[3a ✅ — `lib/platform/routeFactory.ts`]**
- Implement the gate in **shadow mode**: resolve, evaluate, log `{route, category, wouldAllow, wouldDeny, reason}`. **Never block.** **[3a ✅ — `lib/platform/policyGate.ts`, rollout flag `route-policy-gate` default off]**
- Ship the validator and CI gate at **C-3/C-4 only** (warnings + inventory). **[3a ✅ — `lib/platform/routePolicy.ts` validator, `scripts/check-route-policy.js`, `check:route-policy` in the TypeScript Baseline workflow; inventory → `artifacts/route-policy-inventory.json`]**
- Declare policies for the ~15 `public` routes and the 4 Phase-0 routes as the first real declarations. **[3b — split by approved Decision 1. Verified-population correction: 4 `public` GETs + 4 Phase-0 (POST publics = write-path effort; health family = `system-health`, Phase 2 step 4). Batch 1 ✅ 2026-08-02: the 4 Phase-0 routes declared `company-scoped` (3× `path.id`, 1× `query.companyId`) with warn-only declaration↔implementation drift detection (DRIFT-1..4) added to `check:route-policy`. Batch 2a ✅ 2026-08-02: `blogs/public.ts`, `blogs/[id]/public.ts`, `blog/sitemap.ts` declared `public` with §3.7-structured justifications + Public Contracts, and PUB-DRIFT-1..3 warn-only rules added. Batch 2b ✅ 2026-08-02: `forms/[id]/embed.ts` declared `public` (Contract: Embeddable Configuration, Delivery Trust per §3.8) with CONTRACT-DRIFT-1 + FORM-DRIFT-1/2 warn-only rules. **Wave 1 complete: 8/8 declared.**]**

**Task 3a approved refinements (2026-08-02):**
- `evaluatePolicy(policy, principalView, requestView) → PolicyDecision` is a **pure function** (no identity resolution, flags, logging, metrics, ALS, runtime imports, response writes, time, or randomness) shared verbatim by the Phase 1 Observation Gate and the Phase 2 Enforcement Gate — only the runtime mode differs. Determinism is test-pinned.
- `PolicyDecision` carries `decisionSchemaVersion` — versioned independently of the policy schema `v`.
- Decision 2 reconciliation of INV-10: Phase 1 runs an **Observation Gate** (fail-safe, logging only, never blocks, lazy-loads the security graph); the **Enforcement Gate** (fail-closed, INV-10) arrives in Phase 2 over the same evaluator.
- Facts the pure evaluator cannot verify (machine secrets/signatures, undeclared capability sets) yield a third outcome, **`abstain`** (`wouldAllow` and `wouldDeny` both false) — observation never guesses.

*Breaking changes:* none. *Rollback:* flag off, or revert one file.
*Exit criterion:* shadow logs show zero unexpected denials across a full traffic cycle, including cron and webhook windows.

### Phase 2 — Declare and enforce, by category

Ascending blast radius:

1. **`public`** (~15) — enforcement is a no-op; establishes the pattern.
2. **`super-admin` / `admin`** (~142) — smallest population, loudest failures, least customer-visible.
3. **`company-scoped` / `tenant-scoped`** (~450) — the bulk, and where SEC-001 lives. Enforce per sub-tree, never repo-wide in one step. **The 68 Unknown routes are classified here**, as part of declaration rather than as a separate pass.
4. **`worker-cron` / `webhook-receiver` / `webhook-management` / `internal` / `system-health`** (~66) — distinct trust models; last.

CI advances to **C-2 + C-5** (blocking validation) once category 1 is declared.

*Breaking changes:* a mis-declared policy returns 403. Contained by per-category flags.
*Compatibility — largest risk:* the legacy super-admin cookie bridge and content-architect session must become **first-class principal types** in `resolvePrincipal`, or those flows break at enforcement. This must be resolved before step 2, not discovered during it.
*Rollback:* per-category flag → shadow. No schema or data migration, so rollback is instant and total.

### Phase 3 — Close the door

- Factory default flips to **deny-if-undeclared** (INV-3).
- CI advances to **C-1** blocking.
- V-11 promoted from warn to error; remove now-redundant in-handler guard calls (mechanical, optional).
- Consolidate the three super-admin mechanisms (SEC-004).
- Relocate `resolveCompanyAccess` out of `contentArchitectService.ts`.

*Breaking changes:* a new route without a policy fails CI. **Intended.**
*Rollback:* revert the default flag; demote the gate to warn.

### Out of scope — tracked separately

**Write-path routes (POST/PUT/PATCH/DELETE) have not been audited at all.** The policy model covers them by construction, but no classification work has been done, and a write-side IDOR would be materially worse than SEC-001. This needs its own scoped effort.

---

## 7. Risk Register

### Confirmed

**SEC-001 — Unauthenticated cross-tenant read (IDOR) ×4** — **High**

`companies/[id]/learnings.ts` · `companies/[id]/efficiency-score.ts` · `companies/[id]/outcome-history.ts` · `governance/company-analytics.ts`

Full handler of the first, 26 lines total:
```
const companyId = req.query.id as string;
const learnings = await getEffectiveLearnings(companyId, { limit });
return res.status(200).json(learnings);
```

- **Exploitability:** trivial, unauthenticated, no rate limit. Requires a company UUID — a real barrier to untargeted enumeration, none at all to anyone who has seen one. Company ids appear in authenticated client URLs and payloads, so ex-employees, former customers, and shared-link recipients plausibly hold them.
- **Affected data:** derived business intelligence — learning/decay signals, efficiency scores, outcome history, governance analytics. Not credentials, not end-user PII. Competitively sensitive rather than regulated.
- **Business impact:** cross-tenant confidentiality breach; contractual and trust exposure with B2B customers; likely triggers breach-notification review depending on customer agreements.
- **Severity rationale — High, not Critical:** no write path, no credential exposure, no direct PII, UUID required.
- **Mitigation:** Phase 0 above.
- **Verification gap:** confirmed by source reading. **Not** confirmed by an unauthenticated request against a deployed instance. That check should precede treating this as an active incident — the source evidence is unambiguous enough to begin remediation regardless.

### Potential

| ID | Issue | Action |
|---|---|---|
| SEC-002 | `cron/report-automation.ts` — only cron route with no `CRON_SECRET` check | Confirm external reachability; patch |
| SEC-003 | `community-ai/webhooks.ts` — no signature verification found | Classify as category 9 or 10 first, then patch accordingly |
| SEC-004 | Three coexisting super-admin mechanisms | Precedence review; consolidate in Phase 3 |
| SEC-005 | `debug/whoami.ts` returns identity, memberships, cookie presence | Self-scoped, not cross-tenant; disable in production |

### Unknown

**68 GET-only routes** with untraced enforcement — `campaigns/*`, `market-pulse/*`, `recommendations/[id]/*`, `analytics/post/[postId]`, `governance/*`, `media/list`, `team/assignments`, others.

**Unknown, not safe.** This audit's own history is the argument: successive passes produced 288 → 102 → 81 unguarded as the guard inventory grew from 19 to 47+ mechanisms. Each pass looked authoritative; each was wrong. Only per-route reading is trustworthy. These are resolved in Phase 2 step 3.

**All write-path routes** — unaudited, unscoped.
