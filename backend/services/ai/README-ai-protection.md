# AI Request Protection (HARDEN-006)

`backend/services/ai/aiRequestGuard.ts` is the **single, reusable** protection
framework every AI execution path passes through before a provider is invoked.
It composes with (does not replace) the gateway's existing cost/concurrency/
provider-token-bucket/usage-enforcement layers.

## Where it runs
- **Gateway seam** — `executeGatewayCompletion` (`aiGatewayProvidersOps.ts`)
  calls `guardAiRequest(...)` FIRST, so every text-generation caller (content,
  blog, report, recommendations, campaign plan, daily plan, chat moderation,
  planner, engagement, insights, blog repurpose/optimize, block enrich, …)
  inherits it automatically.
- **Direct routes** — `pages/api/ai/gpt-chat`, `pages/api/ai/claude-chat`,
  `pages/api/voice/transcribe` call it explicitly (they bypass the gateway) and
  surface a standardized `429`/`413` with a `Retry-After` header.

## Layers (first failure short-circuits)
1. **Request validation** (always, even for admins/exempt orgs): max prompt
   chars, max message count, max estimated tokens, max attachments/images →
   `413`.
2. **Burst** — tight 10s per-user window → `429 AI_BURST_LIMIT`.
3. **Rolling-window rate limits** — per user (min+hour), per company (min+hour),
   per operation, per provider, per IP (identity-light routes) → `429
   AI_RATE_LIMIT` with `layer`.

Built on the platform's distributed Redis sliding-window limiter
(`lib/auth/rateLimit.checkRateLimit`), which is **fail-open** (in-memory cap
when Redis is down). A guard internal error never blocks a legitimate request.

## Configuration (env)
| Var | Default | Meaning |
|-----|---------|---------|
| `AI_GUARD_ENABLED` | `true` | Master switch |
| `AI_MAX_PROMPT_CHARS` | `600000` | Max total prompt characters |
| `AI_MAX_MESSAGES` | `400` | Max message count |
| `AI_MAX_TOKEN_ESTIMATE` | `200000` | Max estimated prompt tokens (chars/4) |
| `AI_MAX_ATTACHMENTS` | `25` | Max attachments |
| `AI_MAX_IMAGES` | `20` | Max images |
| `AI_RATE_USER_PER_MIN` / `_PER_HOUR` | `60` / `1200` | Per-user rolling limits |
| `AI_RATE_COMPANY_PER_MIN` / `_PER_HOUR` | `300` / `6000` | Per-company rolling limits |
| `AI_RATE_OP_PER_MIN` | `240` | Per-operation surge limit |
| `AI_RATE_PROVIDER_PER_MIN` | `1500` | Per-provider surge limit |
| `AI_RATE_IP_PER_MIN` | `90` | Per-IP limit (identity-light routes) |
| `AI_BURST_USER_PER_10S` | `20` | Per-user burst cap |
| `AI_GUARD_EXEMPT_ORGS` | — | CSV of org ids that bypass rate/burst |

Set any rate limit to `0` to disable that layer. Defaults are generous so
legitimate users are unaffected; tighten per environment.

## Extending (future-ready)
- **New provider** → add to `AiGuardProvider` + `providerFromModel`.
- **Plan tiers / enterprise / priority / API customers** → resolve per-caller
  limits in `loadLimits()` (e.g. from a plan lookup) and/or add to the exempt
  set. No architectural change — every caller already flows through
  `guardAiRequest`.
- **Admin overrides** → `isAdmin: true` in the context, or the exempt-org env.

## Observability (HARDEN-001)
Counters: `ai.guard.allowed`, `ai.guard.blocked` (with `layer`), `ai.guard.throttled`
— all tagged by `operation`/`provider`. Visible in the observability snapshot.

## Trusted / exempt paths
Embedding calls, image generation, and OCR run in background/internal contexts
(not user-facing bursts) and are cost-guarded by the existing
`jobCostEstimator` + credit system; they are documented-exempt from the
per-request guard. A future phase can route them through `guardAiRequest` if
user-facing surfaces are added.
