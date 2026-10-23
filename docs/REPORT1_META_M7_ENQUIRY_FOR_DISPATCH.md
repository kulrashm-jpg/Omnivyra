# REPORT 1 — META M7 ENQUIRY, PREPARED FOR OWNER DISPATCH

2026-10-17. **Prepared for the release owner to send. NOT SENT.**

**No code change. No commit. No credential. No live Meta call. No provider activation. No
acquisition-flag change. The candidate is unchanged and L13 remains valid** (§6).

**Release decision of record: META ACQUISITION DEFERRED PENDING M7 DETERMINATION.** Nothing in this
document approves the integration for commercial use.

---

## 1. ACCURACY VERIFICATION OF THE ENQUIRY'S FACTUAL CLAIM

The enquiry's credibility rests on one claim: that only three fields are retained. **Re-verified
against the candidate this pass**, per-field, by searching for any read of the value
(`row.<field>`, `?.<field>`, `.<field>)`):

| Field | Requested in `AD_FIELDS` | Value-reads in the client |
|---|---|---|
| `id` | yes | **2** |
| `page_id` | yes | **1** |
| `page_name` | yes | **3** |
| `ad_creative_bodies` | yes | **0** |
| `ad_creative_link_titles` | yes | **0** |
| `ad_creative_link_captions` | yes | **0** |
| `ad_creative_link_descriptions` | yes | **0** |
| `ad_delivery_start_time` | yes | **0** |
| `ad_delivery_stop_time` | yes | **0** |
| `ad_snapshot_url` | yes | **0** |
| `publisher_platforms` | yes | **0** |
| `languages` | yes | **0** |

**Twelve requested, three read.** The other nine appear only in the `MetaArchivedAd` type
declaration and the request list.

### Two corroborating checks that strengthen the claim

1. **No other module consumes Meta creative or snapshot data.** A repository-wide search for
   `ad_creative` / `ad_snapshot` outside the client and its tests returns one unrelated hit —
   `payload_snapshot` in `creatorExecutionObservabilityService.ts`, a different concept with no
   connection to Meta.
2. **The persisted contract has no field that could carry creative text or a snapshot URL.**
   `AdsObservationResult` carries only `platform`, `accessState`, `reason`, `vantage`, `observedAt`,
   `advertisers[]` and four `counts`. The single slot that *could* hold an artifact reference,
   `AdvertiserProfileObservation.artifactRef`, is set to **`null`** by the Meta client
   (`metaAdLibraryClient.ts:308`).

So the limitation is structural, not merely a matter of the current code path: creative content
cannot reach storage without a type change.

**§5 of the determination is therefore accurate as written.** One wording caution carried forward:
`creativeIds` holds **Ad Library ad IDs**, not creative content — the name is inherited from the
Google-shaped interface and should not be read by a terms reviewer as "creative stored".

---

## 2. THE THREE REGISTERS, KEPT SEPARATE

### 2.1 What the official text states

| Source | Clause | Text |
|---|---|---|
| Platform Terms | **3.a.viii** | Prohibits "Processing Platform Data for purposes other than the applicable **permitted purposes set forth in Meta's Developer Docs**" |
| Platform Terms | **3.a.iv** | Prohibits "**Selling, licensing, or purchasing Platform Data**" |
| Platform Terms | **3.c** | Sharing permitted only in listed circumstances |
| Platform Terms | **3.d.i.2** | Must "**Delete all Platform Data as soon as reasonably possible**" once retention is no longer necessary for a legitimate business purpose |
| Platform Terms | **3.d.i.1** | Must "Update or delete Platform Data promptly after receiving a request from us or the User" |
| Platform Terms | **3.d.i.2.d** | Deletion required on User request — "unless the data is aggregated or de-identified" |
| Ad Library API docs | — | Downloading creative for an individual ad "**must be for analysis**"; must comply with "the data storage terms in our Terms of Service"; **a batch of archived ads cannot currently be downloaded** |
| Research Tools terms | **§2(p)**, **§5(b)(v)**, **§5(b)(vii)**, **§2(i)** | Research is "**non-commercial** … for science or in the public interest"; no commercial exploitation; no use "for benchmarking purposes"; eligibility tied to an **Institution** |
| Research Tools terms | **§1** | Enumerates the Content Library UI, the Content Library API and the Ads Transparency and Targeting Dataset |

**The Platform Terms contain no non-commercial restriction and no competing-product or benchmarking
prohibition.** The Research Tools terms do.

### 2.2 What the current implementation does

- `GET /v21.0/ads_archive`, `ad_type=ALL`, `ad_active_status=ALL`, `ad_reached_countries` limited to
  EU 27 + GB, `limit=100`; paging via `paging.next` with a 5-page ceiling, deduplicated on ad `id`.
- **Retains** only `page_id`, `page_name` and ad `id`s, plus locally derived flags and a constructed
  **public** Ad Library link.
- **Does not** retain creative text, media, `ad_snapshot_url`, delivery windows, publisher platforms
  or languages; **does not** request `spend`, `impressions`, `currency` or `bylines`; performs **no**
  landing-page tracking (`searchByDomain` deliberately unimplemented, since the archive exposes no
  destination URL); performs **no** spend analysis.
- Caps every Meta record at `PROBABLE_MATCH` with `eligibleForCompanyClaim: false`, so Meta evidence
  can never support a company-specific claim.
- Is **dormant**: no Meta client is registered with the acquisition cycle and the gate flag is absent.
- Intended purpose, stated plainly: **commercial competitor and brand monitoring sold to customers.**

### 2.3 What remains ambiguous and needs a written determination

**No legal conclusion is drawn here.** Five open questions, unchanged from the determination:

| # | Open question |
|---|---|
| **M7.1** | Do the Research Tools **non-commercial** terms govern `ads_archive`, instead of or alongside the Platform Terms? **If they do, the intended use is barred.** |
| **M7.2** | Under 3.a.viii, what is the **permitted purpose** for `ads_archive` in the Developer Docs, and does commercial competitor/brand monitoring fall within "analysis"? (M6 is the same question.) |
| **M7.3** | Does presenting these observations to a paying customer constitute "**selling… Platform Data**" (3.a.iv), or permitted sharing (3.c)? |
| **M7.4** | Does indefinite retention as historical evidence satisfy 3.d.i.2? |
| **M7.5** | Can the 3.d.i.1 deletion obligation be honoured? **A capability gap, not only an interpretation** — no mechanism exists to locate and delete stored Meta observations, and the "aggregated or de-identified" carve-out may not apply because `page_id` and `page_name` are identifiers |

**On the Research Tools question specifically:** omission of `ads_archive` from §1's enumeration is
**not** treated as exclusion. The support pointing to Platform Terms is affirmative and independent —
the API's access path runs through a Meta for Developers app with Platform Policy agreement, and
Meta's terms page routes Developers Platform use to the Platform Terms. **Neither text states that
the Research Tools terms are inapplicable**, so M7.1 stays open.

**No third-party source is relied on anywhere in this determination.**

---

## 3. THE ENQUIRY — READY TO SEND, ALL SIX QUESTIONS PRESERVED

> **To:** Meta Developer Support — and, in parallel, qualified legal counsel
> **Subject:** Governing terms and permitted purpose for `ads_archive` (Ad Library API) in a
> commercial product
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

**Routing:** questions **1-5** to Meta **and** counsel; question **6** to Meta.
**Clause mapping preserved:** Q1 → Research Tools §2(p)/§5(b)(vii) vs Platform Terms; Q2 → 3.a.viii
+ Developer Docs; Q3 → 3.a.iv / 3.c; Q4 → 3.d.i.2; Q5 → 3.d.i.1 / 3.d.i.2.d; Q6 → access
prerequisites M1-M3.

**Not sent.** Dispatch is the owner's action.

---

## 4. PROPOSED CODE CHANGE — **PROPOSED, NOT AUTHORIZED, NOT IMPLEMENTED**

The exact change, recorded so it can be authorized or rejected without re-deriving it.

**File:** `backend/services/ads/metaAdLibraryClient.ts` — current state, **unmodified**:

```ts
const AD_FIELDS = [
  'id',
  'page_id',
  'page_name',
  'ad_creative_bodies',              // ← requested, never read
  'ad_creative_link_titles',         // ← requested, never read
  'ad_creative_link_captions',       // ← requested, never read
  'ad_creative_link_descriptions',   // ← requested, never read
  'ad_delivery_start_time',          // ← requested, never read
  'ad_delivery_stop_time',           // ← requested, never read
  'ad_snapshot_url',                 // ← requested, never read
  'publisher_platforms',             // ← requested, never read
  'languages',                       // ← requested, never read
].join(',');
```

**Proposed:**

```ts
const AD_FIELDS = ['id', 'page_id', 'page_name'].join(',');
```

Optionally, and separately: rename `creativeIds` → `observedAdIds` so the field name cannot be
misread as creative content, and narrow the `MetaArchivedAd` interface to the three fields.

**Why it strengthens the terms position:** the system would **never receive** creative text or
snapshot URLs, so the Developer Docs' creative-download condition is not engaged at all, and the
Platform Data retained is minimised to three identifier/name fields — which also narrows M7.4 and
M7.5.

**Cost if authorized:** nine deletions of capability the code never used. It changes the candidate,
so the tracked diff and untracked hashes move, **L13 is invalidated**, and roughly an hour of local
gates would need re-running (certification ~13 min, baseline ~19 min, scoped suite ~18 min, plus
targeted suites).

**Status: PROPOSED — NOT AUTHORIZED, NOT IMPLEMENTED.** `AD_FIELDS` still has **12** entries,
verified this pass.

---

## 5. RELEASE DECISION OF RECORD

**META ACQUISITION DEFERRED PENDING M7 DETERMINATION.**

| | |
|---|---|
| The client | Remains in the candidate, **dormant** |
| Approval status | **Not approved for commercial use.** Nothing here constitutes permission |
| Technical access | Irrelevant to permission — **obtaining a token would not make commercial use permitted** |
| If Report 1 ships now | It ships with **Google-only** advertising coverage, which must be stated accurately. Google-only coverage must **never** be described as Meta support |
| Reversal condition | A written determination on M7.1-M7.5, plus the access prerequisites M1-M5 |

---

## 6. DORMANCY AND CANDIDATE PRESERVATION — from existing evidence only

### Provider dormant

| Check | Evidence | Result |
|---|---|---|
| Acquisition flag | Read-only `vercel env ls production --project omnivyra` (earlier pass) | `ADS_TRANSPARENCY_ACQUISITION_ENABLED` **ABSENT** from Production |
| Scheduler behaviour when absent | `adsAcquisitionScheduler.ts:11-12, 56, 72` | Gated on that flag; "absent from every environment"; returns `enabled: 0` and does nothing |
| Meta client registered with the cycle? | No registration site exists | **No** — the client is constructed only by tests |
| Live API call | Every Meta test uses an **injected transport**; no network call exists in the client's test path | **None** |
| Credential | No token exists anywhere; none requested, provisioned, printed or stored | **None** |

### Candidate unchanged

| | |
|---|---|
| Base | `5604b50bdebd23efd6d040b90f5802954413b656` |
| Tracked diff | `9bc40eeefa252cd807632fc56e7dc9554735abfd5d418c6897e09f31967fde0d` |
| `metaAdLibraryClient.ts` | `2ac79b6c29479e67f62b151217796c0920c5ff14820b624066eb38be9a60cc1d` |
| `report1DurableHistoryHonesty.test.ts` | `d607d9adf44d3d71b5c25c3b05c0bc128edf28e626a6e91f9c01da7b7a2845f3` |
| `report1MetaAdsAcquisition.test.ts` | `b0a19dc600f832d65930de02ac3bb69c5e67b758c76aa6b948dc6b750ce3984a` |
| `r1-integ` | 0 staged · branches 179 · tags 114 |
| `deploy-current-main` | 0 staged / 78 modified / 58 untracked |
| **L13** | `JEST_EXIT=0` · **1,496 / 1,496** — **VALID** |

**Documentation-only.** Every change this pass is a new file under `docs/`; no candidate code file
was touched, so the documentation and the candidate remain separable.

### Unaffected by this pass

D1-D3 remain separate owner decisions. The durable-history test was not started and
`cert-supabase` was not used. The readiness diagnostic remains **PROPOSAL ONLY — NOT IMPLEMENTED**.

### Sources

Official only: [Meta Platform Terms](https://developers.facebook.com/terms/) ·
[Ad Library API](https://www.facebook.com/ads/library/api) ·
[`ads_archive` reference](https://developers.facebook.com/docs/graph-api/reference/ads_archive/) ·
[ArchivedAd node](https://developers.facebook.com/docs/marketing-api/reference/archived-ad/) ·
[Research Tools product terms](https://transparency.meta.com/researchtools/product-terms-meta-research/) ·
[Ad Library tools](https://transparency.meta.com/researchtools/ad-library-tools/) ·
[Advertising Standards](https://transparency.meta.com/policies/ad-standards/) ·
[Permissions Reference](https://developers.facebook.com/docs/permissions)

---

**ENQUIRY PREPARED — AWAITING OWNER DISPATCH · META ACQUISITION DEFERRED PENDING M7 DETERMINATION**
