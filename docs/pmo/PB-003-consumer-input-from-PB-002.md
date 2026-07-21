# PB-003 — Consumer-side input from PB-002 (Agent 2 → Agent 1)

**From:** Agent 2 (Intelligence & Egress) · **To:** Agent 1 (Platform/Core), PB-003 · **Date:** 2026-07-21.
**Status:** advisory input only — **no Platform code written by Agent 2**. PB-003 remains Agent 1's package.

> PB-002 is currently the **only** consumer of the PB-001 metadata contract. This note records the
> friction that adoption actually hit, as evidence for what PB-003 should generalize. Every claim below
> is grounded in shipped PB-002 code, not speculation.

---

## 1. Hard compatibility constraint (please don't break this)

`backend/services/intelligence/adapters/perplexityAdapter.ts` (Zone A2, live) now depends on:

- `NormalizedCompletion.providerMetadata`
- `getProviderMetadata(completion, 'perplexity')`
- `PERPLEXITY_METADATA_VERSION`
- type `PerplexityCompletionMetadataV1`

If PB-003 changes any of these shapes, it needs a coordinated A2 change — otherwise PB-002's citation
restoration silently regresses to no-citations (it degrades quietly by design, so **tests, not runtime
errors, are the only signal**). The PB-002 suite
(`backend/tests/unit/perplexityAdapterGatewayAdoption.test.ts`) pins this and should be run as part of
PB-003's regression gate.

## 2. The top generalization opportunity: typed, validated retrieval

`getProviderMetadata` returns `ProviderMetadataEnvelope` whose default `data` is
`Readonly<Record<string, unknown>>`. So **every consumer must hand-cast and hand-validate**. PB-002's
adopter code is, in full:

```ts
const envelope = getProviderMetadata(completion, 'perplexity');
if (!envelope || envelope.version !== PERPLEXITY_METADATA_VERSION) return [];
const data = envelope.data as Partial<PerplexityCompletionMetadataV1>;   // ← cast forced on consumer
const citations = data?.citations;
return Array.isArray(citations) ? citations.filter((c): c is string => typeof c === 'string') : [];
```

Those five lines are **provider-agnostic boilerplate** every future adopter will re-implement:
null-check → version-branch → cast → shape-validate. A typed, version-checked accessor in the
framework would remove all of it.

## 3. Read/write validation is duplicated today

The same string-filtering logic exists on **both** sides:

- write side — `aiGatewayTransports.callPerplexity` filters `citations` before attaching;
- read side — PB-002's `extractPerplexityCitations` filters again (it cannot trust the type).

One registered validator per (provider, kind, version) would let both sides share it, and would make
"is this payload actually valid?" a framework answer rather than a per-consumer guess.

## 4. Design question PB-003 should settle: provider-scoped vs kind-scoped envelopes

Today the map is keyed by **provider**, with one `data` blob and one `version` per provider. The
capabilities PB-003 names (citations, grounding evidence, reasoning summaries, safety annotations,
search provenance, confidence, diagnostics) are **multiple kinds from the same provider**. Under the
current shape:

- a provider emitting citations *and* safety annotations must merge them into one `data` blob, and
- bumping citations to v2 also bumps the version covering its safety payload (coarse versioning).

A `(provider, kind, version)` key would let kinds evolve independently while preserving the provider
isolation that already works well. This is the single biggest forward-looking decision, and it is
cheap to make now (one live consumer) versus later.

## 5. What already works — please preserve

- **Provider isolation** by provider-id keying. PB-002's isolation test passed trivially; reading
  `'perplexity'` can't surface another provider's slot. Keep this property.
- **The no-op guarantee.** `attachProviderMetadata` returning the input unchanged when given zero
  envelopes is exactly what let PB-002 *prove* byte-identical behavior when metadata is absent. Any
  generalization must keep "absent" meaning **no key at all** — not an empty envelope.
- **Deep-freeze immutability.** Never had to defensively copy.

## 6. Test-support ask

PB-002 hand-constructed envelope literals in tests (`{ provider, version, data }`). A small
Platform-provided test helper for building/attaching envelopes would keep future adapter suites from
depending on the envelope's internal shape.

## 7. Suggested acceptance check for PB-003

Beyond the Platform suite: run the PB-002 adapter suite unchanged. If PB-003 is truly additive, all 16
PB-002 tests pass with **zero** adapter edits — that is the cleanest proof that "future providers adopt
without Platform redesign" and that existing adopters are unaffected.
