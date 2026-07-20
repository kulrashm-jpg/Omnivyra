# Communication Query Profiles

**Owner:** Zone A2 (Coordination) · **Layer:** read-side, above Communication Intelligence.
**Status:** stable, additive, flag-safe. **Consume this — never re-compose graph queries yourself.**

---

## Architecture

```
Registry → Communication Graph → Communication Intelligence → Query Profiles → consumers
                                          (WS-2C low-level)      (WS-2D, here)
```

Query Profiles are **thin compositions** over the Communication Intelligence service (WS-2C). They add
no traversal logic — graph walking stays centralized in `graphNavigation` and the intelligence service.
Every profile runs through **one** shared execution layer (`executeProfile`): tenant guard → time →
compose → observability → fail-safe envelope.

```
executeProfile(profile, {intel}, companyId, req)
   → ProfileResponse<T> { meta {profileType, companyId, resultCount, degraded}, data }
```

## Profile responsibilities

| Profile | Answers | Composes |
|---|---|---|
| **Timeline** | dashboard timeline: chronological comms + lifecycle progression + status/platform/campaign/root + derived artifacts | `getTimeline` + shared lifecycle helper |
| **Continuity** | semantic roots, history, duplicates, gaps, orphan comms, lineage summary, **continuity score** | `getContinuityReport` + `getGraph` + `getHistory` |
| **Campaign** | campaign history, reused intents, distribution, semantic reuse, derived assets, publication coverage | `getHistory` (generic; `campaignId` is a param) |
| **Semantic** | root, ancestors, descendants, duplicate history, related comms, cluster, **lineage tree** | `getLineage` + `graphNavigation` + `getSemanticClusters`/`getRepeatedIntents` |
| **Analytics** | frequency, platform/intent/lifecycle distribution, continuity coverage, duplicate rate, velocity, semantic reuse rate | `getHistory` + `getSemanticClusters` + `getRepeatedIntents` |
| **Audit** | missing roots, broken lineage, orphan artifacts, non-canonical lifecycle, duplicate keys, stale comms, graph anomalies | `getHistory` + `getGraph` + `getGaps` |

## Request / response contracts

- Every response is `ProfileResponse<Data>` with a `meta` block. Data shapes: `TimelineProfileData`,
  `ContinuityProfileData`, `CampaignProfileData`, `SemanticProfileData`, `AnalyticsProfileData`,
  `AuditProfileData`.
- Shared models (Phase 9, extracted to avoid duplication): `CommunicationSummary`, `DistributionBucket`,
  `LifecycleProgressionView`, `ProfileResponse`/`ProfileResponseMeta`.

```ts
import { communicationQueryProfiles } from '@/backend/services/intelligence/coordination';

const res = await communicationQueryProfiles.timeline(companyId, { sinceDays: 90 });
if (res.ok) render(res.value.data.items);

const audit = await communicationQueryProfiles.audit(companyId);        // governance diagnostics
const semantic = await communicationQueryProfiles.semantic(companyId, { semanticRootId });
```

## Intended consumers

Analytics, Campaign Intelligence, dashboards, governance/reporting tooling — anything that needs to
*read* communication intelligence. **A future module must never traverse the communication graph
directly if a profile already answers its question**; if none does, add a profile (below), don't
compose graph queries in the consumer.

## Observability

`ai.coordination.queryprofile.{execution, latency_ms, result_count, degrade}`, labeled `profile_type`.
Non-colliding with the WS-2A/2B/2C namespaces and the Shared-Contract metric names.

## Feature flag

`COORDINATION_QUERY_PROFILES_ENABLED` (default OFF) gates *surfacing* only — the profiles are read-only
and always safe to call.

## Extension guidelines

To add a profile: implement `QueryProfile<Req, Data>` (`type` + `run(deps, companyId, req)` +
`resultCount`), composing **only** the intelligence service / `graphNavigation` — never new traversal.
Add it to the facade and re-export its contracts. It inherits the shared execution layer, observability,
tenant guard, and fail-safe envelope automatically.
