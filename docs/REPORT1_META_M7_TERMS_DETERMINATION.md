# REPORT 1 — META M7 TERMS DETERMINATION AND OWNER DECISION RECORD

2026-10-17. **No Meta endpoint contacted. No credential provisioned. No flag changed. No provider
activated. The candidate was not edited. No durable-history test started; `cert-supabase` not used.**

**This record does not choose an interpretation.** Where official text is ambiguous it says so and
supplies the question to put to Meta Developer Support or counsel.

---

## 1. THE EXACT PROPOSED USE — from the candidate only

### Endpoint and request

| | |
|---|---|
| Endpoint | `GET https://graph.facebook.com/v21.0/ads_archive` |
| Fixed parameters | `ad_type=ALL` · `ad_active_status=ALL` · `ad_reached_countries=<EU27+GB subset>` · `limit=100` |
| Search parameters | `search_terms` (≤100 chars) + `search_type=KEYWORD_UNORDERED`, **or** `search_page_ids=[<one id>]` |
| Paging | Follows `paging.next`, ceiling **5 pages** (`META_DEFAULT_MAX_PAGES`), stops when `data` is empty. Rows deduplicated on ad `id` across pages |
| Transport | Injected; no network call exists in any test |

### Fields requested — and the gap that matters

`AD_FIELDS` requests **twelve** fields:

```
id, page_id, page_name,
ad_creative_bodies, ad_creative_link_titles, ad_creative_link_captions,
ad_creative_link_descriptions, ad_delivery_start_time, ad_delivery_stop_time,
ad_snapshot_url, publisher_platforms, languages
```

**The mapping code reads exactly three of them.** Verified by grep across the whole client:

| Field | Requested | Read in mapping code |
|---|---|---|
| `id` | yes | **yes** (2 sites) → `creativeIds`, and the dedup key |
| `page_id` | yes | **yes** (1 site) → `advertiserId` |
| `page_name` | yes | **yes** (3 sites) → `name` / `legalName` |
| `ad_creative_bodies` | yes | **no** |
| `ad_creative_link_titles` | yes | **no** |
| `ad_creative_link_captions` | yes | **no** |
| `ad_creative_link_descriptions` | yes | **no** |
| `ad_delivery_start_time` | yes | **no** |
| `ad_delivery_stop_time` | yes | **no** |
| `ad_snapshot_url` | yes | **no** |
| `publisher_platforms` | yes | **no** |
| `languages` | yes | **no** |

Those nine appear only in the `MetaArchivedAd` **type declaration** and the request list. **No
value of any of them is ever read, stored or returned.**

### What is actually retained

| Returned field | Content |
|---|---|
| `advertiserId` | the Facebook **Page id** |
| `name` / `legalName` | the Facebook **Page display name** |
| `creativeIds` | **Ad Library ad IDs** — identifiers, *not* creative content. The name is a misnomer inherited from the Google-shaped interface and should not be read as "creative stored" |
| `verified` | always `false` — Meta publishes no identity assertion for commercial advertisers |
| `basedIn`, `adCountLabel` | always `null` |
| `ambiguityFlagged` | derived locally from Page-name collisions |
| `profileUrl` | a constructed **public** Ad Library link, `facebook.com/ads/library/?view_all_page_id=…` |

**So: no creative text, no media, no snapshots, no delivery windows, no platform list, no languages.
Three identifier/name fields plus locally derived flags.** Persistence goes through the existing
`adsEvidenceStore` (append-only, company- and domain-scoped), storing the observation shape above.

### Intended customer-facing functionality

**Commercial competitor and brand monitoring** inside Report 1: whether public advertising is
observable for a subject company and for competitors, presented to a paying customer. This is a
commercial product, not academic research — stated plainly because it is the crux of §2.

### Constraints already in the implementation

- **UK/EU delivery boundary.** Non-political ads exist in the archive only where the ad delivered to
  the EU (and, per Meta's API page, the UK). A subject outside that boundary yields `unavailable`
  with a coverage reason — **never** an empty `observed`, and never "does not advertise".
- **Strict `MATCHED`-only identity.** `MATCHED` requires `advertiser.verified`; Meta provides no
  such assertion commercially, so every Meta record caps at `PROBABLE_MATCH` with
  `eligibleForCompanyClaim: false`. **Meta evidence can never support a company-specific claim.**
- **No performance data.** `spend`, `impressions`, `currency`, `bylines` and the demographic fields
  are political-only and are **never requested**.
- **Inactive in production.** `ADS_TRANSPARENCY_ACQUISITION_ENABLED` is absent, and no Meta client
  is registered with the acquisition cycle.

---

## 2. THE GOVERNING TERMS — textual support vs interpretation

### 2.1 There is no standalone "Ad Library API terms" document

Searching Meta's own domains returns no such document. Access is obtained through a **Meta for
Developers** app, and Meta's own access instructions state that as part of account creation "you'll
need to agree to our **Platform Policy**". Meta's terms page states that use of the Meta for
Developers Platform "will be subject to the **Platform Terms**".

### 2.2 Meta Platform Terms — direct textual support

From `developers.facebook.com/terms/`:

| Clause | Text | Relevance |
|---|---|---|
| **3.a.viii** | Prohibits "Processing Platform Data for purposes other than the applicable **permitted purposes set forth in Meta's Developer Docs**" | **The pivotal clause.** It delegates permitted purpose to the *Developer Docs*, so the Ad Library API's own documentation defines the limit |
| **3.a.iv** | Prohibits "**Selling, licensing, or purchasing Platform Data**" | The central question for a paid product |
| **3.c** | Sharing permitted only in listed circumstances (legal requirement; Service Providers for requested services) | Bears on showing Meta-derived evidence to a customer |
| **3.d.i.2** | Must "**Delete all Platform Data as soon as reasonably possible**" when retention is no longer necessary for a legitimate business purpose | Bears on durable retention of ad observations |
| **3.d.i.1** | Must "Update or delete Platform Data promptly after receiving a request from us or the User to do so" | An **operational capability** requirement |
| **3.d.i.2.d** | Deletion required when a User requests it or no longer has an account — "unless the data is aggregated or de-identified" | A possible safe harbour |
| **3.a.vi** | Prohibits attempts to "re-identify" or "reverse-engineer Platform Data" | Not engaged by this use |
| **2.a** | Will not "sell, transfer, or sublicense Platform" | Platform, not Platform Data |

**There is no non-commercial restriction and no competing-product/benchmarking prohibition in the
Platform Terms.** That is a material difference from the Research Tools terms.

### 2.3 Ad Library API documentation — permitted purpose

The API documentation states that if you download ad creative for an individual ad, **"it must be
for analysis"** and you **"must comply with the data storage terms in our Terms of Service"**, and
that a **batch of archived ads cannot currently be downloaded**.

Via 3.a.viii this is not merely guidance — it is the "permitted purpose set forth in Meta's
Developer Docs" that the Platform Terms make binding.

### 2.4 Research Tools terms — do they reach `ads_archive`?

The Research Tools product terms restrict Research to "**non-commercial purposes** for science or in
the public interest" (§2(p)); prohibit commercially exploiting the data (§5(b)(v)); bar use "in
connection with the development of a competing product or **for benchmarking purposes**"
(§5(b)(vii)); and tie eligibility to an **Institution** (§2(i)) with application via Research Tools
Manager (§3(a)).

**If these govern `ads_archive`, the intended use is barred outright.**

§1 enumerates the covered tools as the **Meta Content Library UI**, the **Meta Content Library API**
and the **Ads Transparency and Targeting Dataset**. The Ad Library API is not among them, and §2(r)'s
reach "cannot be confirmed from the document".

**Per instruction, omission alone is not treated as exclusion.** What *is* textual support pointing
away from Research Tools is affirmative and independent: the Ad Library API's own access path runs
through a Meta for Developers app and **Platform Policy** agreement, and Meta's terms page routes
Developers Platform use to the **Platform Terms**. Those are positive statements about a different
governing instrument — not an inference from silence. **They still do not state that the Research
Tools terms are inapplicable**, so the question remains open.

### 2.5 Adjacent restriction, assessed and set aside

Meta's Advertising Standards restrict use of "Meta advertising data" except on an aggregate and
anonymous basis and "only to assess the performance and effectiveness of **your** Meta advertising
campaigns". On its face this addresses **advertisers** handling data about their own campaigns, not a
developer reading the public archive. **Recorded as probably not engaged, not relied upon.**

---

## 3. THE UNRESOLVED INTERPRETATIONS

Five, each stated as the precise question rather than a chosen answer.

| # | Unresolved interpretation | Why it is genuinely open |
|---|---|---|
| **M7.1** | **Do the Research Tools non-commercial terms govern `ads_archive`, in addition to or instead of the Platform Terms?** | The Research Tools terms enumerate three other products; the Ad Library API's access path points to Platform Policy/Platform Terms. Neither text says whether Research Tools terms reach this endpoint. **If they do, the intended use is barred and the Meta workstream ends** |
| **M7.2** | **What is the "permitted purpose set forth in Meta's Developer Docs" (3.a.viii) for `ads_archive`?** The docs say creative download "must be for analysis". Is **commercial competitor and brand monitoring sold to a customer** "analysis"? | "Analysis" is undefined in the docs. The implementation performs observation and presentation, not creative or spend analysis — but it is sold |
| **M7.3** | **Does presenting Meta-derived observations in a paid customer report constitute "selling Platform Data" (3.a.iv), or permitted sharing (3.c)?** | Omnivyra would sell a *product informed by* the data, not the data itself. 3.a.iv bars selling Platform Data; 3.c limits sharing to listed circumstances, and "showing a customer their competitor's Page name" is not obviously among them. **The most consequential question for the business model** |
| **M7.4** | **Does durable retention of ad observations satisfy 3.d.i.2** — "delete as soon as reasonably possible" once no longer necessary for a legitimate business purpose? | Report 1 persists observations as historical evidence, i.e. indefinitely by design. Whether historical comparison is a "legitimate business purpose" that licenses indefinite retention is not addressed |
| **M7.5** | **Can the deletion obligation in 3.d.i.1 be honoured?** Meta or a User may demand deletion of Platform Data | **This is a capability gap, not only an interpretation.** No mechanism exists today to locate and delete stored Meta-derived observations on request. 3.d.i.2.d's "aggregated or de-identified" carve-out may not help, because `page_id` and `page_name` are identifiers |

**M6** (is paging "analysis" rather than a prohibited batch download?) is now **anchored**: via
3.a.viii the docs' "must be for analysis" is binding, and the no-batch-download statement appears in
the same place. **Still unresolved**, but it is the same question as M7.2 rather than a separate one.

### A fact that materially improves the position

The client **reads only `id`, `page_id` and `page_name`** (§1). It therefore:

- downloads **no ad creative**, so the docs' creative-download condition is arguably not engaged at all;
- performs **no landing-page tracking** (`searchByDomain` is deliberately unimplemented — the archive exposes no destination URL);
- performs **no spend analysis** (those fields are political-only and never requested).

The third-party claim that commercial "competitor ad creative, landing page tracking, spend
analysis" use would be rejected describes **none of what this implementation does.** That is worth
putting in front of Meta or counsel, because it narrows the question considerably.

**But the nine requested-and-discarded fields weaken that argument**, since the system *does*
request creative text and snapshot URLs even though it throws them away. See §4 option 2.

---

## 4. RELEASE DECISION REQUIRED

### Option 1 — Proceed, only once permission is established

Requires affirmative answers to **M7.1-M7.5** plus the access prerequisites **M1-M5**.

- **Blocked today.** No official text resolves M7.1-M7.3, and M7.5 is an unbuilt capability.
- A token would not change this. **Technical ability to obtain access is not permission for
  commercial use**, and that distinction is the whole point of this record.

### Option 2 — Narrow the data profile, then re-ask (**recommended first move**)

A concrete, minimal change that strengthens every open question at once:

| Change | Effect |
|---|---|
| Reduce `AD_FIELDS` from twelve fields to **`id,page_id,page_name`** | The system **never receives** creative text, snapshot URLs, delivery windows, platform lists or languages. The creative-download condition is then plainly not engaged, and the Platform Data retained is minimised to three identifier/name fields |
| Optionally drop `creativeIds`, or rename it to `observedAdIds` | Removes a misleading name from any future terms review; the IDs themselves are the smallest possible evidence of observation |
| Define a retention window and a deletion path | Directly addresses **M7.4** and **M7.5** rather than leaving them open |

This is a **nine-line deletion plus a rename** — it removes capability the code never used. It does
not weaken any Report 1 claim, because none of those fields reaches the report today.

**It is a code change**, so it changes the candidate and **invalidates L13**, and it is **not
authorized by this task.** I have not made it.

### Option 3 — Defer or remove Meta from the release scope

- **Defer:** keep the client in the candidate, inactive, flag absent, and ship Report 1 without Meta
  evidence. Costs nothing already built; the code is dormant and proven not to activate.
- **Remove:** drop the client from the release scope entirely, which also changes the candidate.

**Deferral is the lowest-risk option that preserves the work**, and it is compatible with settling
M7 on a longer timescale. It does, however, mean Report 1 ships with **Google-only** advertising
coverage — which must be stated accurately in any release note, per the earlier finding that
Google-only coverage must never be described as Meta support.

---

## 5. THE QUESTION TO SEND

To **Meta Developer Support**, and in parallel to qualified counsel:

> **Subject: Governing terms and permitted purpose for `ads_archive` (Ad Library API) in a
> commercial product**
>
> We operate a commercial B2B SaaS product that reports on a customer's public digital presence,
> including whether public advertising is observable for the customer and for named competitors.
> We would access the Ad Library API via `GET /ads_archive` with `ad_type=ALL` and
> `ad_reached_countries` limited to the EU/UK.
>
> **What we would retain:** only three fields per ad — `id`, `page_id` and `page_name` — plus a
> locally constructed public Ad Library link. We would **not** retain or display ad creative text,
> `ad_snapshot_url`, media, delivery dates, publisher platforms or languages, and we would not
> request political-only fields such as `spend`, `impressions` or `bylines`. We perform no
> landing-page tracking and no spend analysis.
>
> Please confirm:
>
> 1. Is `ads_archive` governed by the **Meta Platform Terms**, by the **Research Tools product
>    terms** (whose §2(p) limits use to non-commercial research and whose §5(b)(vii) bars
>    benchmarking), or by both?
> 2. Under Platform Terms **3.a.viii**, what is the **permitted purpose** for `ads_archive` as set
>    out in the Developer Docs, and does commercial competitor/brand monitoring fall within it?
> 3. Does displaying such observations to a paying customer constitute "selling… Platform Data"
>    under **3.a.iv**, or is it permitted under **3.c**?
> 4. Under **3.d.i.2**, may ad observations be retained indefinitely as historical evidence for
>    period-over-period comparison, or is a retention limit required?
> 5. Under **3.d.i.1**, what deletion mechanism is expected for stored ad observations keyed by
>    `page_id`, and does the "aggregated or de-identified" carve-out in **3.d.i.2.d** apply?
> 6. Is **identity confirmation** at `facebook.com/ID` required to *read* non-political UK/EU ads,
>    or only to *run* political/social-issue ads? Is **Business Verification** or **App Review**
>    required for this endpoint?

Questions 1-5 are for Meta **and** counsel; 6 is for Meta.

---

## 6. STATUS

| | |
|---|---|
| **M7** | **UNRESOLVED** — split into M7.1-M7.5, each with the precise open question. No interpretation chosen |
| M6 | **UNRESOLVED**, now anchored to Platform Terms 3.a.viii + the Developer Docs "must be for analysis"; it is the same question as M7.2 |
| M1-M5 | **UNRESOLVED** — access prerequisites, unchanged |
| Candidate | **UNCHANGED.** Base `5604b50b`, tracked diff `9bc40eeefa252cd8…`, untracked hashes `2ac79b6c…` / `d607d9ad…` / `b0a19dc6…`. **L13 remains valid** |
| Implementation | Unchanged. UK/EU boundary and strict `MATCHED`-only rule intact. Provider inactive; flag absent |
| D1-D3 | Untouched — separate owner decisions. No durable-history test started; `cert-supabase` not used |

### Sources

Official: [Meta Platform Terms](https://developers.facebook.com/terms/) ·
[Ad Library API](https://www.facebook.com/ads/library/api) ·
[`ads_archive` reference](https://developers.facebook.com/docs/graph-api/reference/ads_archive/) ·
[ArchivedAd node](https://developers.facebook.com/docs/marketing-api/reference/archived-ad/) ·
[Research Tools product terms](https://transparency.meta.com/researchtools/product-terms-meta-research/) ·
[Ad Library tools](https://transparency.meta.com/researchtools/ad-library-tools/) ·
[Advertising Standards](https://transparency.meta.com/policies/ad-standards/) ·
[Permissions Reference](https://developers.facebook.com/docs/permissions) ·
[Terms & Conditions index](https://www.facebook.com/legal/terms_conditions)

**No third-party source is relied upon in this determination.**

---

**M7 UNRESOLVED — OWNER / LEGAL DETERMINATION REQUIRED BEFORE FURTHER META INVESTMENT**
