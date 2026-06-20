# OMNIVYRA — CONSUMPTION & COST RANGE CATALOG

**The definitive per-activity consumption + cost-range catalog** for token→cost→credit mapping, free-trial design, capacity modeling, and pricing.
2026-06-17. Every value is derived from documented evidence — not intuition.

> ### Evidence basis (Section 3 — model assumptions)
> **Token ranges** = actual code caps + structure: `OPERATION_OUTPUT_TOKENS` (`jobCostEstimator.ts:49-75`), planned-section cap `min(5000,max(1800,wt×3.2))`, body cap `≤16384`, call-count structures from `OMNIVYRA_COST_ACTIVITY_INVENTORY.md`. Min = lowest supported workload, Typical = expected real-world (avg call count), Max = highest supported variant.
> **Model pricing (production, public list — matches the in-code tables `jobCostEstimator.ts:37-38`, `costGovernance.ts:94-105`):**
> - `gpt-4o-mini` (DEFAULT, ~all text): **$0.15/1M in · $0.60/1M out** → blended ≈ **$0.33–0.48/1M** (output-ratio dependent)
> - `gpt-4o` (blog/long-form fallback only): $2.50/$10 per 1M — the single ~$1 outlier; flagged, not a normal input
> - `gpt-image-1` (low, 1024²): **~$0.011/image** (range $0.01–0.02)
> - Whisper transcription: **$0.006/min**
> - Visibility probes (reports): chatgpt $0.15/$0.60, claude $0.80/$4.00, gemini $0.075/$0.30, **perplexity $1.00/$1.00**, copilot $0.15/$0.60 per 1M
> - SERP (background cron only): dataforseo $0.002, serpapi/scaleserp $0.01 per query
> - Social platform APIs: **$0** (free quota, rate-limited)
> **Infra allocation** = per-job share of the fixed Railway worker + Redis/queues + Supabase + Vercel (`OMNIVYRA_COST_ACTIVITY_INVENTORY.md §10`); modeled per-activity by queue/worker involvement. Largely **fixed cost amortized**, so per-activity it's a nominal $0.0005–$0.05.
> **Value Index (1–10)** = customer-perceived outcome value (design judgment per the pricing architecture), explicitly NOT internal cost.
> All $ are modeled (list prices + estimated infra), not invoiced — calibrate against SHADOW-mode actuals before locking credit costs.

---

## SECTION 9 — MASTER CATALOG (the required output)

`Total = AI + API + Image + Infra` (infra detailed in §6; folded into Total per §7). Costs in USD.

| Activity | Min Tok | Typ Tok | Max Tok | Min AI $ | Typ AI $ | Max AI $ | Min API $ | Typ API $ | Max API $ | Min Img $ | Typ Img $ | Max Img $ | Min Total $ | Typ Total $ | Max Total $ | Value |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **CONTENT** |
| Blog | 13,500 | 40,000 | 180,000 | 0.0050 | 0.0180 | 0.0860¹ | 0 | 0 | 0 | 0 | 0 | 0 | 0.0060 | 0.0200 | 0.0910 | 6 |
| Article | 16,200 | 45,000 | 142,500 | 0.0060 | 0.0200 | 0.0680 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0070 | 0.0220 | 0.0730 | 5 |
| Post | 1,500 | 5,000 | 12,000 | 0.0007 | 0.0023 | 0.0054 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0010 | 0.0030 | 0.0060 | 2 |
| Thread | 3,000 | 10,000 | 25,000 | 0.0014 | 0.0045 | 0.0110 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0020 | 0.0055 | 0.0125 | 3 |
| Story | 8,000 | 25,000 | 120,000 | 0.0036 | 0.0110 | 0.0580 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0040 | 0.0130 | 0.0610 | 4 |
| **CREATOR** |
| Image | 2,100 | 4,000 | 6,000 | 0.0010 | 0.0018 | 0.0027 | 0 | 0 | 0 | 0.0110 | 0.0110 | 0.0200 | 0.0140 | 0.0160 | 0.0270 | 5 |
| Banner | 2,100 | 4,000 | 6,000 | 0.0010 | 0.0018 | 0.0027 | 0 | 0 | 0 | 0.0110 | 0.0110 | 0.0200 | 0.0140 | 0.0160 | 0.0270 | 4 |
| Carousel | 3,300 | 6,500 | 11,000 | 0.0015 | 0.0030 | 0.0050 | 0 | 0 | 0² | 0 | 0 | 0 | 0.0035 | 0.0060 | 0.0100 | 5 |
| Infographic | 3,300 | 6,000 | 8,500 | 0.0015 | 0.0027 | 0.0048 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0035 | 0.0057 | 0.0098 | 5 |
| **CAMPAIGNS** |
| BOLT Campaign | 6,000 | 150,000 | 695,000 | 0.0030 | 0.0400 | 0.0730 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0080 | 0.0600 | 0.1230 | 8 |
| BOLT Creator Campaign | 150,000 | 300,000 | 450,000 | 0.0400 | 0.0600 | 0.0700 | 0 | 0 | 0 | 0.0220 | 0.0550 | 0.1100 | 0.0720 | 0.1350 | 0.2200 | 8 |
| Intelligent Mix Campaign | 100,000 | 300,000 | 900,000 | 0.0400 | 0.1000 | 0.1740 | 0 | 0 | 0 | 0.0200 | 0.0880 | 0.2640 | 0.0700 | 0.2180 | 0.4880 | 9 |
| Strategic Campaign³ | 200,000 | 500,000 | 900,000 | 0.0800 | 0.1300 | 0.1740 | 0.0100 | 0.0300 | 0.0800 | 0.0500 | 0.1300 | 0.2640 | 0.1600 | 0.3300 | 0.5780 | 10 |
| **INTELLIGENCE** |
| Digital Snapshot | 6,000 | 40,000 | 84,000 | 0 | 0 | 0 | 0.0030 | 0.0300 | 0.0850 | 0 | 0 | 0 | 0.0060 | 0.0350 | 0.0950 | 8 |
| Growth Intelligence | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0030 | 0.0050 | 0.0100 | 8 |
| Market Pulse | 2,700 | 12,000 | 180,000 | 0.0010 | 0.0050 | 0.0720 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0040 | 0.0100 | 0.0820 | 7 |
| **ENGAGEMENT** |
| Reply Generation | 1,600 | 3,000 | 5,600 | 0.0007 | 0.0014 | 0.0024 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0010 | 0.0020 | 0.0030 | 2 |
| Inbox Analysis | 140 | 250 | 310 | 0.0001 | 0.0001 | 0.0002 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0006 | 0.0007 | 0.0008 | 1 |
| Conversation Triage | 600 | 1,200 | 1,800 | 0.0003 | 0.0005 | 0.0008 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0008 | 0.0010 | 0.0013 | 1 |
| **LEADS** |
| Active Leads Discovery (per scan) | 5,000 | 40,000 | 150,000 | 0.0020 | 0.0180 | 0.0680 | 0.0010 | 0.0050 | 0.0200 | 0 | 0 | 0 | 0.0080 | 0.0330 | 0.1180 | 8 |
| Lead Qualification (per post) | 500 | 800 | 1,200 | 0.0002 | 0.0004 | 0.0005 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0007 | 0.0010 | 0.0015 | 6 |
| Lead Enrichment⁴ | 0 | 500 | 1,500 | 0 | 0.0002 | 0.0007 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0005 | 0.0010 | 0.0020 | 5 |
| **VOICE & UTILITIES** |
| Voice Transcription⁵ | n/a | n/a | n/a | 0.0060 | 0.0180 | 0.0600 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0070 | 0.0190 | 0.0610 | 3 |
| Content Repurposing | 2,000 | 5,000 | 12,000 | 0.0010 | 0.0023 | 0.0054 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0015 | 0.0030 | 0.0060 | 3 |
| Platform Adaptation (per platform) | 1,100 | 2,500 | 6,000 | 0.0005 | 0.0011 | 0.0027 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0010 | 0.0016 | 0.0032 | 3 |
| **BACKGROUND INTELLIGENCE** (per run/cycle) |
| Market Pulse Monitoring | 2,700 | 12,000 | 180,000 | 0.0010 | 0.0050 | 0.0720 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0040 | 0.0080 | 0.0750 | 3 |
| Active Leads Monitoring | 5,000 | 40,000 | 150,000 | 0.0020 | 0.0180 | 0.0680 | 0.0010 | 0.0050 | 0.0200 | 0 | 0 | 0 | 0.0080 | 0.0330 | 0.1180 | 3 |
| Recommendation Generation | 0 | 600 | 6,300 | 0 | 0.0003 | 0.0030 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0010 | 0.0020 | 0.0080 | 4 |
| Campaign Intelligence⁶ | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0010 | 0.0020 | 0.0050 | 3 |
| Content Intelligence⁶ | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0010 | 0.0020 | 0.0050 | 3 |
| Credit Advisor Intelligence⁷ | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0.0005 | 0.0010 | 0.0020 | 4 |

**Footnotes:** ¹ Blog max AI is the planned-engine figure; the gpt-4o compatibility-fallback path can reach **~$1.07** (6 body calls @16,384 out) — a defect to cap, not a normal cost. ² Carousel max API = optional OCR HTTP only if `CREATOR_OCR_ENDPOINT` configured (else 0). ³ "Strategic Campaign" = the highest-tier orchestration (Intelligent Mix 12-wk + intelligence enrichment); add `full_strategy` intel probes. ⁴ Lead Enrichment is largely DB rollup/clustering (`leadClusterService`, deterministic, ~0 AI). ⁵ Voice = Whisper, priced per audio-minute ($0.006/min): min 1 min, typ 3 min, max 10 min; tokens n/a (audio). ⁶ Campaign/Content Intelligence are **deterministic** (no AI gateway) — cost is worker compute only. ⁷ Credit Advisor is **100% read-only/deterministic** — SELECT-only, zero AI.

---

## SECTION 2 — TOKEN CONSUMPTION (min / typical / max)
See master table cols 2–4. Key structural drivers (all [CODE]/[EST]):
- **Content** scales with `target_word_count` → section count → repair passes (planned engine: 1 plan + 1/section + ≤3 repair gates).
- **Campaigns** = planning (1–3 LLM) + **fan-out** (rows = Σfrequency×weeks; each row 1 uncapped master + 1–2 variants/platform). Max token figures are the large-campaign worst cases.
- **Reports** = up to 60 visibility probes (5 providers × ≤12 queries) — counted as API tokens, not gpt-4o-mini.
- **Background intelligence** is mostly **0 tokens** (deterministic).

## SECTION 3 — AI COSTS
See cols 5–7 + the model-assumptions header. gpt-4o-mini effective ≈ $0.33–0.48/1M (output-heavy). The only non-mini AI path is the blog gpt-4o fallback (footnote 1).

## SECTION 4 — IMAGE COSTS
Only **Image** and **Banner** (and the image/banner rows inside BOLT Creator / Intelligent Mix / Strategic campaigns) incur `gpt-image-1` cost (~$0.011 typ, $0.02 max each). **Carousel, Infographic, Deck, Brand Card generate ZERO images** (SVG+sharp render) — a critical, counter-intuitive fact. "Blog assets" use stock-image *search* (Unsplash/Pexels/Pixabay, free) unless a creator image is explicitly generated.

## SECTION 5 — EXTERNAL API COSTS
| Provider | Used by | Per-unit | In which activities |
|---|---|---|---|
| Perplexity / OpenAI / Anthropic / Gemini / Azure (visibility probes) | Digital Snapshot, Performance, deep Market Pulse | per-1M probe tokens | Reports/Intelligence (API cost col) |
| DataForSEO / SerpAPI / ScaleSERP | SERP warehouse (**cron only**, not inline) | $0.002–$0.01/query | Background SERP acquisition (not charged to a user action) |
| Ahrefs / Wikidata | Snapshot authority/KG (if keyed) | subscription / free | Digital Snapshot |
| Reddit/HN/LinkedIn connectors | Lead/engagement listening | per scan call | Active Leads Discovery/Monitoring (API col) |
| Social platform APIs (X, LinkedIn, Meta, YouTube, …) | Publishing + polling | **$0** (quota) | Engagement/publishing |
| WhatsApp (Meta) | Messaging | per-conversation (Meta) | (not in current activity set) |

The dominant per-action API cost is **report visibility probes** (Perplexity-weighted, up to ~$0.085/snapshot cold). SERP is background-only, so it doesn't load per-user-action cost.

## SECTION 6 — INFRASTRUCTURE ALLOCATION (min / typical / max, folded into Total)
| Activity class | Min | Typ | Max | Basis |
|---|---|---|---|---|
| Light sync (replies, inbox, triage, post) | 0.0003 | 0.0005 | 0.001 | API request only |
| Content (blog/article/story) | 0.001 | 0.002 | 0.005 | 1 queue job + DB |
| Creator (render queue) | 0.002 | 0.003 | 0.005 | render worker + sharp CPU |
| Campaign | 0.005 | 0.020 | 0.050 | many queue jobs + worker time |
| Reports/Intelligence | 0.003 | 0.005 | 0.010 | inline + DB |
| Lead discovery (scan worker) | 0.005 | 0.010 | 0.030 | scan job + per-post loop |
| Background recurring (per run) | 0.001 | 0.002 | 0.005 | cron tick + DB |
| Credit Advisor / deterministic | 0.0005 | 0.001 | 0.002 | SELECT-only |

Infra is overwhelmingly **fixed** (one 24/7 Railway worker + Redis + Supabase + Vercel, low-hundreds $/mo total) and amortizes down as volume grows — per-activity allocation is nominal.

## SECTION 7 — TOTAL COST RANGE
See master cols 14–16 (`AI + API + Image + Infra`). Headlines: most activities cost **fractions of a cent to a few cents**; the expensive tail is **campaigns** (up to ~$0.49–0.58 for Intelligent Mix/Strategic, image- and fan-out-driven) and **reports** (~$0.095 cold). The blog gpt-4o fallback is the one outlier to fix.

## SECTION 8 — CUSTOMER VALUE INDEX (1–10, perceived value ≠ cost)
The deliberate divergence between cost and value (the whole point of credit pricing):
- **Cost-cheap / value-high:** Growth Intelligence (≈$0.005 cost, value 8), Market Pulse, Digital Snapshot, Lead Qualification.
- **Cost-high / value-high (aligned):** Intelligent Mix / Strategic campaigns (value 9–10).
- **Cost-low / value-low (aligned):** Inbox Analysis, Triage, Reply (value 1–2).
- Social Post (2) ≠ Whitepaper-class long Blog (6); Reply Suggestion (1) ≠ Strategic Campaign (10) — as required.

---

## SECTION 10 — VALIDATION
| Check | Status |
|---|---|
| ✓ All customer-facing activities | ✅ Content(5) · Creator(4) · Campaigns(4) · Intelligence(3) · Engagement(3) · Leads(3) · Voice&Utilities(3) |
| ✓ All campaigns | ✅ BOLT · BOLT Creator · Intelligent Mix · Strategic |
| ✓ All creator assets | ✅ Image · Banner · Carousel · Infographic |
| ✓ All intelligence activities | ✅ Digital Snapshot · Growth Intelligence · Market Pulse |
| ✓ All engagement activities | ✅ Reply · Inbox Analysis · Triage |
| ✓ Voice transcription | ✅ Whisper $0.006/min |
| ✓ Background intelligence | ✅ MP Monitoring · Leads Monitoring · Recommendation · Campaign Intel · Content Intel · Credit Advisor |
| ✓ External APIs | ✅ §5 (probes, SERP, connectors, social, Ahrefs) |
| ✓ Cost ranges calculated | ✅ min/typ/max for tokens, AI, API, image, infra, total |
| ✓ Value index | ✅ all rows |

**Catalog is usable for:** Token→Credit conversion (tokens + total-cost per activity), subscription capacity modeling (typical cost × expected volume), and final pricing (cost floor + value index → credit price). 

> **Two non-negotiables before this catalog drives real billing:** (1) cap the **gpt-4o blog-fallback** (the only line that breaks the cents-scale cost model), and (2) run credit metering in **SHADOW** to replace these *modeled* token figures with *measured* `usage` from `aiGateway.ts:1656` — the system does not tiktoken-count, so the token columns are structure-derived estimates until calibrated on live data.
