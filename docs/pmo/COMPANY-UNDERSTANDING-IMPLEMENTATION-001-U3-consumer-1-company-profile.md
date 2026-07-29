# COMPANY-UNDERSTANDING-IMPLEMENTATION-001 · Phase U3 · Consumer 1 — Company Profile

**Status:** ✅ **READY FOR NEXT CONSUMER**
**Mode:** flag-dark · `COMPANY_UNDERSTANDING_AUTHORITATIVE` default **OFF** · reversible
**Date:** 2026-07-28 · Predecessors: U-1 ✅ U0 ✅ U1 ✅ U2 ✅

---

## 1. Executive Summary

Migrated **Consumer 1 (Company Profile)** to obtain its `category` company-identity through the canonical
projection seam `resolveCompanyProjection` instead of reading the raw stored field directly. The consumer
**consumes** — it never classifies, infers, reinterprets, or reconstructs identity. The wiring is at the
**isolated display boundary** (the Company Profile GET API response), not the shared `getProfile` (which
serves the whole generation pipeline) — preserving consumer isolation. Flag **OFF** (production default)
⇒ the adoption returns the **same record reference, byte-identical** response. Flag **ON** ⇒ projected
category. **12/12 tests pass; tsc 0 errors.**

## 2. Inventory Report

Identity is **derived at write time** (`classifyCompanyBusiness` / `inferEntityArchetype` /
`inferCompanyDomainShape`) and **stored** on the `company_profiles` row; reads return it verbatim. Display
reads (per inventory): `category` (`CompanyProfileFormSectionsA.tsx:497`), business-model
(`business_classification.level_1`), products (`products_services`), competitors
(`CompanyProfileFormSectionsB.tsx:232`), name, `website_url`.

- **Consumer boundary (isolated):** `pages/api/company-profile/index.ts` — GET response assembly
  (`responseProfile` → `response.profile`, ~line 313). This serves only the Company Profile UI.
- **NOT chosen:** `getProfile` (`companyProfileServiceRest1Rest2Pulse.ts:719`) — shared by the generation
  pipeline; wiring there would migrate every identity consumer at once (violates one-at-a-time / isolation).
- **Classifiers (T1/T2/T3):** untouched — retirement is U5, explicitly out of scope here.

Fields with a clean top-level mapping and adopted now: **category**. Deferred (adopt-not-redesign):
`business_classification` decomposition (nested level_1/2/3), `products_services` (string vs `products[]`),
competitors (own dedicated read-time pipeline `revalidateStoredCompetitors…` + `scrubCompetitorDetails`).
`name`/`domain`/`products` are parity — the projection returns them unchanged, so no direct read needed to
be rerouted for behavior (they already equal the flag-OFF projection output).

## 3. Files Modified

| File | Type | Change |
|---|---|---|
| `backend/services/companyIntelligence/adoption/consumers/companyProfileConsumer.ts` | NEW | `readCompanyProfileIdentity` (identity view via seam), `companyProfileRecordToInput` (pure mapper), `adoptCompanyProfileIdentity` (flag-gated overlay; OFF ⇒ same reference) |
| `backend/tests/unit/companyProfileConsumer.test.ts` | NEW | 12 tests (9 required types + 3 record-adoption) |
| `pages/api/company-profile/index.ts` | MODIFIED | import + 1 line: `responseProfile → adoptCompanyProfileIdentity(...)` before `response.profile` (flag-gated no-op) |

No classifier, projection primitive, evidence resolution, facet population, or flag default changed.

## 4. Projection Integration

The consumer reads identity through `resolveCompanyProjection` only:
- `readCompanyProfileIdentity(input)` → `{name,domain,category,businessModel,products,services,competitors,confidence, projectionSource, projectionVersion, observation}`.
- `adoptCompanyProfileIdentity(record)` overlays `category` from the projection; flag OFF ⇒ untouched record.
- Explainability preserved: `observation.deltas` carries per-field Projection → Facet → Evidence →
  Resolution → Value; `observation.version` is the versioned contract.

## 5. Tests Added (9 required types · all pass)

Inventory · Projection Integration · Output Parity (OFF byte-identical) · Approved Improvement (category →
approved_improvement) · Unexpected Regression (parity-locked divergence ⇒ `legacy_fallback`) · Rollback
(ON→OFF identical) · Performance (1000 reads, deterministic) · Explainability (deltas + version) · Consumer
Isolation (no raw facets/evidence exposed, input never mutated). Plus record-adoption: mapper, OFF ⇒ same
reference, ON ⇒ overlay preserves non-identity fields. **12/12.** Regression: U1 (13) + U2 (13) re-green.

## 6. Performance

Pure, in-memory, no network / AI / evidence fetch / classification during read. 1000 reads well under the
2 s bound; deterministic. Flag OFF is a single comparison + early return (same reference) — zero added cost
on the production path.

## 7. Rollback

`COMPANY_UNDERSTANDING_AUTHORITATIVE` OFF (default) ⇒ `adoptCompanyProfileIdentity` returns the **same
record reference**; the API response is byte-identical to pre-U3. Test asserts OFF ⇒ `=== record` and
ON→OFF restores an identical view. **O(1)** — one env var, no deploy.

## 8. Risk Assessment

| Risk | Mitigation | Residual |
|---|---|---|
| Behavior change on production | Flag OFF ⇒ same-reference no-op; asserted | None |
| Over-broad migration (other consumers) | Wired at the display API only, not shared `getProfile` | None |
| Lossy identity remap | Only `category` (clean top-level); nested/list fields deferred | None |
| Category changes unexpectedly when ON w/o evidence | ON w/o evidence ⇒ `canonical_profile` = stored category (unchanged); correction needs evidence (future) | None |
| tsc break in large API file | Generic overlay compiles against any record; tsc 0 | None |

## 9. Certification Checklist

| Criterion | Status |
|---|---|
| Consumer consumes; never classifies/infers/reinterprets/overrides/reconstructs | ✅ |
| Identity read routed through `resolveCompanyProjection` | ✅ |
| No direct raw-evidence / legacy-classifier access in the consumer | ✅ |
| Flag OFF byte-identical (same reference) | ✅ |
| Approved semantic improvement (category) passes; unexpected regression fails safe | ✅ |
| Explainability preserved (observation deltas + version) | ✅ |
| No network/AI/evidence-fetch/classification during read | ✅ |
| Consumer isolation (display API only; shared `getProfile` untouched) | ✅ |
| Rollback O(1) verified | ✅ |
| Tests pass (12/12); regression green; tsc 0 | ✅ |
| Classifiers NOT retired; no default enabled | ✅ |

## 10. Recommendation

Consumer 1 (Company Profile) is adopted at its isolated display boundary, reversible in O(1), with
explainability and the fail-safe intact. Proceed to **Consumer 2 (Content Architect)** — do not batch;
implement, test, and certify it individually next.

# READY FOR NEXT CONSUMER

*No Consumer-2 work has begun; awaiting authorization to proceed (per one-consumer-at-a-time discipline).*
