# Common Contract Substrate (AI-CONTRACT-000)

The shared vocabulary every AI contract is built from. Defined once here; referenced (never re-defined) by every subsystem contract. This is what guarantees cross-contract consistency: one envelope, one identifier set, one error model, one lifecycle, one versioning policy. Notation is conceptual/implementation-agnostic (TypeScript-shaped for clarity, binding as a contract, not as code).

## S1. Request Envelope (universal)

Every AI call carries one envelope. No subsystem accepts a request without it.

```
RequestEnvelope {
  requestId:     UUID          // unique per call
  correlationId: UUID          // stable across the whole lifecycle (§S4) and all subsystems
  traceId:       UUID          // persisted with any produced artifact (Observability contract)
  tenant:        TenantScope   // §S2 — required, non-null
  actor:         Actor         // who/what initiated
  operation:     OperationId   // stable label (e.g. 'writer.post', 'campaign.plan', 'engagement.reply')
  issuedAt:      Timestamp     // ISO-8601, UTC
  flags?:        FlagContext   // rollout/feature-flag resolution snapshot (Extension contract)
}
```

## S2. Tenant Scope (isolation by design)

```
TenantScope { orgId: UUID; companyId: UUID | null }
```
- **Invariant:** every request, cache key, memory read, and persisted row is scoped by `orgId` (and `companyId` where content-bound). No cross-tenant read or reuse is ever valid. A missing tenant is a `TENANT_REQUIRED` error, never a default.

## S3. Actor

```
Actor { kind: 'user' | 'system' | 'worker' | 'cron'; userId?: UUID; isAdmin?: boolean }
```

## S4. Lifecycle States (shared)

The one ordered content-lifecycle every contract reports against:

```
requested → context_assembled → grounded → prompt_assembled → safety_pregen_passed
→ generated → validated → originality_checked → safety_postgen_passed → persisted → observed
Terminal-fail branches: blocked (safety/originality) · rejected (validation) · failed (transport/timeout)
```
Non-content subsystems (Market/Analytics/Engagement) map onto the subset they use; every subsystem reports its terminal state to Observability.

## S5. Provenance (shared, for any AI-derived assertion)

```
Provenance {
  sourceType: 'deterministic' | 'retrieval_backed' | 'ai_inference' | 'speculative'
  sources:    Citation[]        // real, resolvable; may be empty ONLY for 'deterministic'
  confidence: Confidence        // §S6
  producedBy: OperationId
  producedAt: Timestamp         // EVENT time where applicable, not run time
  deterministic: boolean
}
Citation { url?: URL; ref?: string; retrievedAt?: Timestamp; credibility?: 0..100 }
```
- **Invariant (fabrication policy):** a non-`deterministic` assertion presented as evidence MUST carry ≥1 real `Citation`. `speculative` output is labeled and never trust-scored as evidence.

## S6. Confidence

```
Confidence { value: 0.0..1.0; basis: 'measured' | 'inferred' | 'default'; sampleSize?: int }
```
Confidence never silently defaults to a "moderate" number; absence is `basis:'default'` and surfaced.

## S7. Unified Error (the one error model — full spec in PLATFORM-CONTRACTS §Error)

```
AiError {
  code:       ErrorCode        // stable, namespaced (e.g. 'GATEWAY_TIMEOUT', 'GROUNDING_MISSING_PROFILE')
  category:   'transport' | 'validation' | 'grounding' | 'originality' | 'safety' | 'billing' | 'tenant' | 'internal'
  severity:   'info' | 'warn' | 'error' | 'critical'
  retryable:  boolean
  httpStatus: int
  userMessage: string          // safe to surface; no internals/PII
  devDetail?:  string          // diagnostics; never surfaced to end users
  cause?:      AiError          // chain
  correlationId: UUID
}
```

## S8. Contract Version

```
ContractVersion = "MAJOR.MINOR.PATCH"   // semver; every contract is versioned from day one (§S9 policy in Versioning contract)
```
Every request/response may carry `contractVersion`; a subsystem rejects an incompatible MAJOR with `CONTRACT_INCOMPATIBLE`.

## S9. Result wrapper (uniform outcome shape)

```
Result<T> =
  | { ok: true;  value: T;  usage: UsageRecord;  provenance?: Provenance;  lifecycle: LifecycleState }
  | { ok: false; error: AiError;                usage?: UsageRecord;       lifecycle: LifecycleState }
```
`UsageRecord` is the Observability/Billing shared unit (PLATFORM-CONTRACTS). Every subsystem returns `Result<T>`; no subsystem throws across its contract boundary — failures are typed values.

## Design principles (bind every contract)

Single Responsibility · Explicit Inputs/Outputs · Deterministic Where Applicable · Strong Typing (conceptual) · Backward-Compatible Evolution · Observable by Default · Secure by Default · Tenant Isolation by Design · Fail-Safe Defaults · No Hidden Side Effects · No Duplicate Interfaces · Versioned from Day One · Implementation-Agnostic.
