# CUSTOMER_DATA_FOUNDATION_AUDIT.md

Phase 15E · Phase 1 — every customer-facing data source. **Audit only.** Classifications:
**TRUSTED** (joinable, fresh, high-confidence, customer-clean) · **PARTIAL** (usable with
caveats) · **UNTRUSTED** (contaminated / not joinable) · **UNKNOWN** (no measurable data).

| Source | Joinability | Freshness | Confidence | Coverage | Contamination | Class |
|---|---|---|---|---|---|---|
| signup | NO (`supabase_uid` empty) | live | MED | 24 intents | high (unjoinable) | **UNTRUSTED** |
| onboarding | partial | live | MED | partial | mid-funnel dark | **PARTIAL** |
| profile | YES (company_id) | live | HIGH | 29/38 | low | **TRUSTED** |
| identity | YES | live | HIGH | 38/38 | low | **TRUSTED** |
| domains | YES | live | HIGH | 1 verified | low | **PARTIAL** (coverage) |
| GA / GSC | YES | live | MED (presence) | 0 connected | low | **PARTIAL** |
| social | YES | live | MED | 2 | low | **PARTIAL** |
| billing | YES (flag only) | live | MED | 28 flag | high (incl. test) | **PARTIAL** |
| **revenue** | partial (canonical only) | live | HIGH (recorded) | **1/38, TEST** | **high** | **UNTRUSTED** |
| content | YES | live | HIGH | 3 companies | vendor-dominated | **PARTIAL** |
| campaigns | YES | live | HIGH | 3 | vendor-dominated | **PARTIAL** |
| publishing | YES | live | HIGH | 1 | vendor-dominated | **PARTIAL** |
| **engagement** | NO (organization_id) | live | — | org-keyed | — | **UNKNOWN** |
| **community** | NO (organization_id) | live | — | org-keyed | — | **UNKNOWN** |
| support | — | — | — | no source found | — | **UNKNOWN** |
| team | YES | live | HIGH | 31 | low | **TRUSTED** |
| activity | YES (30d proxy) | live | MED | sign-in proxy | low | **PARTIAL** |
| adoption | YES | live | MED | low | low | **PARTIAL** |
| value | YES | live | HIGH | 4/38 | vendor-dominated | **PARTIAL** |
| monetization | partial | live | — | revenue UNKNOWN | high | **UNKNOWN** |

## Findings

- **TRUSTED:** profile, identity, team — company-joinable, fresh, low contamination.
- **UNTRUSTED:** signup (unjoinable), revenue (only a TEST org has records).
- **UNKNOWN:** engagement, community, support, monetization — no company-attributable data.
- **The dominant problem is contamination**, not observability: most sources are technically
  joinable and fresh, but the *population* feeding them is 87% non-customer (14I).
