# REPORT 1 — META ADVERTISING ACQUISITION: API CONTRACT AND PREREQUISITES

**Phase C1 deliverable.** Investigation only. No code written, no provider contacted, no credential
requested, no production activation. Prepared against `main @ 5604b50b`.

Owner decision on record: **Option A — implement Meta acquisition, subject to verifying the official
API contract and documenting access prerequisites. No production activation is authorized.**

This brief reports one finding that should be weighed **before** implementation starts, because it
bounds what Meta acquisition can ever deliver.

---

## 1. THE FINDING THAT BOUNDS THE SCOPE

**The Meta Ad Library API does not contain most commercial ads.**

Two official Meta sources agree:

- The `ads_archive` endpoint reference states: *"Ads that reached no EU location appear only if they
  concern social issues, elections, or politics."*
- Meta's transparency research-tools page describes the API as covering *"ads about social issues,
  elections or politics … as well as ads that deliver to the EU and associated territories"*, plus
  active public branded content.

So the archive contains:

| Ad kind | Coverage | Retention |
|---|---|---|
| Social-issue / election / political | **Worldwide** | ~7 years |
| **Any** ad, including ordinary commercial | **Only where it delivered to the EU (and associated territories)**; third-party sources add the UK | ~1 year after last impression |
| Active public branded content | Facebook and Instagram | — |

**Consequence for Report 1.** For a subject company that advertises commercially and does **not**
deliver to the EU/UK — a US or India-only advertiser, say — a correct Meta query returns **zero
rows**, and that zero means *"outside the archive's coverage"*, **not** *"this company does not
advertise on Meta"*.

The existing contract already refuses the wrong reading — `report1AdsIntegration.test.ts:133` "a null
observation renders nothing rather than asserting no advertising", and
`report1AdvertisingDecision.test.ts:165` "never asserts the company does not advertise". So the
architecture will not fabricate a claim. But it does mean a Meta integration delivers **evidence for
EU/UK-delivering advertisers and for political advertisers, and silence for everyone else.**

**This is an owner input, not a blocker.** It does not change the decision you made; it changes what
"Meta support" will honestly mean in the release note. Recommended handling: a Meta observation for a
subject with no EU/UK delivery should be recorded as a coverage-bounded access state rather than an
empty `observed` — see §6.

---

## 2. API CONTRACT — `GET /ads_archive` (official)

### Parameters

| Parameter | Required | Notes |
|---|---|---|
| `ad_type` | **Yes** (the only one so marked) | Default `ALL`. Also `EMPLOYMENT_ADS`, `FINANCIAL_PRODUCTS_AND_SERVICES_ADS`, `HOUSING_ADS`, `POLITICAL_AND_ISSUE_ADS` |
| `ad_reached_countries` | No, but effectively required | `ALL` or ISO country codes. Governs the coverage boundary in §1 |
| `search_terms` | No | **100-character limit**; not translated, so terms must match the ad's language |
| `search_page_ids` | No | **Up to 10** Page IDs |
| `ad_active_status` | No | Default `ACTIVE`; also `INACTIVE`, `ALL`. **Default would hide concluded campaigns — set deliberately** |
| `search_type` | No | Default `KEYWORD_UNORDERED`; `KEYWORD_EXACT_PHRASE` available. Relevant to name matching (§4) |
| `media_type`, `publisher_platforms`, `languages`, date filters, `unmask_removed_content` | No | `unmask_removed_content` defaults `false` |

Create / update / delete are not supported. Read-only, which suits the acquisition model.

### Returned `ArchivedAd` fields

**Available for all ads — this is the usable evidence surface:**

`id` · `ad_creation_time` · `ad_creative_bodies` · `ad_creative_link_captions` ·
`ad_creative_link_descriptions` · `ad_creative_link_titles` · `ad_delivery_start_time` ·
`ad_delivery_stop_time` · `ad_snapshot_url` · `languages` · `page_id` · `page_name` ·
`publisher_platforms` · `total_reach_by_location`

**Restricted to political / issue ads — unusable for ordinary subjects:**

`bylines` · `currency` · `delivery_by_region` · `demographic_distribution` ·
`estimated_audience_size` · `impressions` · `spend` · `br_total_reach`

**Region-restricted:** `beneficiary_payers`, `eu_total_reach` (EU); `age_country_gender_reach_breakdown`,
`target_ages`, `target_gender`, `target_locations` (UK & EU, plus political in Brazil).

### Against the Report 1 requirement list

| Required | Deliverable from Meta? |
|---|---|
| Ad-level evidence | **Yes** — one `ArchivedAd` per ad, with `id` and delivery window |
| **Creative / message analysis** | **Yes** — `ad_creative_bodies`, `ad_creative_link_titles`, `ad_creative_link_captions`, `ad_creative_link_descriptions`, all unrestricted |
| **Landing analysis** | **NO — gap.** There is no destination-URL field. `ad_creative_link_captions` is the *displayed* caption (often a bare domain), not the landing URL; `ad_snapshot_url` is a Meta-hosted render of the ad. Landing analysis would be inferential at best, and must not be presented as an observed destination |
| Platform-specific identity | **Yes** — `page_id` / `page_name`, plus `publisher_platforms` distinguishing Facebook from Instagram |
| Spend / performance | **No, and that is correct** — political-only, and `report1AdsIntegration.test.ts:181` already forbids introducing performance metrics |

---

## 3. ACCESS PREREQUISITES

Official sources are thinner here than on the contract, and third-party guides disagree, so this
section separates what is officially stated from what is not.

**Officially stated:** a Facebook account; create an app via *My Apps → Create App*; identity and
location confirmation at `facebook.com/ID`, which Meta ties to **running** ads about social issues,
elections or politics, and which takes a few days.

**Not officially confirmed, and therefore not to be relied on:** whether identity confirmation is
required to *read* non-political EU/UK ads through the API; whether business verification is
required; exact token lifetimes. Third-party guides variously claim short-lived (~1 h) and
long-lived (~60 day) tokens, 1–3 business days or 1–2 weeks approval, and acceptance of an
"Authorized Access to Public Information" term. **One guide also claims basic queries sometimes run
without confirmation.** None of this is verifiable from Meta's own documentation, and the most
detailed official page I could reach is roughly seven years old.

**Owner action required before implementation:** someone with a Meta developer account must walk the
access flow and report back which steps are actually demanded in 2026. I will not request, hold or
print any token. Note also that the EU-focused **Meta Content Library** is a separate,
researcher-only pipeline (CASD-administered) and is **not** a substitute route.

---

## 4. IDENTITY MATCHING — THE REAL ENGINEERING PROBLEM

This is the part that does not drop into the existing model.

`advertiserIdentityResolver.ts` makes **`MATCHED` the only state with `eligibleForCompanyClaim`**, and
`:57` documents the declared **legal name** as "The ONLY anchor that can reach `MATCHED`".
`report1AdsIntegration.test.ts:149` pins that: a "no verified company advertising" statement requires
a declared legal name to have been used. The Google path satisfies this because Ads Transparency
exposes a verified advertiser legal name.

**Meta has no equivalent for ordinary advertisers.** The funder field, `bylines`, is
**political-and-issue-only**. What a commercial Meta ad exposes is `page_name` — a Facebook Page
display name, which is a brand handle, not a verified legal entity.

So, under the current model, a Meta observation **cannot reach `MATCHED`** for a commercial
advertiser, and therefore can never support a customer-facing company claim. Three ways forward, all
owner decisions:

1. **Cap Meta at non-claiming evidence.** Meta observations resolve to `PROBABLE_MATCH` at best and
   are rendered as context, never as "this company advertises on Meta". Smallest change, keeps the
   identity contract intact, and is the option I would recommend.
2. **Ratify a Meta-specific anchor** — e.g. a Page whose linked website domain matches the subject's
   verified current domain. This widens `eligibleForCompanyClaim` to a new anchor type and needs
   explicit ratification, because `advertiserIdentityResolver.ts:15` records that a destination
   domain deliberately "can never reach `MATCHED`".
3. **Use `bylines` where present** — correct but only ever for political/issue advertisers.

---

## 5. WHAT ALREADY EXISTS AND NEEDS NO REBUILD

The platform seam was built for this and is in good shape:

```ts
export interface AdsTransparencyClient {
  readonly platform: AdsPlatform;            // declared by the client, never inferred
  searchAdvertisers(name: string): Promise<AdvertiserSuggestion[]>;
  openAdvertiser(advertiserId: string): Promise<AdvertiserProfileObservation | null>;
  searchByDomain?(domain: string): Promise<DomainCandidateObservation>;
}
```

- `AdsPlatform` widens from `'google'` to `'google' | 'meta'`; `KNOWN_ADS_PLATFORMS` gains `'meta'`.
- `adsEvidenceStore.ts:62-72` already refuses to serve an unrecognised platform's row as Google, so
  adding Meta cannot retroactively corrupt stored Google evidence. The legacy platform-less rule
  stays correct.
- Domain scoping, platform stamping, per-platform due-cadence and the `R1-OPEN-01` scope already
  exist in `adsDueSubjects.ts` and `adsEvidenceStore.ts`.
- `report1AdsPlatformDimension.test.ts` (27 cases) is the template for the Meta equivalents, and
  `:143` "recognises only platforms this build can actually observe" will need updating in lockstep.

**Impedance mismatch to resolve:** the interface is advertiser-centric (`searchAdvertisers` →
`openAdvertiser`), while `ads_archive` is a flat ad search with `search_terms` / `search_page_ids`.
A Meta client would synthesise advertiser records by grouping results on `page_id`. That is a real
adapter, not a thin wrapper, and `search_page_ids` caps at 10 Pages per call.

---

## 6. FAILURE STATES, PROVENANCE, PERSISTENCE, LIMITS

**Failure mapping onto the existing `AdsAccessState`** (`observed | blocked | restricted | requires_auth | unreachable | unavailable`):

| Condition | State | Note |
|---|---|---|
| Error 190 invalid/expired token | `requires_auth` | Token lifetime makes this routine, not exceptional |
| Error 613 rate limit | `blocked` | Meta publishes **no numeric limits** — back-off must be empirical and conservative |
| Subject has no EU/UK delivery and is not political | **`unavailable`**, reason naming the coverage boundary | **Do not record `observed` with zero advertisers** — that is the §1 trap |
| Query ran, in-coverage, nothing found | `observed`, zero advertisers | Genuine absence *within* coverage, still never phrased as "does not advertise" |
| Network / 5xx | `unreachable` | |

The `reason` field is contractually "Never phrased as an absence of advertising" — that holds here.

**Provenance.** Meta observations are `PUBLIC_OBSERVED`, like the Google path. `observedAt` must be
the observation time; `ad_creation_time` / `ad_delivery_start_time` are the ad's own timestamps and
must not be conflated with it. `vantage` matters more than for Google, because coverage is
jurisdictional.

**Persistence.** Reuses `adsEvidenceStore` with `platform: 'meta'` stamped by the client and the
existing `domain_id` scoping. Duplicates are keyed on Meta's `id`.

**Counts.** The existing `counts` block warns that `domainAdCountLabel` "is NOT this company's ad
count". Meta's per-Page ad count carries the same hazard and must be kept distinct from
`matchedAdvertiserAccounts`.

---

## 7. TEST STRATEGY

Mirror the Google suites, plus Meta-specific cases:

- Platform declaration: client declares `'meta'`; failure paths stamped too; unknown platform never coerced.
- Round-trip: `platform: 'meta'` persists into the JSONB scope and loads back; a Google read never serves a Meta row and vice versa; domain scoping preserved; Meta rows never suppress Google acquisition cadence.
- **Coverage-boundary test:** a non-EU/UK commercial subject yields `unavailable` with a coverage reason — **not** `observed` with zero advertisers.
- **Identity cap test:** a Meta observation cannot reach `eligibleForCompanyClaim` under option 1.
- Restricted-field test: `spend` / `impressions` / `bylines` are never read or rendered for a non-political subject.
- Landing-evidence test: no destination URL is claimed from `ad_creative_link_captions`.
- Failure mapping: 190 → `requires_auth`, 613 → `blocked`, 5xx → `unreachable`.
- Pagination and the 10-Page / 100-character caps.

---

## 8. SCOPE, DEPENDENCIES, EFFORT

| Item | Assessment |
|---|---|
| New code | A Meta client implementing `AdsTransparencyClient`; a Graph-API fetch layer with paging and back-off; a grouping adapter from flat ads → advertiser records; `AdsPlatform` widening |
| Changed code | `adsTransparencyObservation.ts` (type + known platforms), `adsDueSubjects.ts` (per-platform cadence already parameterised), scheduler wiring |
| Unchanged | Evidence store, domain scoping, provenance, decision language, report rendering |
| Dependencies | **Owner-confirmed access path and a token** (§3); **identity-model decision** (§4); **coverage-boundary semantics** (§6) |
| Not included | Any production activation. `ADS_TRANSPARENCY_ACQUISITION_ENABLED` stays unset and is a separate T3 decision |

**Effort is dominated by the adapter and the identity decision, not by the HTTP client.**

---

## 9. DECISIONS NEEDED BEFORE CODING

1. **Coverage (§1).** Accept that Meta evidence is EU/UK-delivering and political advertisers only — and approve the `unavailable`-with-reason semantics for everyone else?
2. **Identity (§4).** Option 1 (cap Meta below `eligibleForCompanyClaim` — recommended), option 2 (ratify a new anchor), or option 3 (`bylines`, political-only)?
3. **Landing analysis (§2).** Accept that Meta supplies no destination URL, so landing analysis stays Google-only?
4. **Access (§3).** Who walks the Meta developer access flow and reports the actual 2026 prerequisites?

---

## Sources

Official Meta documentation:
- [`ads_archive` Graph API reference](https://developers.facebook.com/docs/graph-api/reference/ads_archive/)
- [ArchivedAd node reference](https://developers.facebook.com/docs/marketing-api/reference/archived-ad/)
- [Meta Ad Library tools — transparency.meta.com](https://transparency.meta.com/researchtools/ad-library-tools/)
- [Meta Ad Library API](https://www.facebook.com/ads/library/api)
- [Meta Content Library and API](https://transparency.meta.com/researchtools/meta-content-library/)

Third-party, **used only where marked unverified** and not relied on:
- [admapix — Meta Ads Library API for developers](https://www.admapix.com/blog/ad-intelligence/meta-ads-library-api-developers)
- [adsuploader — Facebook Ad Library API](https://adsuploader.com/blog/facebook-ad-library-api)
- [ppc.land — ads library](https://ppc.land/ads-library/)
