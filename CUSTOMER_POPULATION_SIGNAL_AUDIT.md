# CUSTOMER_POPULATION_SIGNAL_AUDIT.md

Phase 14I · Phase 1 — signals that may identify tenant type. **Audit only.** No assumptions.

| Signal | Source | Evidence strength | Confidence | False-positive risk | False-negative risk | Usable? |
|---|---|---|---|---|---|---|
| Company name "QA" + suffix | `companies.name` | STRONG (explicit QA marker) | HIGH | Low (a real "Quality Assurance Co" could collide) | Low | **YES** |
| Company name "Test" / "Wrong Tenant" | `companies.name` | STRONG | HIGH | Low | Medium (test tenants without the word) | **YES** |
| Company name "Demo" | `companies.name` | STRONG | HIGH | Low | Medium | **YES** |
| Placeholder domain (`example.com`, `python.org`) | `companies.website_domain` / `admin_email_domain` | STRONG (clearly non-real) | HIGH | Very low | Medium | **YES** |
| Vendor domain (`omnivyra.com`) | website/admin email domain | STRONG (vendor-owned) | HIGH | Low | Low | **YES** |
| Real registrable domain + matching admin email | `companies` | MODERATE (real-looking, but unverified) | MEDIUM | Medium (anyone can enter a domain) | Low | **YES** (CUSTOMER, MEDIUM) |
| Domain verification | `company_domains.verification_status` | STRONG (proves ownership) | HIGH | Very low | High (only 1 tenant verified) | **YES** (raises CUSTOMER/INTERNAL to HIGH) |
| `created_via` / source | `companies` | — | — | — | — | **NO** (column sparse/empty) |
| Activity volume | content/campaign tables | WEAK (vendor also generates volume) | LOW | High | High | **NO** (volume ≠ customer) |
| `signup_intents` / `signup_referrals` | onboarding | WEAK (unjoinable, per 14A) | LOW | — | — | **NO** |
| `organization_plan_assignments` | billing | — | — | — | — | **NO** (empty) |

## Findings (evidence, no assumptions)

- The **reliable classifiers are name patterns + domain type + verification** — all explicit
  and deterministic (no fuzzy/AI matching needed).
- **Activity/billing are NOT usable** for tenant typing: the vendor and QA tenants generate
  most activity and "pay", so volume/billing would misclassify them as customers.
- `created_via` and plan-assignment are absent → not usable.
