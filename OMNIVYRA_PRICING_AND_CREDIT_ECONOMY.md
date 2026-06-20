# OMNIVYRA — CREDIT ECONOMY & SUBSCRIPTION PRICING ARCHITECTURE

**A commercial-model design** (pricing / credit-economy / monetization), not an engineering spec.
2026-06-17. Grounded in: `OMNIVYRA_COST_ACTIVITY_INVENTORY.md`, `OMNIVYRA_COST_ECONOMICS_MODEL.md`, the Credit Advisor + Consumption Intelligence work, and live production consumption data.

> ### Evidence basis & caveats (read first)
> - **COGS facts are real** (from the cost model, public list LLM prices): per-action LLM cost is **cents**; the cost *concentrations* are image generation (`gpt-image-1` ~$0.011/img), lead-scan per-post LLM, multi-provider report probes, and 24/7 worker/Redis infra. The only LLM outlier is the gpt-4o blog-fallback (~$1) — a bug to cap, not a pricing input.
> - **Pricing numbers are design proposals**, not validated willingness-to-pay. They're set so credit value > COGS with healthy margin and sit sensibly vs competitors. Validate against real infra invoices + a pricing experiment before launch.
> - **Core principle (per brief): credits monetize OUTCOME VALUE, not token cost.** Because COGS is cents, margin is structurally high on text; the model's job is to capture *value* fairly while protecting against the few real cost drivers (Phase 8).

---

## PHASE 1 — PRICING PRINCIPLES

**The model is HYBRID: a subscription for *access + capacity + automation*, credits for *outcomes produced*.**

**1. Subscription buys (recurring, capacity-based):**
- Seats / users
- Platform integrations & publishing connections (LinkedIn, X, IG, FB, YouTube, etc.)
- Always-on **monitoring & automation** (engagement polling, conversation triage, lead listening, scheduled intelligence) — these are *infrastructure uptime* costs, not per-outcome
- Baseline **intelligence** (dashboards, analytics, the Credit Advisor itself)
- A monthly **credit allotment**

**2. Credits buy (consumable, outcome-based):** the discrete, valuable artifacts a user *creates or requests*:
- Content (blog/newsletter/whitepaper/etc.)
- Campaigns (planning + generated items)
- Creator assets (images, carousels, decks, video)
- Reports (Digital Presence, Performance, Market Growth)
- Market Pulse scans
- Lead discovery runs
- AI engagement replies

**3. Hybrid activities (subscription floor + credit on use):**
| Activity | Subscription component | Credit component |
|---|---|---|
| **Engagement** | The inbox, monitoring, triage automation (always-on) | Each *AI-generated reply* (the outcome) |
| **Active Leads** | The listening infrastructure + dashboard | Each *discovery run / qualified lead* |
| **Market Pulse** | Access + scheduled standard scans (plan-limited) | On-demand & *deep* scans |
| **Campaigns** | The planner, calendar, scheduler | Plan generation + each generated content/creator item |
| **Reports** | Snapshot access at plan cadence | On-demand / premium reports beyond cadence |

Rationale: the always-on automations are **fixed infra cost** (the 24/7 worker, Redis, social polling) — billing them per-event would punish the behaviors that drive retention. Bundle them into the subscription; meter the *creative outputs*.

---

## PHASE 2 — ACTIVITY VALUE CLASSIFICATION (by customer outcome, not token cost)

| Activity / Variant | Value Tier | Reasoning (outcome value) |
|---|---|---|
| AI engagement reply, reply suggestion | **A — Low** | Micro-assist; high frequency; near-free to deliver |
| Social post / tweet | **A — Low** | Short, disposable, high volume |
| Conversation triage / memory (automation) | **A — Low** (subscription-covered) | Background utility, not a deliverable |
| Blog Short, Story | **B — Medium** | Useful asset, modest depth |
| Blog Medium, Newsletter, Article, Brand Card | **B — Medium** | Standard marketing deliverables |
| Single Image, Banner, Carousel-5, Infographic | **B–C** | Tangible creative asset; image gen has real COGS |
| Blog Deep, Guide, Carousel-10, Deck, PDF | **C — High** | Substantial, multi-section/multi-slide deliverables |
| Market Pulse (Standard), Company snapshot read | **C — High** | Decision-grade intelligence |
| Whitepaper, Case Study, Video | **D — Premium** | Flagship long-form / production assets |
| BOLT Campaign (Text/Creator), Lead Discovery run | **D — Premium** | Multi-step orchestration producing many outputs |
| Digital Presence / Performance / Market Growth Report | **D — Premium** | Multi-provider, board-ready intelligence |
| **Intelligent Mix Campaign**, Market Pulse **Deep**, Enterprise multi-region intelligence | **E — Strategic** | Highest leverage; drives the customer's strategy; highest real COGS (fan-out, probes, image) |

Tiers map to credit bands: A ≈ 1–3, B ≈ 8–15, C ≈ 16–25, D ≈ 25–50, E ≈ 50+.

---

## PHASE 3 — RECOMMENDED CREDIT CATALOG

Base unit: **1 credit = 1 AI engagement reply** (the cheapest meaningful outcome). Credits are outcome-weighted; the COGS column (from the cost model, list prices) confirms every line clears margin.

| Module | Activity | Variant | Credits | Rel. weight | COGS ref | Reasoning |
|---|---|---|---|---|---|---|
| Engagement | AI reply / suggestion | — | **1** | 1× | ~$0.002 | Base unit; high-volume assist |
| Content | Social post | Post/Tweet | **3** | 3× | ~$0.002 | Short, frequent |
| Content | Blog | Short | **8** | 8× | ~$0.01 | Medium-value asset |
| Content | Blog | Medium | **12** | 12× | ~$0.02 | Standard deliverable |
| Content | Blog | Deep | **16** | 16× | ~$0.03 | High depth |
| Content | Blog | Long/Pillar | **25** | 25× | ~$0.05 | Flagship SEO asset |
| Content | Newsletter | Standard | **12** | 12× | ~$0.02 | Recurring deliverable |
| Content | Article | Standard | **12** | 12× | ~$0.02 | — |
| Content | Guide | Standard | **18** | 18× | ~$0.03 | Long, structured |
| Content | Story | Standard | **8** | 8× | ~$0.01 | Short narrative |
| Content | Case Study | Standard | **20** | 20× | ~$0.03 | High-trust asset |
| Content | Whitepaper | Standard | **30** | 30× | ~$0.05 | Premium long-form |
| Creator | Brand Card | — | **8** | 8× | ~$0.005 | Cheapest visual (no image gen) |
| Creator | Carousel | 5-slide | **15** | 15× | ~$0.01 | Multi-slide, no image gen |
| Creator | Infographic | — | **15** | 15× | ~$0.01 | Composed visual |
| Creator | Single Image | — | **12** | 12× | ~$0.02 | **Real image-gen COGS** |
| Creator | Banner | — | **12** | 12× | ~$0.02 | **Real image-gen COGS** |
| Creator | Carousel | 10-slide | **25** | 25× | ~$0.015 | More slides/value |
| Creator | Deck / Slider | N | **20** | 20× | ~$0.015 | Presentation asset |
| Creator | PDF deck | N | **20** | 20× | ~$0.015 | — |
| Creator | Video | — | **30** | 30× | ~$0.01* | Premium format (*render stubbed today) |
| Campaigns | BOLT Text | plan + orchestration | **25** + items | 25× | ~$0.01 plan | Planning value; items billed at content rates |
| Campaigns | BOLT Creator | plan + orchestration | **35** + items | 35× | ~$0.01 plan | + image-bearing items |
| Campaigns | Intelligent Mix | plan + orchestration | **50** + items | 50× | ~$0.01 plan | Strategic, 12-wk capable |
| Campaigns | Campaign Chat | per message | **1** | 1× | ~$0.001 | Lightweight assist |
| Market Pulse | Scan | Standard (1 region) | **15** | 15× | ~$0.006 | Decision intelligence |
| Market Pulse | Scan | Deep (N regions) | **40** | 40× | ~$0.01–0.08 | Multi-region; real probe COGS |
| Reports | Digital Presence / Snapshot | — | **40** | 40× | ~$0.01–0.085 | Multi-provider probes; board-ready |
| Reports | Performance Intelligence | — | **40** | 40× | inherits snapshot | Premium analytics |
| Reports | Market Growth Intelligence | — | **30** | 30× | ~$0 (DB) | High value, low COGS |
| Company Profile | Onboarding refine | — | **0 (bundled)** | — | ~$0.01–0.065 | Free — it's the activation moment |
| Active Leads | Lead Discovery | per scan run | **20** | 20× | ~$0.01–0.05/run | Premium; covers per-post qualify burst |
| Active Leads | Qualified lead (alt model) | per lead | **2** | 2× | ~$0.0005 | Pay-per-result option |

Design notes: **campaigns are priced as plan + per-item** so a 20-post campaign and a 3-post campaign aren't the same price; image-bearing creator assets carry their real COGS premium; **deep/multi-region variants cost ~2.5–3×** their standard counterparts (matching the cost model's fan-out reality).

---

## PHASE 4 — FREE EXPERIENCE (300 credits)

**Goal: the user touches every module and reaches one "wow" outcome before paying.** Suggested guided journey:

| Step | Activity | Credits |
|---|---|---|
| Onboarding company profile | Company Profile refine | **0** (bundled) |
| "See your standing" | 1 Digital Presence / Snapshot Report | **40** |
| "Understand your market" | 1 Market Pulse (Standard) | **15** |
| "Create content" | 2 Blog (Medium) | **24** |
| "Go visual" | 1 Single Image + 1 Carousel-5 | **27** |
| "Run a campaign" | 1 BOLT Text plan + 5 posts | **40** |
| "Find buyers" | 1 Lead Discovery run | **20** |
| "Engage" | 10 AI replies | **10** |
| "Flagship asset" | 1 Whitepaper | **30** |
| Free exploration buffer | misc content/replies | **~94** |
| **Total** | | **~300** |

This proves value across **all six required surfaces** (content, campaigns, creator, market pulse, active leads, engagement) with ~30% headroom for self-directed play. The Credit Advisor's pre-execution impact widget shows "this costs X% of your free credits," and as the balance draws down its runway/upgrade nudges convert the trial.

---

## PHASE 5 — SUBSCRIPTION TIERS

| | **Starter** | **Growth** | **Business** | **Enterprise** |
|---|---|---|---|---|
| **Price (monthly)** | **$39** | **$129** | **$399** | **$1,500+ (custom)** |
| Annual (2 mo free) | $390/yr | $1,290/yr | $3,990/yr | custom |
| **Seats included** | 1 | 3 | 10 | Custom (15+) |
| **Monthly credits** | **1,500** | **6,000** | **20,000** | **60,000+** |
| Effective $/credit | $0.026 | $0.0215 | $0.020 | ~$0.025 (w/ SLA) |
| Platform integrations | 3 | 6 | All | All + custom |
| Active campaigns | 1 | 3 | Unlimited* | Unlimited* |
| Lead discovery | Daily, 1 platform | 2×/day, 3 platforms | Continuous, all | Continuous + custom regions |
| Market Pulse | Standard (monthly) | Standard (weekly) | Deep + multi-region | Unlimited deep |
| Monitoring/automation | Basic | Full | Advanced + alerts | White-glove + SLA |
| Reports | 1 snapshot/mo | Snapshot + performance | All, on-demand | All + custom + API |
| Support | Email | Priority | CSM | Dedicated + SLA |

*within Fair Use (Phase 8). Tiers deliberately track the existing `plan_limits` ladder (1,500 / 6,000 / 20,000) so implementation maps cleanly.

**Positioning of credit allotments:** a Growth customer producing ~4 blogs + 2 campaigns + 6 creator assets + weekly market pulse + daily leads + engagement ≈ 4,500–5,500 credits/mo — fits 6,000 with headroom, leaving top-up upside for busy months.

---

## PHASE 6 — TOP-UP STRATEGY (never expire)

| Pack | Credits | Price | Effective $/credit | Best for |
|---|---|---|---|---|
| **Small** | 1,000 | **$29** | $0.029 | Occasional overflow |
| **Medium** | 5,000 | **$119** | $0.0238 | Busy-month boost |
| **Large** | 15,000 | **$299** | $0.0199 | Power users / agencies |
| **Enterprise** | 50,000 | **$899** | $0.018 | Bulk pre-purchase |

Rules: **top-up credits never expire** (per brief) and are consumed **after** monthly subscription credits (so subscription credits don't go to waste). Top-up rates sit **slightly above** the equivalent subscription effective rate at small sizes (nudging users to upgrade their plan instead of repeatedly topping up) and **converge to plan rates** at large sizes (rewarding committed volume). The Credit Advisor surfaces the "a plan upgrade is cheaper than your top-up pattern" insight automatically.

---

## PHASE 7 — CREDIT ROLLOVER POLICY

| Option | Pro | Con |
|---|---|---|
| No rollover | Predictable revenue | Feels punitive; spurs end-of-month dumping |
| **Partial rollover (RECOMMENDED)** | Goodwill + bounded liability | Slight complexity |
| Full rollover | Most generous | Unbounded liability; erodes recurring revenue; hoarding |

**Recommendation: Partial rollover.** Unused **subscription** credits roll over up to **1× the monthly allotment** (a one-month cap), then expire; **top-up** credits never expire. Reasoning: it removes "use-it-or-lose-it" anxiety (improving perceived value and reducing churn) while capping the balance-sheet liability and protecting recurring revenue. It also pairs naturally with the Credit Advisor's **under-utilization** rule ("you have headroom — here's what to create"), turning rollover from a cost into an engagement lever.

---

## PHASE 8 — FAIR USE POLICY (protect the real cost drivers)

The cost model identifies the only activities with material COGS: **image generation, lead-scan per-post LLM, multi-provider report probes, campaign fan-out**. Fair Use guards exactly these:

| Risk | Guard | Mechanism (hooks already exist) |
|---|---|---|
| **Extreme campaign usage** | Concurrency + fan-out caps per tier; very large campaigns (freq×weeks×platforms) require Business+ or top-up | `jobCostEstimator` plan cost limits; campaign duration caps (1–4 wk BOLT / 1–12 wk Mix) |
| **Extreme lead discovery** | Scan frequency + platform/region caps per tier; beyond fair use → throttle or top-up | scheduler cadence + per-co/day job cap |
| **Extreme automation** | Always-on automations are subscription-bundled but **rate-limited** (poll cadence, triage batch size); abusive volume → throttle | existing cron batch limits |
| **Extreme creator/image generation** | Daily image-gen cap per tier (image is the real per-asset COGS); overage → credits/top-up | per-asset credit cost already prices it |
| **Model-cost runaway** | The gpt-4o blog-fallback (~$1/blog) must be **capped/eliminated** — it's a 15–100× COGS outlier | engineering fix (flagged in cost audit) |

Principle: **soft caps + transparent overage**, never silent failure. When a user hits a fair-use ceiling, the Credit Advisor explains it and offers optimization → top-up → upgrade (Phase 9). Platform stays profitable because the high-COGS tail is gated to paying tiers and metered in credits.

---

## PHASE 9 — UPGRADE STRATEGY (driven by the Credit Advisor)

The Credit Advisor's runway/optimization/upgrade engine already encodes the **optimization-before-upgrade** rule. Map it to commercial actions:

| Signal (from Consumption Intelligence) | Recommended action |
|---|---|
| Conservative runway healthy, opportunity ≥10% | **Optimize** — show savings levers (no spend) |
| Conservative runway <15d, plan otherwise fits, temporary spike | **Top-up** — bridge the month |
| Sustained usage > plan credits for 2+ cycles, or seats needed | **Upgrade** — next tier is cheaper than the top-up pattern |
| Usage > Business volume, or needs SLA/security/custom regions/API | **Enterprise contact** |

This aligns the commercial funnel with the **multi-runway model** (conservative runway is the trigger, not the optimistic 30-day average) and the **forecast confidence** (don't hard-sell on Low-confidence/limited data — nudge gently). The Advisor is the in-product growth engine: optimization builds trust, top-ups capture overflow, upgrades capture sustained growth.

---

## PHASE 10 — COMPETITIVE POSITIONING

| Competitor | Their focus / price | Omnivyra edge |
|---|---|---|
| **HubSpot** | CRM + marketing suite; $$$ ($800–3,600/mo at scale) | Omnivyra is **AI-native creation + intelligence**, far cheaper entry; not a CRM (integrate, don't compete) |
| **Semrush / Ahrefs** | SEO + competitive intel; $100–500/mo | Omnivyra bundles **market/competitive intelligence + content generation + publishing** — charge a **premium** on Digital Presence / Market Growth reports |
| **Hootsuite / Sprout / Buffer** | Social scheduling + engagement; $15–250/mo | Omnivyra does scheduling/engagement **plus generation + leads** — be **aggressive** here (Starter undercuts Hootsuite/Sprout) |
| **ActiveCampaign** | Email automation; $15–250/mo | Omnivyra's automation spans social + leads + intelligence; comparable price, broader outcome |

**Where to charge a premium:** AI campaign/strategy generation, multi-provider intelligence reports, deep/multi-region Market Pulse, creator video/decks.
**Where to be aggressive:** entry price (Starter $39 < HubSpot/Sprout), social scheduling + engagement (vs Buffer/Hootsuite), content volume (credits make 10 blogs cheap).
**Where Omnivyra delivers more value:** it collapses **5–6 tools** (content + social + SEO/competitive intel + leads + engagement + reporting) into one outcome-priced platform — the consolidation story is the core pitch.

---

## PHASE 11 — FINANCIAL MODEL (modeled COGS: list LLM prices + est. infra allocation)

| Persona | Plan (+top-ups) | Revenue/mo | Credits used | Modeled COGS | Gross margin |
|---|---|---|---|---|---|
| **Light user** | Starter $39 | **$39** | ~800 | LLM ~$3 + infra ~$3 = **~$6** | **~85%** |
| **Typical user** | Growth $129 | **$129** | ~5,000 | LLM ~$15 + image ~$3 + probes ~$2 + leads ~$3 + infra ~$8 = **~$31** | **~76%** |
| **Power user** | Business $399 + $119 top-up | **$518** | ~22,000 | LLM ~$60 + image ~$30 + probes ~$15 + leads ~$20 + infra ~$20 = **~$145** | **~72%** |
| **Heavy agency** | Enterprise $1,500 + top-ups | **~$1,900** | ~70,000 | LLM ~$200 + image ~$120 + probes ~$60 + leads ~$80 + infra ~$50 = **~$510** | **~73%** |

Observations: **gross margins land 72–85% across the curve** because LLM text is cents; the COGS that grows with scale is **image generation + lead probes + report probes** (exactly the Phase-8 fair-use targets). Infra is largely **fixed** (one 24/7 worker + Redis + Supabase + Vercel ≈ low-hundreds $/mo total) and amortizes favorably as users grow — so blended margin *improves* with scale. The model is profitable from the Starter tier up, provided the gpt-4o fallback outlier is capped.

---

## PHASE 12 — FINAL RECOMMENDATION

**Recommended credit catalog:** the Phase-3 table — outcome-weighted, base unit = 1 AI reply, deep/image/multi-region variants priced 2–3× standard, campaigns as plan + per-item.

**Recommended plans:** Starter $39 / 1,500cr · Growth $129 / 6,000cr · Business $399 / 20,000cr · Enterprise $1,500+ / 60,000cr+ (tracking the existing `plan_limits` ladder).

**Recommended pricing:** effective $0.020–0.026 / subscription credit; annual = 2 months free.

**Recommended top-ups:** 1k/$29 · 5k/$119 · 15k/$299 · 50k/$899; never expire; consumed after subscription credits.

**Recommended rollover:** Partial — subscription credits roll over up to 1 month's allotment then expire; top-ups never expire.

**Recommended upgrade strategy:** Credit-Advisor-driven funnel — **optimize → top-up → upgrade → enterprise**, triggered by the *conservative* runway and gated by forecast confidence.

**Recommended launch strategy:**
1. **Cap the gpt-4o fallback** and register the unmapped action keys (attribution → 100%) *before* go-live, so credit metering is accurate.
2. **Run credit metering in SHADOW** first (the Credit Advisor already reads it) to validate real per-customer credit consumption vs this catalog on live data — recalibrate credit costs from actuals.
3. Launch **300-credit free trial** → Starter/Growth self-serve → Business/Enterprise sales-assist.
4. Lead with the **consolidation pitch** (replace 5 tools) and the **Credit Advisor** as a transparency differentiator (no competitor shows customers their runway + savings).
5. Calibrate prices after 60–90 days of real usage + a small willingness-to-pay test.

---

## SUCCESS CRITERIA — CHECK
| # | Criterion | How the model meets it |
|---|---|---|
| 1 | 300 free credits = meaningful value | Phase-4 journey touches all 6 modules + a flagship asset, ~30% buffer |
| 2 | Subscriptions cover recurring costs | Always-on automation/monitoring bundled; fixed infra amortized; 72–85% margin |
| 3 | Credits monetize outcomes | Outcome-weighted catalog, not token cost |
| 4 | Top-ups support power users | 4 packs, never expire, volume-discounted |
| 5 | Pricing reflects customer value | Value tiers A–E drive credit bands |
| 6 | Competitive | Starter undercuts incumbents; premium only where Omnivyra is differentiated |
| 7 | Scales SMB→Enterprise | $39 → $1,500+, 1 → 15+ seats, 1.5k → 60k+ credits |
| 8 | Advisor supports upgrades/optimization | Phase-9 funnel maps 1:1 to the shipped Credit Advisor |

> **One-line thesis:** subscriptions sell *capacity + always-on intelligence* at high fixed margin; credits sell *outcomes* at outcome value; the Credit Advisor makes the whole economy transparent and self-optimizing — which is itself the differentiator. Calibrate the exact credit costs from SHADOW-mode actuals before locking the catalog.
