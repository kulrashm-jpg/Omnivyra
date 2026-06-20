# OMNIVYRA — CUSTOMER USAGE PROFILE & PLAN CAPACITY AUDIT

**Are the proposed plans (Free 300 / Starter 300 / Growth 700 / Business 1500) aligned with *realistic* customer behavior?**
Evaluates expected monthly usage — **not** power users, **not** theoretical maximums.

> ### Basis & honesty note
> - **Credit costs** use the evidence-derived catalog (`OMNIVYRA_ACTIVITY_CREDIT_CALIBRATION_AUDIT.md §J`): reply 1 · post 3 · thread 5 · story 8 · blog/article 12 · carousel/infographic 8 · image/banner 12 · market pulse 10 · snapshot 25 · growth-intel 15 · BOLT campaign **40** (plan 25 + ~5 items) · BOLT Creator **60** · Intelligent Mix **120** · Strategic **200** · active-leads **15/scan** · voice **2/min**.
> - **Usage profiles are reasoned estimates, not measured.** The live census found only **2 orgs with any real usage** (credit_usage_log 138 rows DB-wide), so no actual per-customer distribution exists yet. These segment profiles are calibrated to typical SaaS-marketing behavior; they must be re-validated against real cohort data post-launch. This caps confidence (see §J).

---

## SECTION A — CUSTOMER SEGMENTS
| # | Segment | Profile |
|---|---|---|
| 1 | **Solo Creator** | 1 user; personal brand / consultant / influencer / coach |
| 2 | **Small Business** | 1–2 marketing users; founder-led; limited time; AI to save time |
| 3 | **Growing Company** | 3–5 users; dedicated marketing owner; consistent strategy |
| 4 | **Established Company** | 5–10 users; dedicated team; multiple campaigns; active engagement |
| 5 | **Agency** | multiple clients; heavy content volume; high campaign frequency |

---

## SECTION B — MONTHLY USAGE PROFILE MATRIX (realistic, typical)
| Activity (credits ea.) | Solo | Small Biz | Growing | Established | Agency |
|---|---|---|---|---|---|
| Posts (3) | 10 | 14 | 24 | 40 | 80 |
| Threads (5) | 1 | 2 | 3 | 5 | 8 |
| Stories (8) | 1 | 1 | 2 | 3 | 5 |
| Blogs (12) | 1 | 1 | 3 | 6 | 12 |
| Articles (12) | 0 | 1 | 1 | 3 | 6 |
| Images (12) | 3 | 4 | 8 | 16 | 35 |
| Banners (12) | 0 | 1 | 1 | 3 | 6 |
| Carousels (8) | 1 | 2 | 3 | 6 | 12 |
| Infographics (8) | 0 | 1 | 2 | 3 | 6 |
| BOLT Campaigns (40) | 1 | 2 | 2 | 3 | 8 |
| BOLT Creator (60) | 0 | 0 | 0 | 2 | 4 |
| Intelligent Mix (120) | 0 | 0 | 0 (occasional) | 1 | 3 |
| Strategic (200) | 0 | 0 | 0 | 0 | 1 |
| Snapshot (25) | 0 | 1 | 1 | 2 | 6 |
| Growth Intel (15) | 0 | 0 | 1 | 1 | 3 |
| Market Pulse (10) | 1 | 1 | 2 | 3 | 8 |
| Reply generation (1) | 20 | 40 | 80 | 160 | 300 |
| Inbox/Triage | *(automation — subscription-covered)* | | | | |
| Active Leads scans (15) | 0 | 1 | 2 | 5 | 10 |
| Voice min (2/min) | 0 | 3 | 10 | 20 | 40 |

---

## SECTION C — CREDIT SIMULATION (monthly consumption)
| Profile | Content | Creator | Campaigns | Intelligence | Engagement | Leads | Voice | **Monthly Total** |
|---|---|---|---|---|---|---|---|---|
| **Solo Creator** | 55 | 44 | 40 | 10 | 20 | 0 | 0 | **~169** |
| **Small Business** | 90 | 72 | 80 | 35 | 40 | 15 | 6 | **~338** |
| **Growing Company** | 151 | 148 | 80 | 60 | 80 | 30 | 20 | **~569** |
| **Established Company** | 277 | 300 | 360 | 95 | 160 | 75 | 40 | **~1,307** |
| **Agency** | 536 | 636 | 920 | 275 | 300 | 150 | 80 | **~2,897** |

Realistic bands (light → active): Solo 120–230 · Small Biz 250–420 · Growing 430–700 · Established 1,000–1,650 · Agency 1,800–3,800.

---

## SECTION D — PLAN FIT ANALYSIS
| Customer Type | Best-fit Plan | Monthly Used | Headroom |
|---|---|---|---|
| Solo Creator | **Starter** (300) | ~169 | **131 (44%)** — comfortable |
| Small Business | **Growth** (700) *(Starter too small)* | ~338 | Growth: 362 (52%) ✓ · **Starter: −38 (over)** |
| Growing Company | **Growth** (700) | ~569 | **131 (19%)** — fits, modest slack |
| Established Company | **Business** (1500) | ~1,307 | **193 (13%)** — fits typical, tight |
| Agency | **Enterprise** *(Business insufficient)* | ~2,897 | **Business: −1,397 (over ~2×)** |

**Key structural finding:** the **Small Business segment falls in the gap** — too big for Starter 300 (~338 > 300) but comfortable on Growth 700. As proposed, founder-led small businesses (the nominal Starter target) actually need Growth.

---

## SECTION E — STARTER VALIDATION (2 users, 300 credits)
Stated target bundle: 1–2 BOLT campaigns + 2 blogs + supporting assets + engagement + market pulse.
| Item | Qty | Credits |
|---|---|---|
| BOLT Campaign | 2 | 80 |
| Blog | 2 | 24 |
| Supporting assets (2 img, 2 carousel, 1 banner, 1 info) | 6 | 60 |
| Engagement (replies) | 40 | 40 |
| Market Pulse | 1 | 10 |
| **Total** | | **214** |
**→ YES, the *minimal stated* bundle fits 300** (remaining 86, 71% used). **BUT** a *typical* active small business (§C) runs **~338 > 300 → NO.** Add a snapshot (25) + voice + more posts and it clears 300 fast.
**Credits actually required for a comfortable Starter (active 2-user founder team): ~450–500.**

---

## SECTION F — GROWTH VALIDATION (5 users, 700 credits)
Growing company typical **~569 (81% used)** → **YES, comfortable.** Small Business (~338) also fits here with wide headroom. Growth 700 is the **workhorse tier** and is correctly sized — only an unusually active growing team (with a monthly Intelligent Mix, ~690+) approaches the ceiling.
**Credits required: 700 is right; 700–900 ideal for headroom.**

---

## SECTION G — BUSINESS VALIDATION (10 users, 1500 credits)
Established company typical **~1,307 (87% used)** → **YES for typical**, but the band tops out at ~1,650 (active established with 2 Mix campaigns + more creator volume) which **overflows 1500.** A 5–10-user team running multiple campaigns + active engagement + leads consumes most of 1500 on a normal month, leaving little for spikes.
**Credits required for comfortable Business: ~2,000.**

---

## SECTION H — TOP-UP LIKELIHOOD
| Profile | Top-Up Probability | Why |
|---|---|---|
| Solo Creator | **Rare** | 44% headroom on Starter |
| Small Business | **Frequent (on Starter 300) / Occasional (on Growth)** | sits right at/over the Starter ceiling |
| Growing Company | **Occasional** | fits Growth; spikes occasionally |
| Established Company | **Frequent** | 1500 is tight at the active end |
| Agency | **Very Frequent** | Business covers ~half their need → constant top-ups (or Enterprise) |

---

## SECTION I — COMMERCIAL RECOMMENDATION
1. **Is Starter 300 correctly sized?** **Undersized for its nominal target.** It holds a *light / trial-graduate* user but not an active founder-led 2-person team (~338). Either raise to **~500**, or keep 300 *deliberately* as an upgrade-driver (see strategic note).
2. **Is Growth 700 correctly sized?** **Yes — well-sized.** Comfortably holds Growing (~569) and Small Business (~338); the funnel's workhorse.
3. **Is Business 1500 correctly sized?** **Adequate for typical, tight for active.** Established typical ~1,307 fits; active ~1,650 overflows. Recommend **~2,000**.
4. **Most likely to require top-ups?** **Agency** (Very Frequent) — but they should be on Enterprise. Among the four standard tiers: **Business/Established** (Frequent) and **active Small Business on Starter** (Frequent).
5. **Most likely to upgrade?** **Small Business → Growth** — the Starter 300 undersizing creates the strongest, earliest upgrade pressure. Secondarily **Established → Enterprise** (agencies outgrowing Business).
6. **Recommended LAUNCH capacity:** Free **300** · Starter **500** · Growth **700** · Business **2,000** · **+ Enterprise** (agencies). Keep prices as proposed.
7. **Recommended 12-MONTH capacity (after real usage):** calibrate to actuals; likely Free **300** · Starter **500** · Growth **800** · Business **2,000–2,500** · Enterprise custom. Re-run this audit on the first 60–90 days of real cohort data.

**Strategic note (the Starter tension):** keeping Starter at **300** is *defensible as a GTM choice* — a tight entry tier maximizes Starter→Growth upgrades and top-up revenue, and matches the Credit Advisor's upgrade funnel. The trade-off is a worse *first paid experience* (active users hit the wall fast). **Choose deliberately:** 300 = revenue/funnel-optimized; ~500 = retention/experience-optimized. The data slightly favors ~500 for a healthy paid debut, with the Advisor nudging upgrades organically.

---

## SECTION J — FINAL VERDICT
**Recommended launch model:** activity-based credits on the existing dual-wallet ledger; **prices as proposed**; capacities **Free 300 · Starter 500 · Growth 700 · Business 2,000**, plus an **Enterprise** tier for agencies (Business covers only ~half of agency demand). Top-ups 250/750/1,500, never-expire (already supported). Founding-member as an additive layer.

**Recommended capacity model:**
| Plan | Proposed | Recommended Launch | 12-Month (post-data) | Fits segment |
|---|---|---|---|---|
| Free | 300 | **300** | 300 | Solo trial ✓ |
| Starter | 300 | **500** | 500 | Solo + light Small Biz |
| Growth | 700 | **700** | 800 | Small Biz + Growing |
| Business | 1500 | **2,000** | 2,000–2,500 | Established |
| Enterprise | — | **custom** | custom | Agency |

**Confidence Score: 62 / 100.** The **credit catalog is evidence-grounded** (code-derived token structure + live token corroboration), so the *per-activity* math is solid. But the **segment usage profiles are reasoned estimates, not measured** — no real per-customer usage distribution exists yet (only 2 prod orgs have any usage). The *shape* of the conclusions is robust (Starter undersized, Growth right, Business tight, Agency needs Enterprise, Small-Business gap), but the exact monthly totals will shift with real data. **Resolve by measuring the first 60–90 days of real per-customer consumption (SHADOW metering), then re-confirm capacities.**

> **Bottom line:** Growth 700 is correctly sized; **Starter 300 and Business 1500 are slightly undersized** for their target segments (raise to ~500 and ~2,000); the **Small-Business segment needs Growth, not Starter**; and **agencies need an Enterprise tier** — Business 1500 covers only ~half their realistic demand. Keep prices; tune capacities; let the Credit Advisor drive upgrades.

*(Analysis based on realistic monthly behavior, not power users. Credit costs evidence-derived; usage profiles estimated pending real cohort data.)*
