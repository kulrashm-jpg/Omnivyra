# PB-002 — Perplexity Metadata Adoption

**Program:** Program B — Egress Product Adoption · **Work Package:** PB-002 · **Agent:** 2 (Product Adoption).
**Authority:** PMO-002 (Active Governance Baseline). **Zone:** A2 (Intelligence & Egress) — product only.
**Builds on:** PB-001 (canonical provider-metadata contract, Zone P). **Status:** implementation complete, awaiting PMO certification. **Date:** 2026-07-21.

> First controlled product adoption of the PB-001 provider-metadata contract: the Perplexity
> visibility adapter now recovers provider-native `citations[]` on the gateway transport, restoring
> the "Sources: …" answer appendix — with zero Platform change and no other provider affected.

---

## 1. Executive summary

PB-001 made Perplexity's grounded `citations[]` *survive* gateway normalization (attached to
`NormalizedCompletion.providerMetadata`) but **nothing consumed them** — so the PA-006 gateway path
still dropped citations (a documented parity gap). PB-002 makes the Perplexity adapter the **first
consumer**: `reshapeCompletionToPerplexityResponse` reads the metadata via the published PB-001 API
(`getProviderMetadata`) and restores `citations[]`, which the existing `extractAnswer` renders as
`Sources: …`. Legacy transport is untouched and byte-identical; the gateway transport now matches it.

## 2. Files modified

| File | Change |
|---|---|
| `backend/services/intelligence/adapters/perplexityAdapter.ts` | Consume PB-001 metadata (`getProviderMetadata` + versioned envelope); new pure `extractPerplexityCitations`; restore `citations[]` in `reshapeCompletionToPerplexityResponse`; refresh stale comments |
| `backend/tests/unit/perplexityAdapterGatewayAdoption.test.ts` | +10 tests (metadata present/absent, version-safety, provider isolation, citation rendering both transports, parity, retry/unavailable); reframe the metadata-absent reshape case |
| `docs/pmo/PB-002-perplexity-metadata-adoption.md` | This product doc |

**No Platform file modified.** `aiGatewayCore.ts` / `aiGatewayTransports.ts` / dispatcher are only
*imported from* (the PB-001 published API) — never edited.

## 3. Product changes

- **Metadata consumption.** `extractPerplexityCitations(completion)` reads
  `getProviderMetadata(completion, 'perplexity')`, branches on the envelope `version`
  (`PERPLEXITY_METADATA_VERSION`), validates the `PerplexityCompletionMetadataV1` payload shape, and
  returns a string-filtered `citations[]`. It never touches transport internals — only the contract.
- **Citation restoration.** When citations are present, the reshaped Perplexity-shaped response now
  carries them, so `extractAnswer` appends `\nSources: <url>, <url>` exactly as the legacy path does.
- **Byte-identical fallback.** When no Perplexity metadata is present, the `citations` key is
  **omitted** (not set to `[]`), leaving the reshaped object and the produced answer byte-identical to
  the pre-PB-002 gateway behavior.

## 4. Compatibility assessment

| Path | Behavior | Change |
|---|---|---|
| **Legacy transport** (flag OFF, default) | raw Perplexity JSON → `extractAnswer` appends Sources | **none** (untouched) |
| **Gateway transport** (flag ON) + citations | metadata → `citations[]` → Sources appended | **restored** (was dropped) |
| **Gateway transport** (flag ON) + no citations | reshaped `{choices, usage, model}`, no `citations` key | **byte-identical** |
| Other providers (OpenAI/Anthropic/Gemini/Copilot) | — | **untouched** |

The `PERPLEXITY_ADAPTER_GATEWAY_TRANSPORT` flag is unchanged (no new flag). It is now purely a
transport choice — it no longer affects whether citations appear. Version-safety: an envelope with an
unknown `version` is ignored (degrades to no-citations, never throws). Provider isolation holds — the
adapter only ever reads the `'perplexity'` slot.

## 5. Tests added

10 new cases (16 total in the suite; regression green): metadata present → citations restored;
metadata absent → key omitted; non-string filtering; unknown-version ignored; provider isolation;
gateway path renders `Sources: …`; legacy path still renders it; **gateway == legacy cited answer**
(parity restored); gateway failure → unavailable (retry-seam error path); no API key → unavailable.
PB-001 contract suite (`gatewayProviderMetadata.test.ts`) re-run: still green.

## 6. Risks

| Risk | Level | Note |
|---|---|---|
| Behavior change on legacy path | None | legacy path not touched; test-pinned byte-identical |
| Unexpected metadata shape | Low | defensive: version-branch + string filter; bad data → `[]`, never throws |
| Enabling the flag in prod | Low | now safe re: citations (the original blocker is closed); still a transport-rollout decision |
| Cross-provider leakage | None | provider-scoped read; isolation test-pinned |

## 7. Repository validation

- [x] Platform untouched (no edit to `aiGatewayCore`/`aiGatewayTransports`/dispatcher)
- [x] No gateway / dispatcher / contract / schema changes
- [x] No feature flags added (existing flag reused, semantics narrowed to transport-only)
- [x] No other providers affected (only `perplexityAdapter.ts`)
- [x] Legacy output preserved (byte-identical); gateway output restored (citations)
- [x] Baseline TypeScript clean in touched files; regression suite green (27/27 across PB-001+PB-002)

## 8. Final certification

**PB-002 COMPLETE — PERPLEXITY METADATA ADOPTION CERTIFIED.**

Perplexity citations are restored through the canonical PB-001 metadata contract; the adapter depends
only on the published Platform API; legacy and gateway paths are both correct; no Platform code and no
other provider changed.
