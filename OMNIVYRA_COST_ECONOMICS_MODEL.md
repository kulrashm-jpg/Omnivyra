# OMNIVYRA MASTER COST-ECONOMICS MODEL

**Foundation for: Credit Economy · Subscription Pricing · Top-Up Pricing · Profitability · Cost Governance.**
Generated 2026-06-17 from source at `c:\virality`. Companion to the structural inventory in [OMNIVYRA_COST_ACTIVITY_INVENTORY.md](OMNIVYRA_COST_ACTIVITY_INVENTORY.md) (consumption structure, all file-cited).

> ### ⚠️ EVIDENCE BOUNDARY — read before using any dollar figure
> Per the request's "no estimates without evidence" rule, every number below is tagged by source:
> - **[CODE]** — taken directly from the implementation (call counts, `max_tokens`/output-budget caps, in-code price tables). Hard evidence.
> - **[EST]** — token *counts* estimated from prompt construction + the caps. The system **does not tiktoken-count** — it reads usage from the provider response after the fact (`aiGateway.ts:1656`). So per-variant token figures are modelled, not measured.
> - **[LIST]** — public vendor list pricing (per your instruction), applied as of 2026-06; **may drift**. Cross-checked against the code's own tables where they exist.
> - **[HYPO]** — **"GPT-5.5 Mini" is not a real model.** No OpenAI GPT-5.5-mini exists and there is no pricing for it. Per your "estimation only" answer, it is modelled at an **assumed** rate (see §8) purely for scenario comparison. Every GPT-5.5-mini cell is hypothetical.
> - **[PLAN]** — public infra *plan* pricing (Railway/Supabase/Upstash/Vercel/Cloudflare); actual spend requires your invoices.
>
> Token figures are **per single invocation** unless marked "recurring." Costs use the §8 rate card. "Min/Max" = best/worst realistic scenario (cold cache, all retries, largest variant, all providers keyed).

---

## §8 — VENDOR RATE CARD (the basis for all math below)

### LLM token pricing (USD per 1,000,000 tokens)
| Vendor / model | Input | Output | Tag | Used by |
|---|---|---|---|---|
| OpenAI `gpt-4o-mini` (DEFAULT) | $0.15 | $0.60 | [CODE]=[LIST] `jobCostEstimator.ts:37`, `costGovernance.ts:96` | ~all gateway ops, sections, planning, creator blueprint, engagement, leads |
| OpenAI `gpt-4o` | $2.50 | $10.00 | [CODE]=[LIST] `jobCostEstimator.ts:38` | blog/long-form **body** draft + retries (compat-core path) |
| **"GPT-5.5 Mini" (DOES NOT EXIST)** | **$0.25** | **$2.00** | **[HYPO]** assumed | scenario-comparison column only |
| Anthropic `claude-3-5-sonnet` | $3.00 | $15.00 | [LIST] | cross-provider fallback (`aiGateway.ts:1045`) |
| Anthropic `claude-haiku-4-5` | $0.80 | $4.00 | [CODE] `costGovernance.ts:98` | visibility probe |
| Google `gemini` Flash | $0.075 | $0.30 | [CODE] `costGovernance.ts:100` | visibility probe |
| Perplexity `sonar` | $1.00 | $1.00 | [CODE] `costGovernance.ts:102` | visibility probe (live web) |
| Azure `copilot` | $0.15 | $0.60 | [CODE] `costGovernance.ts:104` | visibility probe |
| OpenAI `text-embedding-3-small` | $0.02 | — | [LIST] | signal clustering (`signalEmbeddingService.ts:16`) |

### Non-token vendor pricing
| Vendor | Category | Unit price | Tag | Used by |
|---|---|---|---|---|
| OpenAI Images `gpt-image-1` (low, 1024²) | Image gen | ~$0.011 / image (range $0.01–0.02) | [LIST] | Single-Image + Banner creator assets only |
| DataForSEO | SERP | $0.002 / query | [CODE] `serpAcquisitionService.ts:225` | SERP cron (background) |
| SerpAPI | SERP | $0.01 / query | [CODE] `:165` | SERP cron |
| ScaleSERP | SERP | $0.01 / query | [CODE] `:195` | SERP cron |
| Ahrefs | Backlinks | subscription (~$129–$1,249/mo API tiers) — **no per-call** | [LIST] | snapshot authority lookup (if keyed) |
| Wikidata | Knowledge graph | free | [CODE] | snapshot KG lookup |
| Unsplash / Pexels / Pixabay | Stock image search | free (rate-limited) | [CODE] `imageService.ts:28` | content/creator stock imagery |
| OCR endpoint (`CREATOR_OCR_ENDPOINT`) | OCR | **unknown vendor/price** (off unless configured) | — | creator render QA |
| WhatsApp (Meta) | Messaging | per-conversation (Meta pricing, region-dependent) | [LIST] | whatsapp-broadcast/webhook |
| Stripe | Payments | ~2.9% + $0.30 / transaction | [LIST] | billing (not an activity cost, but a real vendor) |
| Email provider | Email | per-send (provider TBD) | — | `email-jobs` cron |

### Infra plan pricing (public; actuals need invoices)
| Vendor | Plan basis | Est. monthly | Tag |
|---|---|---|---|
| Railway (worker 24/7) | Pro $20/mo + usage (vCPU·hr + GB·hr) | ~$20–$150+ | [PLAN] |
| Supabase (Postgres) | Pro $25/mo + usage (DB/storage/egress) | ~$25–$100+ | [PLAN] |
| Upstash Redis | pay-go $0.20/100k cmds OR fixed $10–$280 | ~$10–$280 | [PLAN] |
| Vercel | Pro $20/mo/seat + functions/bandwidth | ~$20–$100+ | [PLAN] |
| Cloudflare | Free–Pro | ~$0–$20 | [PLAN] |
| Object storage (Railway/Supabase buckets) | usage (GB-mo + egress) | usage | [PLAN] |

### Per-call cost archetypes (building blocks — [EST] tokens, [LIST] rates, gpt-4o-mini)
| Archetype | Input tok | Output tok (cap source) | 4o-mini $/call (min–max) | GPT-5.5-mini [HYPO] $/call |
|---|---|---|---|---|
| **Tiny** (chatModeration 100, sentiment 60, suggestDuration 300) | 150–600 | 60–300 | $0.0001–$0.0003 | $0.0001–$0.0008 |
| **Small** (variant 1500, reply 800, recommendation 600) | 600–1,800 | 500–1,500 | $0.0004–$0.0012 | $0.0011–$0.0035 |
| **Medium** (master 1200, blueprint 600, section ≤5000, probe) | 1,500–4,000 | 1,200–5,000 | $0.0009–$0.0036 | $0.0028–$0.0110 |
| **Plan** (generateCampaignPlan 3000, previewStrategy 2000) | 4,000–12,000 | 2,000–3,000 | $0.0018–$0.0036 | $0.0050–$0.0090 |
| **Profile-extract** (profileExtraction 2000, ≤40 evidence) | 6,000–20,000 | 1,500–2,000 | $0.0018–$0.0042 | $0.0045–$0.0090 |
| **Blog-body (gpt-4o)** (compat-core, max_tokens ≤16,384) | 2,000–6,000 | 4,000–16,384 | **$0.045–$0.179** | n/a (4o, not mini) |

Output caps are [CODE] `OPERATION_OUTPUT_TOKENS` (`jobCostEstimator.ts:49-75`) + planned-section `min(5000,max(1800,wt×3.2))` + body `≤16384`. Input bands are [EST] from prompt construction (method matches code: chars/3.8, `jobCostEstimator.ts:175`).

---

## §1 — COMPLETE ACTIVITY INVENTORY (every variant, no aggregation)
| Module | Activity | Variant |
|---|---|---|
| Company Profile | Onboarding profile refine | Full refine (single) |
| Company Profile | Company Intelligence dashboard | Read (deterministic) |
| Digital Presence | Snapshot / Digital Presence Report | Standard |
| Digital Presence | Snapshot / Digital Presence Report | Deep (scan-queue only) |
| Reports | Performance Intelligence Report | Standard |
| Reports | Market Growth Intelligence Report | Standard |
| Content | Blog | Short ~800w / Medium ~1200w / Deep ~1600w / Long ~2000w |
| Content | Newsletter | Standard |
| Content | Article / Whitepaper / Guide / Story / Case Study | each (separate) |
| Creator Studio | Single Image · Banner · Infographic · Brand Card | each |
| Creator Studio | Carousel | 5-slide · 10-slide · N-slide |
| Creator Studio | Deck/Slider · PDF deck | N-page |
| Creator Studio | Video | placeholder |
| Campaigns | BOLT Text | week_plan preview · Standard (1–4wk) |
| Campaigns | BOLT Creator | Standard (1–4wk) |
| Campaigns | Intelligent Mix (Combined) | Standard (1–12wk) |
| Campaigns | Campaign Chat (Architect) | per message |
| Engagement | Reply Generation · Reply Suggestion · Conversation Triage · Conversation Memory · Inbox/Comment Analysis · Community Execution | each |
| Market Pulse | Scan | Standard (1 region) · Deep/Regional (N regions) |
| Active Leads | Lead Qualification | Reactive · Predictive |
| Active Leads | Scheduled lead scan | recurring |
| Analytics | All analytics services | Read (deterministic) |
| Recommendations | /generate · /long-form · /campaigns | each |
| Publishing | Publish | per platform (see §9) |
| Social Integrations | Connect / refresh / poll | per platform |

---

## §2 — CONTENT VARIANT INVENTORY
Planned-sectionwise engine (gpt-4o-mini): 1 plan + 1/section + repair gates. Variants driven by `target_word_count` [CODE `unifiedLongFormEngine.ts`]. **No image/search/intelligence calls in long-form.** Char/word bounds are the UI `target_word_count` options × ~6 chars/word [EST].

| Content Type | Variant | Word min–max | Char min–max | AI calls (min/avg/max) | Img | Search | Intel | In-tok min–max [EST] | Out-tok min–max [CODE caps] | Total-tok min–max |
|---|---|---|---|---|---|---|---|---|---|---|
| Blog | Short | 700–900 | ~4,200–5,400 | 5/8/16 | 0 | 0 | 0 | 7,500–40,000 | 9,000–80,000 | **13,500–120,000** |
| Blog | Medium | 1,100–1,300 | ~6,600–7,800 | 6/10/19 | 0 | 0 | 0 | 9,000–47,500 | 10,800–95,000 | **16,200–142,500** |
| Blog | Deep | 1,500–1,700 | ~9,000–10,200 | 7/11/21 | 0 | 0 | 0 | 10,500–52,500 | 12,600–105,000 | **18,900–157,500** |
| Blog | Long/Pillar | 1,900–2,100 | ~11,400–12,600 | 8/13/24 | 0 | 0 | 0 | 12,000–60,000 | 14,400–120,000 | **21,600–180,000** |
| Newsletter | Standard | 600–1,400 | ~3,600–8,400 | 6/9/18 | 0 | 0 | 0 | 9,000–45,000 | 10,800–90,000 | **16,200–135,000** |
| Article | Standard | 800–1,600 | ~4,800–9,600 | 6/10/19 | 0 | 0 | 0 | 9,000–47,500 | 10,800–95,000 | **16,200–142,500** |
| Whitepaper | Standard | 1,500–3,000 | ~9,000–18,000 | 8/13/26 | 0 | 0 | 0 | 12,000–65,000 | 14,400–130,000 | **21,600–195,000** |
| Guide | Standard | 1,200–2,000 | ~7,200–12,000 | 7/11/21 | 0 | 0 | 0 | 10,500–52,500 | 12,600–105,000 | **18,900–157,500** |
| Story | Standard | 600–1,200 | ~3,600–7,200 | 5/8/16 | 0 | 0 | 0 | 7,500–40,000 | 9,000–80,000 | **13,500–120,000** |
| Case Study | Standard | 800–1,500 | ~4,800–9,000 | 6/10/19 | 0 | 0 | 0 | 9,000–47,500 | 10,800–95,000 | **16,200–142,500** |
| *(any)* | **Compat-core fallback** (gpt-4o) | varies | varies | 2/3/6 | 0 | 0 | 0 | 4,000–36,000 | 8,000–98,000 | **12,000–134,000** |

⚠️ The fallback row uses **gpt-4o** (≤16,384 out/call) — far higher $ per token. Burn-in mode (default OFF) doubles all rows.

---

## §3 — CREATOR VARIANT INVENTORY
1 blueprint LLM call emits ALL slide copy regardless of count [CODE `creatorExecutionEngine.ts:479`]. Image gen called once, image/banner only [CODE `creatorAssetRenderer.ts:2336`]. OCR = per-slide HTTP **only if `CREATOR_OCR_ENDPOINT` set**.

| Asset Type | Variant | Slides/Pages | AI calls | Image-gen | OCR (min→max) | In-tok min–max [EST] | Out-tok min–max | Total-tok min–max |
|---|---|---|---|---|---|---|---|---|
| Single Image | — | 1 | 1 | **1** | 0→1 | 1,500–4,000 | 600–2,000 | 2,100–6,000 |
| Banner | — | 1 | 1 | **1** | 0→1 | 1,500–4,000 | 600–2,000 | 2,100–6,000 |
| Infographic | — | 1 | 2 | 0 | 0→1 | 2,100–5,500 | 1,200–3,000 | 3,300–8,500 |
| Brand Card | — | 1 | 1 | 0 | 0 | 1,500–4,000 | 600–2,000 | 2,100–6,000 |
| Carousel | 5-slide | 5 | 1 | 0 | 0→5 | 1,800–4,500 | 1,500–4,000 | 3,300–8,500 |
| Carousel | 10-slide | 10 | 1 | 0 | 0→10 | 2,200–5,000 | 2,500–5,000 | 4,700–10,000 |
| Carousel | N-slide | N | 1 | 0 | 0→N | 1,800–5,500 | 1,500–5,000 | 3,300–10,500 |
| Deck / Slider | N-page | N | 1 | 0 | 0→N | 2,000–5,500 | 2,000–5,000 | 4,000–10,500 |
| PDF deck | N-page | N | 1 | 0 | 0→N | 2,000–5,500 | 2,000–5,000 | 4,000–10,500 |
| Video | — | 0 (stub) | 1 | 0 | 0 | 1,500–4,000 | 600–2,000 | 2,100–6,000 |

---

## §4 — REPORT INVENTORY
| Report | Variant | AI/LLM calls | Provider (probe) calls | Search calls | External API | In-tok min–max [EST] | Out-tok min–max | Total-tok min–max |
|---|---|---|---|---|---|---|---|---|
| Digital Presence / Snapshot | Standard | 0 own | **up to 60** probes (5 providers × ≤12 q) | 0 inline (SERP cron-only) | Wikidata(free)+Ahrefs(sub, if keyed) | 3,600–48,000 | 2,400–36,000 | **6,000–84,000** |
| Digital Presence / Snapshot | Deep (scan-queue) | 0 own | up to 60 (cache off → more re-bill) | 0 | budget 400 req/$12 | 3,600–48,000 | 2,400–36,000 | 6,000–84,000 |
| Performance Intelligence | Standard | inherits Snapshot | inherits | 0 | inherits | = Snapshot | = Snapshot | = Snapshot |
| Market Growth Intelligence | Standard | **0** | 0 | 0 | 0 | 0 | 0 | **0** (DB-only) |
| Market Pulse | Standard (1 region) | 1 | 0 | 0 | 0 | 1,500–4,000 | 1,200–8,000 | **2,700–12,000** |
| Market Pulse | Deep (N≈5–15 regions) | N | 0 | 0 | 0 | 7,500–60,000 | 6,000–120,000 | **13,500–180,000** |
| Company Profile | Onboarding refine | 5/10/20 | 0 | ≤40 HTTP fetch (free) | crawl | 30,000–160,000 | 8,000–40,000 | **38,000–200,000** |

Probe in/out are external-provider LLM (priced in §8 probe rows, NOT gpt-4o-mini). Company Profile's `profileExtraction` is the single largest input-token call (≤40 evidence summaries).

---

## §5 — CAMPAIGN INVENTORY
R = Σ(frequency)×weeks rows; P = platforms/row [CODE `boltPipelineService.ts:552`]. Planning = 1–3 LLM (drafting/scoring/refining). Fan-out dominates.

| Campaign | Variant | Duration | Content rows R | Creator rows | AI calls | Image calls | Search | In-tok min–max [EST] | Out-tok min–max | Total-tok min–max |
|---|---|---|---|---|---|---|---|---|---|---|
| BOLT Text | week_plan preview | 1–4wk | 0 | 0 | 1–3 | 0 | 0 | 4,000–36,000 | 2,000–9,000 | **6,000–45,000** |
| BOLT Text | Standard (small: f3/2wk/1P) | 2wk | ~6 | 0 | ~13 | 0 | 0 | 18,000–90,000 | 22,000–110,000 | **~40,000** |
| BOLT Text | Standard (large: f7/4wk/4P) | 4wk | ~28 | 0 | ~87 (3 plan+28 master+56 var) | 0 | 0 | 120,000–600,000 | 95,000–300,000 | **~275,000** |
| BOLT Creator | Standard (f5/4wk, img+carousel) | 4wk | ~20 | ~20 | ~60+ (plan+text+40 creator) | **~10** (image/banner rows; carousel=0) | 0 | 90,000–500,000 | 60,000–220,000 | **~200,000** |
| Intelligent Mix | Standard (text4+creator2 /wk, 4wk) | 4wk | ~24 | ~8 | ~80 | ~8 | 0 | — | — | **~190,000** |
| Intelligent Mix | Standard (MAX: 12wk, 4P) | **12wk** | **~72** | ~24 | ~190 (plan+48 master+96 var+48 creator) | **~24** | 0 | 230,000–900,000 | 150,000–580,000 | **~583,000** |
| Campaign Chat | per message | n/a | 0 | 0 | 1 | 0 | 0 | 600–1,800 | 500–1,500 | **1,100–3,300** |

---

## §6 — ENGAGEMENT INVENTORY (per item; all gpt-4o-mini, uncached)
| Activity | Variant | AI calls | Messages processed | In-tok min–max [EST] | Out-tok min–max [CODE] | Total-tok min–max |
|---|---|---|---|---|---|---|
| Reply Generation | `responseGeneration` | 1–2 (retry) | 1 thread | 800–2,000 (×2) | 800 | **1,600–5,600** |
| Reply Suggestion | `engagement_reply_suggestions` | 1 | 1 thread | 600–1,500 | ≤700 | **1,300–2,700** |
| Conversation Triage | `conversationTriage` | 1 | up to 10 ctx msgs | 400–1,000 | 80–200 | **600–1,800** |
| Conversation Memory | `conversationMemorySummary` | 1 (gated ≥5 msgs) | thread window | 500–1,500 | 150–400 | **650–1,900** |
| Inbox/Comment Analysis | `sentiment_classification` / Omnivyra `analyzeMessage` | 0–1 | 1 comment | 80–250 | ≤60 | **140–310** |
| Community Execution | `community_execution` | **0** (pre-generated) | 1 post | 0 | 0 | **0** |

---

## §7 — ACTIVE LEADS INVENTORY (per discovered post)
| Activity | Variant | Platforms | AI calls | Discovery calls | Search | In-tok min–max [EST] | Out-tok min–max | Total-tok min–max |
|---|---|---|---|---|---|---|---|---|
| Lead Qualification | Reactive `qualifyLead` | reddit/linkedin/twitter | **1 / post** | 1 connector × plat × region | listening | 400–900 | 100–250 | **500–1,150** |
| Lead Qualification | Predictive `qualifyPredictiveLead` | same | 1 / post | same | same | 400–900 | 120–300 | **520–1,200** |
| Scheduled scan | recurring (per job) | 3 global | Σ(plat×region×posts) | 3 connectors | per platform | — | — | per-post × fan-out |

---

## §9 — SOCIAL PLATFORM COST AUDIT
Per-publish external calls [CODE `platformAdapter.ts:174-211`]. APIs are free-quota but rate-limited; "cost" = quota/compute. Monthly volume = publishes + polling(10-min) + signal-scheduler(15-min) + token-refresh(10-min).

| Platform | Publish calls | Polling calls | Refresh calls | Background jobs | Est. monthly API volume driver | Activities |
|---|---|---|---|---|---|---|
| LinkedIn | 1 (+media) | 10-min poll | 10-min | engagement-polling, signal-scheduler | high (top listening cost, base 8) | publish, engagement, leads |
| X / Twitter | 1 | 10-min | **per publish** (2h tokens) | polling, lead-scan | high (token churn) | publish, engagement, leads |
| Instagram | **2–3** (container→poll→publish) | 10-min | periodic | polling | high (3× per publish) | publish, engagement |
| Facebook | 1–2 | 10-min | periodic | polling | medium | publish, engagement |
| YouTube | **~6** (resumable upload) | 6h GA4-adjacent | periodic | analytics-ingestion | high per publish | publish |
| TikTok | ~5 | — | periodic | — | medium | publish |
| Pinterest | ~4 | — | periodic | — | medium | publish |
| Threads | ~1–2 | 10-min | periodic | community-AI | low-medium | publish, engagement |
| Reddit | OAuth post | listening | periodic | lead-scan, RPA(Playwright) | high (lead listening base 3 + RPA compute) | leads, community |
| WordPress / CMS | via `publishing_jobs` (30s DB-poll loop) | — | — | CMS publish loop | continuous poll | blog/long-form publish |
| WhatsApp (Meta) | per-message | webhook | — | whatsapp-broadcast/webhook | **per-conversation Meta fee** | messaging |
| Discord/Quora/Slack/StackOverflow/ProductHunt/GitHub | per-platform | — | — | community-AI / RPA | low | community |

---

## §10 — INFRASTRUCTURE COST AUDIT [PLAN]
| Component | Fixed cost | Variable cost | Associated activities |
|---|---|---|---|
| Railway worker (`backend/workers/main.ts`, 24/7) | Pro $20/mo | vCPU·hr + GB·hr (continuous) | ALL BullMQ workers + `startCron` loop |
| Supabase Postgres | Pro $25/mo | DB compute + storage + egress | every activity (ledger, content, signals) |
| Upstash Redis | $10–$280/mo OR $0.20/100k cmds | command volume (idle-poll workers, CronGuard) | all queues, caching, locks |
| Vercel (Next.js) | Pro $20/mo/seat | function invocations + bandwidth | API routes, 8 platform crons |
| Cloudflare | $0–$20/mo | bandwidth | edge/CDN |
| Object storage (Railway/Supabase buckets) | — | GB-mo + egress | creator renders, report artifacts, RPA artifacts |
| **BullMQ queues (~20)** | (on Railway+Redis) | per-job compute | `publish, posting, engagement-polling, bolt-execution, ai-heavy, engine-jobs, intelligence-polling, lead-thread-recompute, conversation-memory-rebuild, creator-render, publishing_jobs` + 14 content queues + `lead-jobs/dlq, planner-refinement, engagement-signals, listening-executions, semantic-indexing, replay-partition` |
| Schedulers/crons | (on Railway+Vercel) | per-tick compute | §11 |

**Per-activity infra allocation is marginal** (a content gen adds ~1 queue job + a few DB writes). Treat infra as a **fixed monthly base + small per-job increment**, not a per-activity line item. In §13 the Infra column is a nominal per-job allocation [EST ~$0.0005–$0.005], not a metered charge.

---

## §11 — RECURRING BACKGROUND COST AUDIT
| Process | Frequency [CODE] | AI calls/run | Search/API calls/run | Monthly executions [EST] |
|---|---|---|---|---|
| Conversation triage | every 3 min (`cron.ts:151`) | up to 15 | 0 | ~14,400 cycles → **≤216,000 AI calls/mo** (gated) |
| Conversation memory drain | every 5 min | per ≥5-msg thread | 0 | ~8,640 cycles |
| Engagement polling enqueue | every 10 min (`cron.ts:169`) | 0 | social metrics (batch 50/post) | ~4,320 |
| Recent-posts comment ingest | every 10 min (`cron.ts:207`) | per comment (Omnivyra+sentiment) | social reads | ~4,320 |
| Social token refresh | every 10 min (`cron.ts:201`) | 0 | OAuth refresh | ~4,320 |
| Scheduled lead detection | 07:00 & 18:00 daily | fans per-post qualifiers | 3 connectors × ≤500 cos | ~30,000 jobs/mo → **per-post AI burn** |
| Engagement signal scheduler | every 15 min (`cron.ts:196`) | 0 | social-API | ~2,880 |
| Intelligence polling | every 2h (`cron.ts:170`) | 0 | external signal-API | ~360 |
| GA4 ingestion | every 6h (`cron.ts:202`) | 0 | Google Analytics | ~120 |
| Daily intelligence sweep | daily (`dataDrivenIntelligenceScheduler`) | **0** (deterministic) | trend/signal reads | ~30 × N companies (19 generators each) |
| Market pulse automation | daily (`vercel.json`) | 1/region | 0 | ~30 |
| Analytics ingestion | daily (`vercel.json`) | 0 | social+GA4 | ~30 (→4 sub-jobs) |
| SERP acquisition | daily (`vercel.json`) | 0 | ≤8 SERP queries (cap 25/day) | ~30 |
| Community-AI lease reaper / DLQ flush | 30s / 60s | 0 | Redis/DB | ~86,400 / ~43,200 |
| RPA backpressure / retry | 60s / 90s | 0 | Playwright browser | ~43,200 / ~28,800 |
| Email jobs | daily | 0 | email provider | ~30 |
| Integration health sweep | daily | 0 | ≤25 provider pings | ~30 |
| Sweep stuck publishing | every 5 min | 0 | 0 (DB only) | ~8,640 |
| Reconcile recent publishes | every 10 min (**default OFF**) | 0 | 1 GET/row | ~4,320 (when on) |

**Highest recurring AI burn:** (1) scheduled lead scan (per-post × platforms × regions × ≤500 cos × 2/day); (2) conversation triage (≤216k calls/mo). Both uncached.

---

## §12 — COST CALCULATION (methodology)
- **gpt-4o-mini cost** = Σ over calls of (in/1e6×0.15 + out/1e6×0.60). [LIST]=[CODE]
- **GPT-5.5-mini cost [HYPO]** = Σ (in/1e6×0.25 + out/1e6×2.00). Output-dominated → ≈ **3.0–3.3× the 4o-mini figure**. Model does not exist; estimation only.
- **gpt-4o cost** (compat-core only) = Σ (in/1e6×2.50 + out/1e6×10.00). ~17–40× per-token vs mini.
- **External API cost** = visibility probes (§8 probe rates × tokens) + SERP ($0.002–$0.01/query, cron) + listening + social (quota, ~$0). Reports/leads carry this; content/creator carry ~$0.
- **Image cost** = image-gen calls × $0.011 (low). Only Single-Image/Banner/creator-image campaign rows.
- **Infra allocation [EST]** = nominal $0.0005–$0.005/job (fixed base amortized; see §10). Not metered per call.

Worked anchors:
- **Blog Long, 4o-mini**: min ~21,600 tok → ~$0.007; max ~180,000 tok → ~$0.086. [HYPO 5.5-mini: ~$0.022–$0.27]
- **Blog (compat-core fallback, 4o)**: ~$0.09 (min) to **~$1.07** (max, 6 body calls @16,384 out). The single most expensive content path.
- **Snapshot report**: probes min ~$0.003 (1–2 providers, warm) → max ~$0.08 (5 providers, cold, Perplexity-heavy). Image $0.
- **Intelligent Mix MAX (12wk)**: 4o-mini ~$0.17 + image ~$0.26 = **~$0.43** [HYPO 5.5-mini LLM ~$0.52 → ~$0.78 total].
- **Lead qualify**: ~$0.0001–$0.0005 **per post** — trivial alone, but ×thousands/day recurring = the dominant aggregate.

---

## §13 — FINAL MASTER TABLE
**Convention** (to honor "no ranges inside cells except Min/Max columns"): Min/Max Tokens = total-token range. The component cost columns (4o-mini, 5.5-mini, External, Image, Infra) show the **max-scenario** point value. **Total Min/Max** = summed best/worst case. All $ are [EST]/[LIST]/[HYPO] per §8 — modelled, not invoiced.

| Module | Activity | Variant | Min Tok | Max Tok | 4o-mini $ | 5.5-mini $ [HYPO] | External $ | Image $ | Infra $ | Total Min $ | Total Max $ |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Content | Blog | Short | 13,500 | 120,000 | 0.058 | 0.180 | 0 | 0 | 0.003 | 0.008 | 0.061 |
| Content | Blog | Medium | 16,200 | 142,500 | 0.068 | 0.211 | 0 | 0 | 0.003 | 0.009 | 0.071 |
| Content | Blog | Deep | 18,900 | 157,500 | 0.076 | 0.236 | 0 | 0 | 0.003 | 0.010 | 0.079 |
| Content | Blog | Long/Pillar | 21,600 | 180,000 | 0.086 | 0.267 | 0 | 0 | 0.003 | 0.011 | 0.089 |
| Content | Newsletter | Standard | 16,200 | 135,000 | 0.065 | 0.202 | 0 | 0 | 0.003 | 0.009 | 0.068 |
| Content | Article | Standard | 16,200 | 142,500 | 0.068 | 0.211 | 0 | 0 | 0.003 | 0.009 | 0.071 |
| Content | Whitepaper | Standard | 21,600 | 195,000 | 0.094 | 0.291 | 0 | 0 | 0.003 | 0.011 | 0.097 |
| Content | Guide | Standard | 18,900 | 157,500 | 0.076 | 0.236 | 0 | 0 | 0.003 | 0.010 | 0.079 |
| Content | Story | Standard | 13,500 | 120,000 | 0.058 | 0.180 | 0 | 0 | 0.003 | 0.008 | 0.061 |
| Content | Case Study | Standard | 16,200 | 142,500 | 0.068 | 0.211 | 0 | 0 | 0.003 | 0.009 | 0.071 |
| Content | Blog (fallback) | compat-core gpt-4o | 12,000 | 134,000 | **1.070**¹ | n/a | 0 | 0 | 0.003 | 0.093 | 1.073 |
| Creator | Single Image | — | 2,100 | 6,000 | 0.004 | 0.011 | 0 | 0.020 | 0.003 | 0.012 | 0.027 |
| Creator | Banner | — | 2,100 | 6,000 | 0.004 | 0.011 | 0 | 0.020 | 0.003 | 0.012 | 0.027 |
| Creator | Infographic | — | 3,300 | 8,500 | 0.005 | 0.015 | 0 (OCR?) | 0 | 0.003 | 0.005 | 0.013 |
| Creator | Brand Card | — | 2,100 | 6,000 | 0.004 | 0.011 | 0 | 0 | 0.003 | 0.005 | 0.007 |
| Creator | Carousel | 5-slide | 3,300 | 8,500 | 0.004 | 0.013 | 0 (OCR?) | 0 | 0.003 | 0.005 | 0.011 |
| Creator | Carousel | 10-slide | 4,700 | 10,000 | 0.005 | 0.015 | 0 (OCR?) | 0 | 0.003 | 0.005 | 0.013 |
| Creator | Deck/Slider | N-page | 4,000 | 10,500 | 0.005 | 0.015 | 0 (OCR?) | 0 | 0.003 | 0.005 | 0.013 |
| Creator | PDF deck | N-page | 4,000 | 10,500 | 0.005 | 0.015 | 0 (OCR?) | 0 | 0.003 | 0.005 | 0.013 |
| Creator | Video | placeholder | 2,100 | 6,000 | 0.004 | 0.011 | 0 | 0 | 0.001 | 0.003 | 0.005 |
| Reports | Digital Presence/Snapshot | Standard | 6,000 | 84,000 | 0 | 0 | 0.080² | 0 | 0.005 | 0.008 | 0.085 |
| Reports | Snapshot | Deep | 6,000 | 84,000 | 0 | 0 | 0.080² | 0 | 0.005 | 0.008 | 0.085 |
| Reports | Performance Intelligence | Standard | 6,000 | 84,000 | 0 | 0 | 0.080² | 0 | 0.005 | 0.008 | 0.085 |
| Reports | Market Growth Intelligence | Standard | 0 | 0 | 0 | 0 | 0 | 0 | 0.005 | 0.005 | 0.005 |
| Market Pulse | Scan | Standard (1 region) | 2,700 | 12,000 | 0.005 | 0.015 | 0 | 0 | 0.003 | 0.004 | 0.008 |
| Market Pulse | Scan | Deep (N regions) | 13,500 | 180,000 | 0.072 | 0.223 | 0 | 0 | 0.005 | 0.010 | 0.077 |
| Company Profile | Onboarding refine | Full | 38,000 | 200,000 | 0.060 | 0.186 | 0 (crawl free) | 0 | 0.005 | 0.012 | 0.065 |
| Campaigns | BOLT Text | week_plan preview | 6,000 | 45,000 | 0.011 | 0.034 | 0 | 0 | 0.003 | 0.005 | 0.014 |
| Campaigns | BOLT Text | Standard (small) | 30,000 | 50,000 | 0.020 | 0.062 | 0 | 0 | 0.005 | 0.012 | 0.025 |
| Campaigns | BOLT Text | Standard (large) | 215,000 | 695,000 | 0.073 | 0.226 | 0 | 0 | 0.020 | 0.030 | 0.093 |
| Campaigns | BOLT Creator | Standard (large) | 150,000 | 450,000 | 0.070 | 0.217 | 0 | 0.110 | 0.020 | 0.045 | 0.200 |
| Campaigns | Intelligent Mix | Standard (4wk) | 100,000 | 300,000 | 0.060 | 0.186 | 0 | 0.088 | 0.020 | 0.040 | 0.168 |
| Campaigns | Intelligent Mix | MAX (12wk) | 230,000 | 900,000 | 0.174 | 0.539 | 0 | 0.264 | 0.030 | 0.090 | 0.468 |
| Campaigns | Campaign Chat | per message | 1,100 | 3,300 | 0.001 | 0.004 | 0 | 0 | 0.001 | 0.001 | 0.003 |
| Engagement | Reply Generation | per reply | 1,600 | 5,600 | 0.003 | 0.010 | 0 | 0 | 0.001 | 0.001 | 0.004 |
| Engagement | Reply Suggestion | per use | 1,300 | 2,700 | 0.001 | 0.004 | 0 | 0 | 0.001 | 0.001 | 0.002 |
| Engagement | Conversation Triage | per thread/cycle | 600 | 1,800 | 0.001 | 0.002 | 0 | 0 | 0.001 | 0.001 | 0.002 |
| Engagement | Conversation Memory | per summary | 650 | 1,900 | 0.001 | 0.003 | 0 | 0 | 0.001 | 0.001 | 0.002 |
| Engagement | Inbox/Comment Analysis | per comment | 140 | 310 | 0.0003 | 0.001 | 0 (Omnivyra?) | 0 | 0.001 | 0.001 | 0.002 |
| Engagement | Community Execution | per post | 0 | 0 | 0 | 0 | 0 (social quota) | 0 | 0.001 | 0.001 | 0.001 |
| Active Leads | Lead Qualification | Reactive (per post) | 500 | 1,150 | 0.0005 | 0.002 | 0 (listening) | 0 | 0.001 | 0.001 | 0.002 |
| Active Leads | Lead Qualification | Predictive (per post) | 520 | 1,200 | 0.0005 | 0.002 | 0 | 0 | 0.001 | 0.001 | 0.002 |
| Recommendations | /generate | per request | 0 | 6,300 | 0.003 | 0.010 | 0 (trend-API) | 0 | 0.001 | 0.001 | 0.004 |
| Recommendations | /long-form | per request | 6,000 | 36,000 | 0.022 | 0.068 | 0 | 0 | 0.001 | 0.002 | 0.023 |
| Recommendations | /campaigns | per request | 1,800 | 6,300 | 0.004 | 0.012 | 0 | 0 | 0.001 | 0.001 | 0.005 |
| Analytics | All services | read | 0 | 0 | 0 | 0 | 0 | 0 | 0.001 | 0.001 | 0.001 |

¹ Fallback path: 6 gpt-4o body calls @ up to 16,384 out. Rare (error path) but the costliest single content event.
² Snapshot External $ = up to ~60 visibility probes across 5 providers on cold cache, Perplexity-weighted; $0.003 warm/few-provider. SERP excluded (cron, not per-report).

---

## §14 — VALIDATION
| Check | Status |
|---|---|
| ✓ Every content variant (Blog ×4, Newsletter, Article, Whitepaper, Guide, Story, Case Study, fallback) | ✅ §2 + master |
| ✓ Every creator variant (Image, Banner, Infographic, Brand Card, Carousel 5/10/N, Deck, PDF, Video) | ✅ §3 + master |
| ✓ Every report (Snapshot Std/Deep, Performance, Growth, Market Pulse Std/Deep, Company Profile) | ✅ §4 + master |
| ✓ Every campaign (BOLT Text preview/std, BOLT Creator, Intel Mix 4wk/12wk, Chat) | ✅ §5 + master |
| ✓ Every engagement activity (Reply Gen/Suggest, Triage, Memory, Inbox, Community Exec) | ✅ §6 + master |
| ✓ Every active-lead activity (Reactive, Predictive, scheduled scan) | ✅ §7 + master |
| ✓ Every external vendor (OpenAI, Anthropic, Google, Perplexity, Azure, SerpAPI, DataForSEO, ScaleSERP, Ahrefs, Wikidata, Unsplash/Pexels/Pixabay, OCR, WhatsApp/Meta, Stripe, email, Railway, Supabase, Upstash, Vercel, Cloudflare) | ✅ §8 |
| ✓ Every social platform (LinkedIn, X, IG, FB, YouTube, TikTok, Pinterest, Threads, Reddit, WordPress, WhatsApp, +community) | ✅ §9 |
| ✓ Every recurring background process | ✅ §11 |

### Honest gaps (NOT verified — would be fabrication to state as fact)
1. **Exact token counts** — system doesn't tiktoken-count; §2–§7 token figures are [EST] from caps + prompt size, not measured. To harden: log real `usage` from `aiGateway.ts:1656` over a sample period.
2. **GPT-5.5-mini** — does not exist; all [HYPO] cells use an assumed $0.25/$2.00 rate purely for scenario math.
3. **Infra $** — [PLAN] public pricing; true cost needs Railway/Supabase/Upstash/Vercel invoices. Per-activity infra allocation is a nominal estimate.
4. **OCR vendor + WhatsApp/Meta + email provider** — unit prices unknown from repo; flagged where they appear.
5. **Vendor list prices drift** — re-validate the §8 rate card against live pricing before pricing decisions.
6. **Probe blended cost** — depends on which providers are keyed in prod; modelled worst-case at 5 providers.

> **Bottom line for pricing design:** per-action LLM cost is **cents, not dollars** (content $0.01–0.09; campaigns $0.01–0.47; reports $0.01–0.09 mostly external-probe). The real cost concentrations are (1) the **gpt-4o fallback path** (up to ~$1/blog — worth eliminating), (2) **image generation** on visual campaigns, and (3) **recurring background AI** (lead qualify + triage) which is tiny per call but runs millions of times/month. Credit pricing should be driven by **call-count × model-tier**, with the §8 caps as the natural metering unit.
