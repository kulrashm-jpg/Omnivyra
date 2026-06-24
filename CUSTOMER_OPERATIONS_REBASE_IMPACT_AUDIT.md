# CUSTOMER_OPERATIONS_REBASE_IMPACT_AUDIT.md

Phase 16B · Phase 1 — engines affected by the corrected truth **`organization_id == company_id`**
(16A). Each previously treated org-keyed data as "unjoinable/UNKNOWN"; the correction makes it
attributable.

| Engine | Affected by org=company? | What was wrong | Rebased effect |
|---|---|---|---|
| **14D Digital Adoption** | indirectly | adoption read company-keyed areas; unaffected directly | no change (areas already company-keyed) |
| **14E Value Realization** | **YES** | excluded engagement/community as "org-keyed UNKNOWN" | now attributable — but they are **100% INTERNAL (vendor)** → CUSTOMER value unchanged |
| **14F Value Drivers** | downstream of 14E | inherited 14E exclusion | unchanged for customers |
| **14G Campaign Execution** | **YES** | called engagement/community "org-keyed excluded"; reported 92% Omnivyra | confirmed: execution is **90.8% vendor, 6% customer** with proper attribution |
| **14H Monetization** | **YES** | "paying" flag only; revenue org-keyed unusable | revenue now attributable (org=company) → but customer revenue = 0 |
| **15D Revenue Intelligence** | **YES** | "companies has no organization_id → invoices/credit unattributable" | **WRONG** — org_id=company_id; invoices/credit ARE attributable (but all TEST) |
| **15E Data Foundation** | **YES** | joinability 63.6 (7/11); engagement/community UNKNOWN | joinability rebases to **90.9 (10/11)**; engagement/community attributable |
| **16A estimate** | self-correction | estimated remediated coverage ≈ 35 | **too optimistic** — newly-attributable data is vendor/test → CUSTOMER coverage ≈ 8 |

## Summary

The correction touches **14E, 14G, 14H, 15D, 15E** (and corrects 16A's coverage estimate).
The recurring error: org-keyed data was called *unjoinable/UNKNOWN* when `organization_id` is
simply `company_id`. Once attributed, the data is **near-100% vendor (engagement/community/
execution) or test (revenue)** — so customer conclusions are largely unchanged, but the
*reasons* were wrong.
