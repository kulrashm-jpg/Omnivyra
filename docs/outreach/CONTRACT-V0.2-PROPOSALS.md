# Contract v0.2 proposals from Outreach

For the orchestration owner, who holds the contract and decides. Nothing here is built. Facts come from `inventory/foundations.md`, by reading code at dc7f2ae3.

## 1. Provider availability, configuration and health

**Proposal: no new registry and no new table.** Add outreach providers to the existing `providerCapabilityModel` as `engagement` entries, and have the contract's `ProviderDeclaration` refer to them by id.

Why this model: it already keeps four independent layers (provider identity, capability, tenant configuration, runtime verification), it enforces that "credentialed" never implies "executable", and it declares an `engagement` kind that no provider uses yet. Its header draws the line against `PROVIDER_CATALOG` (spend), `platform_registry` (social capabilities) and `transportRegistry` (dispatch), so those stay as they are.

| Question | Answered by | State today |
|---|---|---|
| Does the provider exist, and what does it claim? | Layer A | SES and Meta are absent |
| Is it built, is there a working call path? | Layer B | To declare from code evidence, never computed |
| Can a tenant configure it? | Layer C static | `integration_credentials` for API keys; WhatsApp uses `social_accounts`; SES is platform-wide |
| Does this tenant have it configured? | Tenant state, never stored in the model | New read per provider kind, using `connectionState` for OAuth connections |
| Has a real execution been observed? | Layer D `OPERATIONAL_VERIFICATIONS` | Empty for every external provider. This must stay in step with the contract's `verification` value |
| Is it healthy right now? | **Gap.** `providerHealthService` covers data providers; nothing covers SES or WhatsApp phone quality | Do not model until a real signal exists |

Contract change, additive:

```ts
interface ProviderDeclaration {
  readonly provider: string;      // must be a key of PROVIDER_CAPABILITIES once entered
  readonly credentials: 'tenant' | 'platform' | 'none';
  readonly verification: VerificationLevel;
}

// A read, not a stored field. An engine or the central gate asks it before acting.
type ProviderAvailability =
  | { available: true }
  | { available: false; reason: 'not_implemented' | 'not_executable' | 'not_configured' | 'blocked' | 'unknown' };
```

An unreadable answer is `unknown` and holds the step, as with other gates. Refusals map to the existing `not_configured` error class, so no new class is needed.

Needs PI's agreement, since the model is PI-owned (Integration Hub). Finding F-8 already lists this as a joint change.

## 2. Webhook verification and event normalization

**Proposal: a written contract and a shared test kit, not a shared framework.** Verification differs by provider and needs raw bytes, and the two outreach routes already work. A common wrapper would add risk to working code.

Every inbound provider webhook must, in this order:

1. **Read raw bytes**, with body parsing off.
2. **Verify authenticity** before any parse-dependent work or write, and refuse with no side effect. No bypass flag and no fail-open when the secret is missing.
3. **Check freshness or scope** where the provider supports it (SNS timestamp and topic allow-list).
4. **Make it durable before acknowledging.** Answer 2xx only once the event is recorded or queued, otherwise 5xx so the provider redelivers. This is why WA-5 was changed.
5. **Deduplicate on the provider's event id or a body hash.** Redelivery takes effect once per event.
6. **Normalize** to `{ provider, providerEventId, kind, occurredAt, target, providerMessageId }`, with `kind` mapping onto contract event types. Provider words stay as metadata.
7. **Apply eligibility first.** STOP, unsubscribe, hard bounce and complaint write `contact_governance_records` before anything else, and a failure there must not be swallowed.
8. **Never classify** STOP, unsubscribe, bounce or complaint as positive engagement.

| Route | 1-3 | 4 | 5 | 6 | 7-8 |
|---|---|---|---|---|---|
| SES `pages/api/webhooks/ses.ts` | Yes (`verifySnsSignature`) | To check | Yes, provider event id | Yes (`sesEventNormalizer`) | Yes |
| WhatsApp `pages/api/whatsapp/webhook/index.ts` | Yes (local `verifySignature`) | Yes on this branch (WA-5) | Yes, `sha256(body)` job id | In the processor; no shared shape | Yes on this branch |

The contract test kit, one suite per route, asserts: a bad signature has no side effect; a missing secret refuses; a redelivery takes effect once; enqueue failure is not acknowledged; STOP-class events update eligibility and are not positive.

**Do not swap** WhatsApp to `webhookSecurityService` without checking bytes: it takes a string, and WhatsApp signs raw bytes. The conversion is unverified.

## Your items, for reference

- Capability negotiation: yours. A suggestion: `negotiate(declaration, { action, channel, needsDelivery?, needsResponses? })` returning the matching action or a refusal code, plus provider availability above.
- Per-engine platform kill switch: yours. `PROVIDER_KILL_<ID>` exists at provider level and `LEAD_OUTREACH_EXECUTION_DISABLED` at platform level, so check for overlap first.
