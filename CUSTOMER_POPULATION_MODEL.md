# CUSTOMER_POPULATION_MODEL.md

Phase 14I · Phase 2 — deterministic tenant-classification model. Evidence-required,
no fuzzy matching, no AI. UNKNOWN stays UNKNOWN.

## Tenant classes

CUSTOMER · INTERNAL · QA · TEST · DEMO · UNKNOWN.

## Evidence hierarchy (first match wins)

| # | Class | Rule (deterministic) | Evidence |
|---|---|---|---|
| 1 | **TEST** | name matches `\btest\b` or `\bwrong tenant\b`, OR website/admin-email domain is a placeholder (`example.com`, `python.org`, `test.com`, `localhost`, `invalid`) | name marker / placeholder domain |
| 2 | **QA** | name matches `\bqa\b` | "QA" in name |
| 3 | **DEMO** | name matches `\bdemo\b` | "demo" in name |
| 4 | **INTERNAL** | website/admin-email domain is the vendor (`omnivyra.com`) | vendor domain (+ verified) |
| 5 | **CUSTOMER** | a real registrable domain (not placeholder, not vendor) is present | real domain (+ email match / verification) |
| 6 | **UNKNOWN** | none of the above | no classifying signal |

## Tie-break rules

- **TEST > QA**: a placeholder domain (e.g. `wrong-….example.com`) classifies TEST even if the
  name also contains "QA" — the placeholder domain is the stronger non-customer signal.
- **QA/TEST/DEMO > INTERNAL**: a QA tenant on the vendor domain classifies QA (its *purpose*
  is QA), not INTERNAL — only a vendor-domain tenant with no QA/test/demo marker is INTERNAL.
- First-match order is fixed and total; every tenant resolves to exactly one class.

## Confidence model

| Confidence | When |
|---|---|
| HIGH | explicit name marker (TEST/QA/DEMO), placeholder domain, or verified vendor/customer domain |
| MEDIUM | unverified vendor domain; real customer domain with matching admin email |
| LOW | real customer domain but admin email does not match |
| UNKNOWN | no signal (UNKNOWN class) |

## Purity formula (exact, deterministic)

```
population_purity_score = (customer_companies / total_companies) × 100
```

Reported alongside per-class counts and ratios. UNKNOWN is tracked separately and never
assumed to be CUSTOMER.
