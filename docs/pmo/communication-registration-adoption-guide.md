# Adopting Communication Registration — the canonical guide

**Audience:** any future producer module (Writer, Campaigns, Creator, Engagement, Analytics, …).
**Owner:** Zone A2 (Coordination). **Status:** stable, dark by default.

> Adopting the coordination platform is **one call**. You never touch the registry, the store, the
> graph, or observability — `registerCommunication` hides all of it.

---

## 1. The one call

At the point your module **finalizes a communication artifact** (a generated post, a planned campaign
item, a rendered image, an outbound reply, a measured metric), add:

```ts
import { communicationRegistrationPipeline } from '@/backend/services/intelligence/coordination';

await communicationRegistrationPipeline.registerCommunication({
  companyId,                              // your tenant id
  communicationIntent: 'promote',          // free-form is normalized to the canonical vocabulary
  topic,                                   // the subject SEED — not the produced wording
  sourceModule: 'writer',                  // who you are
  // ── everything below is optional ──
  artifactType: 'post',                    // lineage node type
  generationStage: 'generated',
  lifecycleState: 'generated',             // defaults to 'planned'
  platform, campaignId, audience,          // coordination metadata
  contentRef: { kind: 'content', id: contentId },  // soft ref back to your row (no FK)
  parentArtifactId,                        // if this derives from a prior artifact
  semanticRootId,                          // if you already minted one (A1 producers) — else derived
});
```

That's it. Behind the call: the semantic root is ensured, the row is written **idempotently**, it
becomes a node in the communication graph and a prior for duplicate-intent detection, and metrics are
recorded.

## 2. Advancing the lifecycle

As the artifact progresses, advance it (forward-only; idempotent):

```ts
await communicationRegistrationPipeline.advanceLifecycle(companyId, communicationId, 'published');
```

Canonical states: `planned → generated → adapted → published → engaged → measured → archived`.

## 3. What you get for free

- **Idempotent / replay-safe** — safe to call inside a retried job or a webhook that fires twice; a
  duplicate collapses onto the same row (`created:false`). Pass your own `idempotencyKey` if your
  natural identity differs from the default `(company, root, artifactType, stage, platform, campaign,
  audience, contentRef.id)`.
- **Fail-safe** — returns a typed `Result`; it never throws into your critical path. Fire-and-forget
  it if you don't need the outcome: `void communicationRegistrationPipeline.registerCommunication(...)`.
- **Dark by default** — with `COORDINATION_REGISTRATION_MODE=off` (the default) the call derives ids
  and returns `skipped:true` **without writing**, so you can land the call site before the platform is
  turned on. Set `shadow` to start recording.

## 4. Rules for producers

- **Provide a stable `topic` seed** (the subject, not the generated text) — it anchors the semantic
  root that ties your artifact to the rest of the chain.
- **Reuse `semanticRootId` when you have one** (A1's generation runtime mints it via the platform
  `buildSemanticIdentity`) so your artifact groups with its siblings; otherwise it is derived
  deterministically from `(companyId, intent, campaignId, topic)`.
- **Use `contentRef`/`performanceRef` as soft references** back to your own rows — never a DB foreign
  key. Set `observedAt` for historical/replayed events (e.g. analytics `measured`).
- **Do not build a second registry, store, or dedup path** — that is a forbidden overlap. One call.

## 5. Turning it on (operator)

1. `COORDINATION_REGISTRATION_MODE=shadow` — writes to the in-memory store; watch
   `ai.coordination.registration.register{outcome=…}`.
2. `COORDINATION_REGISTRY_PERSIST_ENABLED=true` — durable persistence (requires the
   `communication_registry` migrations applied).
3. Review the shadow-diff, then promote per the PMO rollout.
