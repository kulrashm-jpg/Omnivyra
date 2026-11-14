# S2 tenant seam: deferred sites

Tier 2 (sensitive reads) is **not** complete for the paths below. Each row says why it stays raw and what unblocks it. Remove a row in the same commit that converts the site.

| Path | Tier | Why raw | Unblocker |
|---|---|---|---|
| `pages/api/campaigns/list.ts` | 2 | SEC91 A8: `campaign_versions` owns divergent campaigns; `campaign_company_scope_fix` pins "never filter campaigns by company_id". The ids already come from the authorized company's versions. | Versions-derived owner helper in the seam |
| `pages/api/campaigns/[id]/continuity.ts` | 2 | Conversion moved ownership to `campaigns.company_id`; reverted by 05 ruling (b), 2026-11-14 (0788d83be). Keeps the old failure behaviour (no 503/404 split). | Same helper |
| `pages/api/campaigns/[id]/engagement-health.ts` | 2 | Same as above | Same helper |
| `pages/api/campaigns/[id]/health.ts` | 2 | Same as above | Same helper |
| `pages/api/campaigns/[id]/strategic-insights.ts` | 2 | Same as above | Same helper |

**Preferred unblocker (05, 2026-11-14):** a versions-derived owner helper. It keeps A8 and still gives these routes the seam. The alternative, amending A8 with a divergence check, gives up the invariant and only detects a divergence after it has happened. e9 to rule.

**Known seam gap:** `resolveTenantOfRow` returns null on a FAILED read, so a job silently skips the row. Proposal: throw retryable. Awaiting e9.

Per-site reasons for the other raw tier-2 route sites (campaigns 15, other routes 20) are in the S2 tier-2 work lists. They are pre-authorization bootstrap reads, whose 503/500 split the owner lookups would collapse.
