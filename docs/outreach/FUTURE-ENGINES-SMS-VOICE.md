# Future engines: SMS and Voice

**Neither engine is authorized or built.** This shows they could arrive through the existing contracts. Any implementation needs a separate scope and authorization decision. There are no empty engines, placeholder production adapters or speculative tables, and `ENGINE_NAMES` stays at five.

Written against orchestration's contract v0.1 draft, uncommitted at the time. The test passed 21 of 21 against a temporary copy; it is held at `proposals/outreachFutureEngineCompatibility.test.ts.txt` until v0.1 commits, then moves to `backend/tests/unit/`.

## What exists

No vendor code, dependency or history (`git log --all -S` over production paths finds no Twilio or Plivo commit). `phone` and `sms` are authorable step channels; such a step stays `unsupported` and ready, so a journey blocks there today (B-22). `channelCapabilityModel` lists `sms` and `voice` as non-operational, and only its own test imports it.

## Capability declarations

```ts
const SMS: EngineCapabilityDeclaration = {
  contractVersion: EXECUTION_CONTRACT_VERSION,
  engine: 'sms',
  actions: [{
    action: 'send_sms', channel: 'sms', contactsPerson: true,
    idempotency: 'engine_record', approval: 'ws3_task', creditMetered: true,
    reportsDelivery: true, reportsResponses: true,
    providers: [
      { provider: '<chosen later>', credentials: 'tenant', verification: 'mocked' },
      { provider: '<chosen later>', credentials: 'platform', verification: 'mocked' },
    ],
  }],
};

const VOICE: EngineCapabilityDeclaration = {
  contractVersion: EXECUTION_CONTRACT_VERSION,
  engine: 'voice',
  actions: [{
    action: 'place_call', channel: 'phone', contactsPerson: true,
    idempotency: 'request_ledger', approval: 'engine_record', creditMetered: true,
    reportsDelivery: false, reportsResponses: true,
    providers: [{ provider: '<chosen later>', credentials: 'tenant', verification: 'mocked' }],
  }],
};
```

## Registration

No new registry. Adding an engine means: extend `ENGINE_NAMES`, widen the `execution_engine_requests` engine CHECK, update the contract test, add the adapter to `buildAdapterRegistry`, and add the declaration beside the others in `engineCapabilities.ts`. The registry throws if two adapters claim a channel.

## Request and response

Both use the existing shapes, with nothing new:

```ts
// Request: EngineStepContext, one call per ready step
{ organizationId, executionInstanceId, executionTaskId, planStepId,
  channel: 'sms', subject: { kind, id }, step, personId }
// idempotency key: task:<executionTaskId>
// correlation id:  journey:<executionInstanceId>/step:<planStepId>

// Response: EngineResult
{ engine: 'sms', outcome: 'sent', disposition: 'completed', reason: null, externalRef: '<provider id>' }

// Normalized by normalizeEngineResult
{ contractVersion: '0.1.0', engine: 'sms', state: 'ACCEPTED', certainty: 'definite',
  errorClass: null, retryability: 'not_retryable', engineOutcome: 'sent',
  disposition: 'completed', externalRef: '<provider id>' }
```

A lost provider response normalizes as `outcome: 'timeout'`, `certainty: 'uncertain'`, `errorClass: 'may_have_acted'`, `retryability: 'human_only'`. A call that reached nobody (`no_answer`) is ACCEPTED, never DELIVERED.

## Adapter boundaries

| Boundary | Rule |
|---|---|
| Adapter | Turns one step into one engine call. Never re-implements a gate, never re-routes a channel |
| Provider | Behind the engine. Selected per tenant from declared providers |
| Credentials | `integration_credentials` for tenant API keys, as A3P does. No new store |
| Webhook | Verify the signature first, normalize, record, following the SES route. Refuse unverifiable input |
| Outcomes | Through the journey response path, never a second event system |

**Recommendation on the two seams.** SMS: a WS-3 `OutreachTransport` behind a thin `sms` engine identity, since it is a one-way message with the same task lifecycle, approval, governance and quota. A separate path would duplicate all of them. Voice: its own engine using `execution_engine_requests`, since a call is long-running, has a disposition and may involve a person. Needs orchestration's agreement when scoped.

## Governance requirements before either starts

- Consent: no positive consent store exists. Owner and counsel decision, with quiet hours and call-recording rules.
- STOP scope: does an SMS STOP also block calls and WhatsApp? Today's detector is WhatsApp-scoped. Unmade policy decision.
- `channelPermissionFact` must fail closed for unknown channels (accepted by orchestration), with permission facts added for each.
- Registration rules per market, such as sender registration. Not researched here; counsel.
- Kill switch, channel enablement, rate limit, credit cost and erasure mapping for each channel. `erasurePlan.ts:79` maps only `phone` and `whatsapp`.

## Migration implications

| Change | When | New table? |
|---|---|---|
| Widen `execution_engine_requests` engine CHECK | At scoping | No |
| Voice call disposition storage | At scoping, if the ledger is insufficient | Undecided; do not add ahead of need |
| Non-WS-3 outcomes (`outreach_outcomes.task_id` NOT NULL) | Needed regardless of these channels | Orchestration's recorded gap |

Fixes needed before either channel, also regardless: `sms` targets are stored casefolded in `contactGovernanceRepository.ts:58` and would not match a `phone` form. `voice_per_minute` credit already means voice interaction, so it needs a different name. Authoring and governance say `phone` while the capability model says `voice`: the declarations above use engine `voice` on channel `phone`.

## The 15 requirements against contract v0.1

| # | Requirement | Status |
|---|---|---|
| 1 | Registration and capability discovery | Met by `buildAdapterRegistry` + declarations; no runtime discovery call yet |
| 2 | Engine, provider, action separate | **Met**, tested |
| 3 | Several providers per engine | **Met** in declaration, tested. No selection logic exists |
| 4 | Provider adapters behind a normal interface | Met at engine level; no provider-level interface |
| 5 | Declarations and negotiation | Declarations met. **Negotiation missing**: `checkCapabilityDeclaration` is a static check |
| 6 | Availability, configuration, health | **Missing from the contract.** `providerCapabilityModel` is the existing candidate |
| 7 | Normalized states and events | **Met**, tested. Events are a read-only view |
| 8 | Per-channel consent, suppression, authorization | Partly: suppression via `contact_governance_records`; no consent store |
| 9 | Tenant provider config and credentials | Declared; `integration_credentials` exists; no outreach consumer |
| 10 | Quotas, usage, credits, rate limits | Partly: `ExecutionUsage` reports only; WS-3 quota only; nothing charges |
| 11 | Idempotency, retries, timeouts, recovery | **Met** by the contract rules, tested; per-engine timeouts vary |
| 12 | Webhook verification, normalization | By pattern per route; no shared helper |
| 13 | Analytics and attribution | **Gap:** non-WS-3 outcomes have no store |
| 14 | Independent kill switches, tenant and platform | Exist per channel and globally; no per-engine platform switch in the contract |
| 15 | No competing systems | **Met**: this round added no registry, workflow, prospect store or event system |

So the foundation is proven for 2, 3, 7, 11 and 15. Items 5, 6, 12, 13 and 14 are real remaining contract work, sent to the orchestration owner, and 8 and 10 depend on owner decisions.
