# DOMAIN_VALIDATION_CACHE_AUDIT.md

Phase 11D · Phase 1 — call-graph + existing-cache audit for company-identity
domain validation.

## validateCompanyIdentity call graph

```
pages/api/auth/signup.ts §4.5  (the ONLY production caller)
  └─ validateCompanyIdentity(normalizedEmail, { lookupClaimedCompany: () => null })
       ├─ checkEligibility   → checkDomainEligibility()   [domainEligibilityService]
       ├─ lookupClaimedCompany (DISABLED at signup; §4 handles claimed separately)
       └─ probeWebsite       → resolveDomain()            [domainCanonicalService]  ← EXPENSIVE
```

- Sole production caller: `pages/api/auth/signup.ts:244`. (All other references are tests.)
- At signup, rule-5 (`lookupClaimedCompany`) is disabled — the claimed-domain block is
  handled earlier in signup §4 against a fresh `companies` query.

## resolveDomain call graph

- `resolveDomain` (`backend/services/domainCanonicalService.ts:416`) is the SSRF-hardened
  DNS + HTTPS/HTTP probe. **Only production caller:** `companyIdentityValidationService.ts:150`
  (as `probeWebsite`). (`setup-company` removed its call in Phase 8 — comment only.
  `pages/api/reports/automation-config.ts` has an unrelated local `resolveDomain` that
  reads a DB column, not the canonical resolver.)

So the entire production probe cost flows through one edge: signup → validateCompanyIdentity → resolveDomain.

## Existing cache layers

| Layer | Scope | Storage | TTL | Covers the probe? |
|---|---|---|---|---|
| `domain_eligibility_cache` | eligibility stage (`checkDomainEligibility`) — personal/MX/disposable/blocked/forwarding-MX | **DB table** | 24h | No |
| (none) | `resolveDomain` website/canonical/forwarding probe | — | — | **No cache** |
| (none) | `validateCompanyIdentity` full verdict | — | — | **No cache** |

**Gap:** the eligibility stage is cached (24h, DB), but the **expensive `resolveDomain`
probe and the overall verdict are not cached at all** — every signup for an
already-validated domain (`omnivyra.com`, `afrost.org`, `infitoo.com`, `drishiq.com`,
`embrosales.in`, …) re-runs DNS + HTTP probing.

## Conclusion

A success-only verdict cache keyed by normalized domain, sitting inside
`validateCompanyIdentity`, eliminates the redundant `resolveDomain` probe for recently
validated domains. It must keep the **claimed-domain check live on every hit** (DB state)
and must **never cache failures/timeouts/DNS errors/review-required** outcomes. Designed
and implemented in Phases 2–4 (`companyIdentityValidationCache.ts`).
