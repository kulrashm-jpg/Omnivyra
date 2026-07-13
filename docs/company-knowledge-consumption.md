# Company Knowledge Consumption Framework (CKC-001)

The **single, canonical gateway** through which every AI capability obtains
Company Knowledge. It sits on top of the existing Company Knowledge Platform
(CKRE-001/002/003/004) and adds no new knowledge, store, crawler, or AI pipeline.
No module should read or assemble Company Knowledge directly anymore — they call
`getKnowledgeContext(request)`.

```
consumer ──▶ getKnowledgeContext(request)
                 │
                 ├─ version selection   (knowledgeVersionSelector → CKRE-003 API)
                 ├─ context cache        (knowledgeContextCache → shared Redis)
                 ├─ deterministic assembly (knowledgeContextAssembler)
                 ├─ events + telemetry   (knowledgeConsumerEvents → AUTH-001 envelope)
                 └─▶ KnowledgeContext (canonical contract)
```

## Modules (`backend/services/knowledgeConsumption/`)

| Module | Role |
| --- | --- |
| `companyKnowledgeConsumer.ts` | **The gateway.** `getKnowledgeContext`, `getKnowledgeContextForConsumer`, `invalidateKnowledgeContext`. Orchestrates the pipeline; never throws (returns `null` when unavailable). |
| `knowledgeContextContracts.ts` | Canonical types: `KnowledgeContextRequest`, `KnowledgeContext`, metadata (version, confidence, provenance, freshness, tokens). One shape for every consumer. |
| `knowledgeConsumerProfiles.ts` | Declarative per-consumer domain + mode requirements (Content Writer/Creator, Campaign Planner, Strategic Mix, SEO, Growth, Recommendations, Competitor, Website Intelligence). New modules extend this table. |
| `knowledgeContextAssembler.ts` | The **one** deterministic assembler: domain selection → confidence filtering → field selection → mode optimization → freshness/language/token accounting. Pure (injected clock). |
| `knowledgeVersionSelector.ts` | Resolves `latest / approved / specific / rollback / preview / comparison` against the existing CKRE-003 API. |
| `knowledgeContextCache.ts` | Assembled-context cache over the shared standalone Redis client (in-memory fallback). Company-prefixed keys for wholesale invalidation. |
| `knowledgeConsumerEvents.ts` | `consumption.<Event>` events + `consumption.*` telemetry, reusing the AUTH-001 envelope + HARDEN-001 metric registry. |
| `index.ts` | Single import surface for downstream modules. |

## Requesting context

```ts
import { getKnowledgeContext } from 'backend/services/knowledgeConsumption';

const ctx = await getKnowledgeContext({
  companyId,
  consumer: 'CONTENT_WRITER',
  // all optional — sensible per-consumer defaults apply:
  domains: ['IDENTITY', 'BRAND', 'AUDIENCE'],   // §3 domain selection
  fields: { IDENTITY: ['name', 'website_url'] },// §4 field selection
  minConfidence: 50,                            // §3 confidence filtering
  maxAgeMs: 24 * 3600_000,                       // §3 freshness gate
  language: 'en',                               // §3 language
  version: { kind: 'latest' },                  // §5 version selection
  mode: 'summary',                              // §4 full | summary | compressed
});
// ctx.knowledge[domain].fields, ctx.metadata.{version,confidence,provenance,freshness,tokens}
```

## Filtering (§3)

Consumers request required **domains**, **confidence**, **freshness**,
**language**, and **version**. The assembler returns only domains that exist and
clear the confidence floor; freshness/language are computed and flagged in
metadata (they never mutate or trigger a refresh — that stays with CKRE-004).

## Token optimization (§4)

The complete Company Knowledge object is **never** sent unless `full: true`.
Minimization is layered: consumer-profile domain defaults → explicit domain
selection → field allow-lists → mode.

- **full** — everything, verbatim.
- **summary** (default) — drops empty/null fields, truncates long strings (≤600).
- **compressed** — tighter truncation (≤160), caps arrays (≤10), empties `sourceFields`.

`metadata.tokens` reports `{ served, full, saved }` for every response.

## Version selection (§5)

`latest`, `approved` (current ACTIVE), `specific`, `rollback`, `preview`, and
`comparison` (serves the `toVersion` snapshot; the diff remains available via the
existing `diffKnowledgeVersions` API). Unresolvable versions fall back safely to
current knowledge rather than throwing.

## Caching (§6)

Assembled contexts are cached over the **shared standalone Redis client** (the
same infra `redisExternalApiCache` uses) with an in-memory fallback — no new
cache subsystem. Keys are company-prefixed (`virality:ckc:ctx:{companyId}:{hash}`)
so CKRE-004 orchestration invalidates a company's contexts wholesale on any
knowledge change (wired in `downstreamInvalidationService`).

## Events & observability (§8/§9)

`consumption.<Event>`: `ContextRequested`, `ContextAssembled`, `ContextServed`,
`ContextInvalidated`, `ContextCacheHit`, `ContextCacheMiss`. Telemetry:
`consumption.requests`, `cache_hits`, `cache_misses`, `context_size` (histogram),
`token_savings`, `domain_usage`, `version_usage`. All reuse the AUTH-001 envelope
and the HARDEN-001 metric registry.

## Future extension points

- **New AI modules:** add a row to `CONSUMER_PROFILES`; call `getKnowledgeContext`.
- **Semantic compression:** add a new `KnowledgeContextMode` and a branch in
  `optimizeFields` — the contract and cache key already carry `mode`.
- **New version strategies:** extend `KnowledgeVersionSelector` +
  `resolveKnowledgeForSelector`; `selectorKey` keeps cache keys stable.
- **Migration:** route remaining direct Company-Knowledge readers through
  `getKnowledgeContext` so no module assembles knowledge independently.

## Invariants

- **Deterministic:** identical inputs → identical context; no clock/randomness in
  the assembler (freshness uses an injected `now`).
- **Never throws:** every entrypoint is fail-safe.
- **Additive:** no schema changes, no new tables, no duplicate builders/caches/events.
- **Backward compatible:** the existing CKRE-003 API is unchanged and still works.

## Tests

- `backend/tests/unit/ckc001AssemblerFilteringTokens.test.ts` — assembler
  filtering, field selection, modes, freshness, language, tokens, determinism,
  selector keys (pure).
- `backend/tests/unit/ckc001Consumer.test.ts` — gateway pipeline, cache hit/miss,
  version selection, invalidation, events, fail-safe (mocked API/cache/events).
