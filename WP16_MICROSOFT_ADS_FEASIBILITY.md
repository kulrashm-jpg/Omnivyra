# WP-16 — Microsoft Advertising Ad Library: Provider Feasibility Decision

**Workstream:** Report 1 completion orchestration, Track G (WP-16)
**Branch:** `r1/wp16-microsoft-ads-feasibility` (base `3d643f5c` = production-verified Report 1 release)
**Type:** Feasibility spike. No provider was built.
**Measured:** 2026-10-02, from a single **non-EU vantage**, **unauthenticated**, no credential of any
kind. Every HTTP status below was observed on that date by a real request. Nothing is recalled.
**Reads it depends on (read-only):** WP-8 `9d247025` (LinkedIn — UNAVAILABLE), WP-1 `ec8d9027`
(the `platform` dimension).

---

## 1. DECISION

> ## **AVAILABLE**

The Microsoft Advertising Ad Library satisfies the Report 1 public-evidence contract **without
credentials, without a connected account, without private campaign data, and without any
circumvention**. It is the first surface assessed in this track that does.

Three things make the decision `AVAILABLE` rather than anything weaker, and each was measured
rather than inferred:

1. **The surface is open and officially sanctioned for exactly this use.** `GET
   .../api/v1/Advertisers?searchText=HubSpot&top=3` → **HTTP 200** with no header, token or
   session. The official documentation states it outright: *"Like the Ad Library UI, the Ad
   Library API is publicily available and doesn't require any user sign-up or log-in"* — and then
   describes the rate limits that apply **to unauthenticated callers**, i.e. Microsoft explicitly
   provisions for unauthenticated programmatic use. The UI host's `robots.txt` is
   `User-agent: * / Disallow:` — an **allow-all**. Microsoft's Terms of Use contains **zero**
   occurrences of "automated", "robot", "spider" or "crawl"; its only scraping clause is scoped to
   "the AI services". Compare LinkedIn: `Disallow: /` plus User Agreement §8.2.
2. **`MATCHED` is genuinely reachable, and this was executed, not argued.** The six-case suite in
   `backend/tests/unit/wp16MicrosoftAdLibraryMapping.test.ts` feeds real captured values into the
   **unmodified** `resolveAdvertiserIdentity` and passes. The load-bearing case is a real public
   pair: `https://www.wix.com/` publishes JSON-LD `Organization.legalName = "Wix.com Ltd"` (HTTP
   200), and the Ad Library publishes `AdvertiserId 4295001869 / "Wix.com Ltd." / Israel /
   IsVerified: true` (HTTP 200). Normalised, those are equal; the advertiser is provider-verified;
   no ambiguity is flagged ⇒ **`MATCHED`, `eligibleForCompanyClaim: true`**.
3. **`ObservedAdvertiser` holds the evidence with no schema change.** See §5. This is the single
   question the spike was asked to answer plainly, and the plain answer is **yes**.

**Why not `PROVIDER CANDIDATE — STRONG`:** that label would conflate *access* with *worth*. Access
is unambiguous and is what `AVAILABLE` states. Worth is a separate, weaker answer, and §9 gives
it honestly rather than letting a clean technical fit carry the argument.

### 1.1 Build recommendation (separate from the access decision)

> **BUILD — but small, second-class, and gated on §10's four conditions.**

Not because Bing is important. Bing is **5.29%** of worldwide search and **5.34%** of European
search (StatCounter, September 2026, fetched 2026-10-02). Build it because:

- the **cost is unusually low** — two unauthenticated REST GETs returning JSON, no browser, no
  Railway plane, no credential, no anti-bot exposure, no retry policy. The Google provider needs a
  headless browser and HTML scraping; this needs an HTTP client;
- its **correctness properties are better than the incumbent's**. Microsoft's verification is
  anchored to *government registration documents plus proof of registered rights to the domain*
  (official AIV documentation, §4.2). Google's `verified` asserts identity verification with no
  published domain link. Microsoft also publishes `DestinationUrl` per ad, which Google does not,
  and has **no domain-search discovery path at all** — removing by construction the exact
  "ads pointing AT a domain" failure mode PO-3a had to defend against;
- it converts "no advertising evidence" from a **single-provider** statement into a two-platform
  one. That is the real product gain, and it is a gain about *honesty*, not coverage.

**Do not give it equal prominence with Google.** It is a corroborating platform whose silence is
nearly meaningless (§9.2), and the report's wording must carry that.

---

## 2. EVIDENCE — WHAT WAS ACTUALLY FETCHED

All requests: `curl`, one ordinary desktop UA, no proxy, no session, no header injection, no retry
on refusal. Where a surface refused, the status is recorded as the finding.

### 2.1 The API surface

| # | URL | Status | Observation |
| --- | --- | --- | --- |
| A1 | `https://adlibrary.api.bingads.microsoft.com/api/v1/Advertisers?searchText=HubSpot&top=3` | **200** | 362 B, 0.35 s. `@odata.count:2`; `Hubspot, Inc.` / `United States` / `IsVerified:true` and `Afick HubSpot Ads Account` / `IsVerified:false`. |
| A2 | `.../api/v1/` (service root) | **403** | Azure "Service unavailable" HTML. The root is not served; only the documented templates are. |
| A3 | `.../api/v1/$metadata` | **403** | The OData metadata document is **not** served. Field shapes must be taken from the official doc, not from `$metadata`. |
| B1 | `.../api/v1/Advertisers/4295007715` | **200** | Single entity, same four fields. Get-by-id works. |
| B2 | `.../api/v1/Advertisers?searchText=Wix&top=10` | **200** | `@odata.count:1` — exactly one: `Wix.com Ltd.` / `Israel` / verified. (Google's equivalent search returned **seven** colliding advertisers.) |
| B3 | `.../api/v1/Advertisers?searchText=Booking.com&top=10` | **200** | `@odata.count:7`; **six** distinct `AdvertiserId`s all named `Booking.com B.V.` / Netherlands / verified, plus `Booking.com Transport Ltd` / United Kingdom / verified. |
| B4 | `.../api/v1/Advertisers?searchText=hubspot.com&top=5` | **200** | `@odata.count:0`. **A domain is not an advertiser-search key.** |
| C1 | `.../api/v1/Ads?advertiserId=4295007715&top=2` | **200** | `@odata.count:623`. Each ad carries `Title`, `Description`, `DisplayUrl`, `DestinationUrl`, `AssetJson`. |
| C3 | `.../api/v1/Ads?searchText=hubspot.com&top=2` | **200** | `@odata.count:0`. **Ad-copy search is not a domain search either.** |
| C4 | `.../api/v1/Ads/78202980498079?expand=AdDetails(expand=ImpressionsByCountry,Targets)` | **200** | `PaidForByName:null`, `StartDate:2025-04-04`, `EndDate:2026-09-24`, `TotalImpressionsRange:"2.5K - 5K"`, 26 EEA country shares, `Targets:[{Location,false},{MicrosoftAudiences,true}]`, `RestrictionReason` absent, `RejectionJson:null`. |
| E2 | `.../api/v1/Ads?advertiserId=4295007715&startDate=2026-01-01&endDate=2026-06-30&top=1` | **200** | `@odata.count:583`. Date filtering works. |
| E3 | `.../api/v1/Ads?advertiserId=4295007715&countryCodes=72&top=1` | **200** | `@odata.count:133`. Country filtering works (72 = Germany). |
| E4 | `.../api/v1/Ads?advertiserId=4295007715&top=2&expand=AdDetails` | **200** | Accepted despite the doc's "AdDetails isn't supported when querying for multiple Ads" warning. **Do not rely on it** — the doc is the contract, the 200 is a point observation. |

### 2.2 Query and search constraints — measured, not documented

The documented defaults (`top` 3 / 12, `skip` 0) are not the limits. The limits were found by
probing and reading the server's own error text.

| Probe | Status | Server message |
| --- | --- | --- |
| `Ads?...&top=24` | **200** | — |
| `Ads?...&top=25` | **400** | *"The limit of '24' for Top query has been exceeded."* |
| `Advertisers?...&top=20` | **200** | — |
| `Advertisers?...&top=25` | **400** | same `'24'` limit |
| `Ads?...&skip=999` | **200** | — |
| `Ads?...&skip=1000` | **400** | *"The limit of '999' for Skip query has been exceeded."* |

**Page size 24, maximum offset 999.** So at most **1 023** ads are addressable per advertiser, in
≥ 42 requests.

**`@odata.count` SATURATES AT 1000 — this is the trap.** Measured: HubSpot `623` (real), but
Wix `1000`, and three *different* Booking.com advertiser ids each `1000`. Three independent
advertisers reporting the identical round number is a ceiling, not a coincidence; `skip=999` still
returned a row. **`@odata.count` is therefore a lower bound once it reaches 1000 and must never be
rendered as a count.** It is admissible only as a provider-stated label, and at the ceiling the
only honest label is `1000+ ads`.

### 2.3 Rate limits — observed

Identical unauthenticated request, issued sequentially with no pause:

```
1:200 2:200 3:200 … 19:200 20:429
```

**First `429` at request #20.** No `Retry-After` and no rate-limit headers were returned. The very
next request succeeded — `X-Cache: TCP_HIT` on an Azure Front Door edge, so the window recovers in
seconds and repeats are often served from CDN cache. Two consequences: a per-report budget of
~20 calls is comfortable and a batch backfill is not, and **CDN caching means `observedAt` records
when *we* asked, not when Microsoft last computed** — which the existing model already treats
correctly by making `observedAt` and `vantage` first-class.

Higher limits are available with a free Microsoft Advertising developer token. **This spike
required none and the recommendation requires none** (§10, condition 4).

### 2.4 `robots.txt` and terms — the governing constraints

| URL | Status | Content |
| --- | --- | --- |
| `https://adlibrary.ads.microsoft.com/robots.txt` | **200**, 70 B | `User-agent: *` / `Disallow:` — **an empty Disallow, i.e. allow all.** |
| `https://about.ads.microsoft.com/robots.txt` | **200**, 429 B | Disallows only `/content/dam/.../gated/*`, `*.json$`, `*?page=*`. Nothing relevant. |
| `https://adlibrary.api.bingads.microsoft.com/robots.txt` | **403** | No `robots.txt` is served on the API host (its root 403s too). An API host serving no `robots.txt` grants no permission by itself — the permission here comes from the official documentation, which is explicit. |
| `https://adlibrary.ads.microsoft.com/` | **200**, 10 574 B | React SPA shell. It consumes the same public API. |
| `https://www.microsoft.com/en-us/legal/terms-of-use` | **200**, 157 823 B | The "Developer Terms of Use" the Ad Library API page links to. **0 occurrences** of `automated`, `robot`, `spider`, `crawl`, `data mining`, `rate limit`. Its only scraping clause: *"You may not use web scraping, web harvesting, or web data extraction methods to extract data from **the AI services**."* Scoped to AI services; not applicable. The "Harvest or otherwise collect information about others" clause sits under **Communication Services** (forums/chat), not a public API. |
| `https://learn.microsoft.com/en-us/advertising/guides/ad-library-api` | **200**, 65 055 B, `Last updated 2025-09-06` | The official API reference. §4.1 quotes it. |

**Finding: there is no prohibition to respect here, and an explicit permission to rely on.** No
`robots.txt` rule is violated, no ToS clause is engaged, and the official reference sanctions
unauthenticated programmatic access by name. Nothing in this spike approached a CAPTCHA, a login,
a paywall or a bot challenge, and nothing would in an implementation.

### 2.5 Subject-side evidence (fetched to make §5 real rather than hypothetical)

| URL | Status | JSON-LD `Organization` |
| --- | --- | --- |
| `https://www.wix.com/` | **200**, 3 004 101 B | `name: "Wix.com"`, **`legalName: "Wix.com Ltd"`**, no postal address |
| `https://www.hubspot.com/` | **200**, 643 503 B | `name: "HubSpot"`, **no `legalName`**, `addressCountry: "US"` |
| `https://www.booking.com/` | **202**, 3 962 B | Bot challenge, 0 JSON-LD blocks. Recorded as a refusal; no evasion attempted. |

---

## 3. DISCOVERY MECHANISM

**Advertiser-name search is the only discovery path, and that is a feature.**

`GET /api/v1/Advertisers?searchText={name}&top={≤24}&skip={≤999}` performs a substring match over
advertiser names and returns `AdvertiserId`, `AdvertiserName`, `AdvertiserCountry`, `IsVerified`.

**There is no domain discovery.** Measured: `Advertisers?searchText=hubspot.com` → `@odata.count:0`
(B4) and `Ads?searchText=hubspot.com` → `@odata.count:0` (C3). The existing
`AdsTransparencyClient.searchByDomain?` is **optional**, so a Microsoft client simply omits it and
`observePublicAdvertising` never calls it. `counts.domainAdCountLabel` stays `null`.

This is strictly safer than Google. The entire reason `advertiserIdentityResolver` exists is that
`?domain=calendly.com` returned `~10K ads` behind four advertisers, none of them Calendly. On
Microsoft that query cannot be expressed, so the failure mode is structurally absent rather than
defended against.

The cost is a **discovery gap**: a subject is findable only if its Microsoft account or verified
name contains a token the search is given. The existing scheduler already searches
`[declaredLegalName, brandName]` (`adsAcquisitionScheduler.ts:101`), which is the right input and
needs no change. A subject advertising through an agency account named nothing like itself is
undiscoverable — and that is an honest `observed, zero candidates`, not an absence of advertising.

Per-report call budget: 2 name searches + ≤ 6 profile opens (`DEFAULT_MAX_PROFILES`) + 1 ads page
each ≈ **≤ 14 calls**, comfortably inside the measured ~19-call window (§2.3).

---

## 4. FIELD MATRIX

### 4.1 What the API publishes (official doc, HTTP 200, `Last updated 2025-09-06`)

| Object | Field | Published | Verbatim definition / measured note |
| --- | --- | --- | --- |
| `Advertiser` | `AdvertiserId` | Yes | *"May be an AccountId or a VerifiedAdvertiserId… a request for an AccountId which has been verified will instead return the parent VerifiedAdvertiserId."* **Measured counter-example in §4.3.** |
| `Advertiser` | `AdvertiserName` | Yes | *"The name of the account **or legal name of a verified advertiser**."* |
| `Advertiser` | `AdvertiserCountry` | Yes | *"The country where the advertiser is **registered**."* Measured values are full English names: `United States`, `Netherlands`, `Israel`, `United Kingdom`, `France`, `Japan`, `Spain`. |
| `Advertiser` | `IsVerified` | Yes | *"A Boolean value representing whether the advertiser is verified."* |
| `Advertiser` | *ambiguity warning* | **No** | No equivalent of Google's "Multiple advertiser accounts have a similar name". See §5.2. |
| `Ad` | `AdId`, `Title`, `Description` | Yes | Full ad copy. Creative/message availability is **better than Google's** (Google's transparency UI shows a rendered preview; this returns the text). |
| `Ad` | `DisplayUrl`, **`DestinationUrl`** | Yes | *"The actual URL linked to by the ad."* Measured: `https://www.hubspot.jp/products/marketing/forms`. **LinkedIn publishes none; Google publishes none as a field.** |
| `Ad` | `AssetJson` | Yes (field) | *"A JSON URL of the asset resource."* **Measured empty (`""`) on all 11 ads sampled** across HubSpot and Wix — all text search ads. Treat image/video creative as unavailable in practice. |
| `AdDetails` | `PaidForByName` | Yes | *"The name of the customer who paid for the ad if different than the account owner."* **Measured `null` on all 6 ads sampled** — expected, since it is populated only when payer ≠ account owner. |
| `AdDetails` | `StartDate` / `EndDate` | Yes | UTC first/last **eligible EEA impression**. Measured earliest `2023-06-02`. Doc warns of a 1–3 day lag and that true start may predate the library. |
| `AdDetails` | `TotalImpressionsRange` | Yes | **INELIGIBLE — see §6.** |
| `AdDetails` | `ImpressionsByCountry` | Yes | **INELIGIBLE — see §6.** |
| `AdDetails` | `Targets` | Yes | `TargetType` ∈ {Gender, Age, Location, MicrosoftAudiences, AdvertiserAudiences} + `UsedForExclusion`. A disclosure, not a metric. |
| `AdDetails` | `RestrictionReason` | Yes | Present only when the ad was restricted. Absent on all sampled. |

### 4.2 `IsVerified` — does it carry Google's meaning? **It carries a stronger one.**

This is the pivotal question for the resolver, so it was answered from Microsoft's own
documentation, not from the API.

Advertiser Identity Verification (AIV) is **mandatory**: *"All new advertisers after July 1, 2023,
will be required to be verified prior to serving ads"* and *"all ads served through Microsoft
Advertising will come from verified advertisers starting August 1, 2023"*
([about.ads.microsoft.com, June 2023](https://about.ads.microsoft.com/en/blog/post/june-2023/making-microsoft-advertising-safer-with-advertiser-identity-verification), HTTP 200).

To verify **as a business**, the official process requires
([learn.microsoft.com AIV](https://learn.microsoft.com/en-us/advertising/msa-help/hlp_ba_conc_advertiseridentityverification), HTTP 200):

- *"The name and location that you've registered on your business documents should **exactly
  match** the business name and location that you've provided"*;
- a **public business identifier** — *"Business registration number, Data universal numbering
  system (D-U-N-S), or Tax ID"*;
- **business documents** — *"Articles of incorporation… Official government documents… Government
  registry records… Official financial filings"*;
- **website documents** — *"submit documentation that proves your business has **registered rights
  to the domain**… List a domain that's an **exact match** to the one you're enrolling… Include
  your company's name and address."*

**That last requirement is the one that matters here and Google publishes no equivalent.**
Microsoft verifies the link between the legal entity and *the domain*. Report 1's subject **is** a
domain. So `IsVerified: true` asserts more than Google's "advertiser has verified their identity":
it asserts a document-checked entity↔domain binding. The resolver's governing comment —
*"Google's verification is what makes the advertiser side an independent assertion rather than
another copy of the public brand string"* — is satisfied **more strongly** by Microsoft, not less.

Two caveats, both real:

- **`IsVerified` also covers individuals.** AIV permits verifying *"as an individual"* for
  *"Independent contractors, sole traders, freelancers, or hobbyists"*. A `true` can therefore mean
  a verified natural person, not a registered company.
- **The API does not expose *which* domain was verified.** The strongest available anchor stays the
  legal name, exactly as today. `DestinationUrl` corroborates independently — measured: all 10 Wix
  ads sampled point at `wix.com` / `www.wix.com`.

### 4.3 `IsVerified: true` does **not** guarantee `AdvertiserName` is a legal name

The doc's "account name **or** legal name of a verified advertiser" hides a hazard, and it was
measured. `Advertisers?searchText=Intercom&top=20` → **200**, `@odata.count:13`, including:

```
4295056648 | production - 118769 - 53339669 - 2000000250 - running - Pompes Funèbres Intercommunales Du | France | IsVerified=True
4295119691 | production - 25597 - 62500032 - running - 140 - 55 - 3 - Pompes Funèbres Intercommunales      | France | IsVerified=True
```

Those are internal account labels carried on **verified** advertisers, and the doc's promise that a
verified AccountId resolves to a clean parent `VerifiedAdvertiserId` did not hold for them.

**This does not endanger the resolver**, and the reason is worth stating because it is the design
paying off: `normalizeLegalName` does case/Unicode/punctuation/whitespace only — no suffix
stripping, no token overlap, no similarity — so an account label can never *exactly* equal a
website-declared legal name. The failure mode is a missed match (`NOT_MATCHED` / `UNRESOLVED`),
never a fabricated one. It is proven by the fourth test case, not assumed.

---

## 5. THE `ObservedAdvertiser` MAPPING — THE CENTRAL VERDICT

> ### **YES. `ObservedAdvertiser` can represent this evidence with NO schema change.**
> **No field is missing. No field needs widening. No migration. No type edit.**

```
ObservedAdvertiser              ←  Microsoft Ad Library
──────────────────────────────────────────────────────────────────────────────
advertiserId:     string        ←  String(AdvertiserId)      // Long → string
legalName:        string|null   ←  AdvertiserName
basedIn:          string|null   ←  AdvertiserCountry
verified:         boolean       ←  IsVerified
ambiguityFlagged: boolean       ←  false  (no such signal is published — §5.2)
```

Executed, not asserted: `backend/tests/unit/wp16MicrosoftAdLibraryMapping.test.ts`, 6 tests, all
passing against the **unmodified** resolver.

The surrounding observation types also fit unchanged:

| Existing field | Microsoft source | Note |
| --- | --- | --- |
| `AdvertiserSuggestion.*` | the `Advertisers` row | `adCountLabel: null` (not returned by search). Already nullable. |
| `AdvertiserProfileObservation.adCountLabel` | `Ads?advertiserId=…` `@odata.count` | **Must carry the 1000 ceiling** — `"1000+ ads"` at saturation, never an integer (§2.2). |
| `AdvertiserProfileObservation.creativeIds` | `AdId[]` | ≤ 24 per page, ≤ 1 023 addressable. |
| `AdvertiserProfileObservation.profileUrl` | `.../api/v1/Advertisers/{id}` | **Measured:** no stable human deep link exists. `adlibrary.ads.microsoft.com/advertiser/{id}` → **404**; `?advertiserId={id}` → 200 but that is the SPA shell for any path. The API resource URL is public, 200, citable — use it. |
| `AdsTransparencyClient.searchByDomain?` | — | **Optional. Omit it.** No domain discovery exists (§3). |
| `AdsObservationResult.counts.domainAdCountLabel` | — | Permanently `null`. |
| `SnapshotAdvertising.source` | `'ads_transparency'` | Unchanged literal; `platform` is what distinguishes (WP-1). |
| `SnapshotAdvertising.provenance` | `'PUBLIC_OBSERVED'` | Correct (§7). |

### 5.1 The one implementation change required — and it is not a schema change

WP-1's `AdsPlatform` is a deliberate one-member union:

```ts
export type AdsPlatform = 'google';
```

with the stated rule *"Adding a platform is not a typing change: it requires a client that can
observe that platform."* A Microsoft provider would add `'microsoft'` **together with its client**,
exactly as WP-1 intends. Persistence needs nothing: `scope` is JSONB with no CHECK and no index,
`loadLatestAdsObservation` already filters on `scope.platform`, due-ness is already per platform,
and `resolveObservedPlatform` already refuses to coerce an unknown platform to Google. **No
migration, no backfill.** WP-1 did the hard part already.

### 5.2 The one honest gap: `ambiguityFlagged`

Microsoft publishes no "multiple advertiser accounts have a similar name" warning, so the mapping
hard-codes `false`. That is literally true — *the provider raised no warning* — but it is not the
same statement as *the provider examined this and found no ambiguity*, and the difference must not
be lost in the record.

It is tolerable here, for three measured reasons:

1. **The exact-equality rule, not the warning, does the separating.** Measured: the `Intercom`
   search returned 13 rows across ≥ 5 unrelated verified legal entities; against a subject
   declaring `Intercom Inc`, exactly one resolves `MATCHED` and the rest `NOT_MATCHED` /
   `UNRESOLVED` (test case 6).
2. **The jurisdiction guard still fires.** Two same-named entities in different countries are
   downgraded to `PROBABLE_MATCH`, which is `eligibleForCompanyClaim: false`.
3. **Collisions are measurably rarer than Google's.** `searchText=Wix` → **one** advertiser.
   Google's `Wix` search returned **seven**. Mandatory AIV means the name space is registration-
   backed rather than self-declared.

**This should be recorded in the `resolutionBasis` string, not papered over** — the honest wording
is that this platform publishes no ambiguity signal, so none was available to consult. That is a
string, not a schema change. Doing it properly across platforms is WP-1's capability-descriptor
territory, and WP-16 should not pre-empt it.

### 5.3 The real ceiling on `MATCHED` is a pre-existing resolver defect, not Microsoft's

Measured and proven in test case 4. `jurisdictionsAgree` deliberately does not expand ISO codes
(*"`NL` is NOT expanded"*). But JSON-LD `addressCountry` is normally an ISO code — **hubspot.com's
measured value is literally `"US"`** — while `AdvertiserCountry` is always a full English name
(`"United States"`). So:

```
subject.jurisdiction = 'IL'  ×  advertiser.basedIn = 'Israel'  ⇒  PROBABLE_MATCH, not MATCHED
```

A correct, verified, exactly-name-matching identity is **silently downgraded**, and only because
the subject's site was *more* informative. The Wix pair reaches `MATCHED` only because wix.com's
`Organization` block declares no address at all, leaving `jurisdiction` null so the branch never
fires. The better-documented subject is penalised.

**This is not a Microsoft problem — it applies identically to Google**, whose `Based in:` is also a
full country name. It is flagged here because WP-16 measured it, it is the practical ceiling on
`MATCHED` for both platforms, and fixing it belongs to whoever owns the resolver. **Do not fix it
inside a Microsoft provider**: a per-provider country mapping would be exactly the kind of local
patch that makes the two platforms disagree.

---

## 6. THE REPORT 1 ELIGIBILITY BOUNDARY — WHAT MUST NOT BE PUBLISHED

Report 1 must not publish spend, impressions, reach, CTR, ROAS, CAC or conversions from a public
repository. The Ad Library returns two fields that are squarely inside that prohibition, and they
arrive in the *same object* as the eligible ones. **The separation must be enforced at the client
boundary — by never reading them into the observation at all — not at the renderer.** A field
that is never mapped cannot be rendered by mistake; a field mapped "for completeness" eventually
is.

| Field | Measured value | Verdict |
| --- | --- | --- |
| **`TotalImpressionsRange`** | `"2.5K - 5K"` | **INELIGIBLE. Never read, never store, never render.** It is an impressions figure. That it is a provider-stated bucket does not save it — the prohibition is on the quantity, not its precision. |
| **`ImpressionsByCountry[].ImpressionShare`** | `Austria 1.8%`, `France 10.3%`, … (26 countries) | **INELIGIBLE. Never read, never store, never render.** A share of impressions is reach, redistributed. Neither the shares nor any geographic split derived from them may appear. |
| `ImpressionsByCountry[].Country` | `Austria`, `Belgium`, … | **Eligible with care, and simpler to drop.** The bare country list is a presence disclosure. But it is inseparable in the reader's mind from the share beside it, and reconstructing "where they advertise" from an impressions array invites exactly the inference the rule forbids. **Recommendation: do not read this array at all.** Country coverage, if ever wanted, should come from `countryCodes` filtering, not from an impressions breakdown. |
| `AdvertiserName`, `AdvertiserCountry`, `IsVerified`, `AdvertiserId` | — | **Eligible.** Identity, which is the whole point. |
| `Title`, `Description`, `DisplayUrl`, `DestinationUrl` | — | **Eligible.** Public ad content and its destination. Not performance. |
| `StartDate`, `EndDate` | `2025-04-04` → `2026-09-24` | **Eligible.** Presence over time. **Must be worded as "first/last eligible EEA impression recorded by the Ad Library"**, never as a campaign start or an activity timeline — the doc warns the true start may predate the library and that `EndDate` lags 1–3 days. |
| `Targets[]` | `Location` (incl.), `MicrosoftAudiences` (excl.) | **Eligible.** A targeting *disclosure*, not a metric. Carries the doc's own caveat: *"an aggregate list of all targets used at any point during the ad run… may not necessarily indicate which factors were used for a specific impression."* |
| `PaidForByName` | `null` (all sampled) | **Eligible** when present. A funding-entity disclosure. |
| `RestrictionReason` | absent (all sampled) | **Eligible.** A compliance status. |
| `@odata.count` of ads | `623` (HubSpot), `1000` (Wix, Booking ×3) | **Eligible ONLY as a provider-stated label**, and only on a `MATCHED` advertiser — the existing `adCountLabel` rule. **Saturates at 1000** (§2.2), so `"1000+ ads"` at the ceiling and never an integer. Must be scoped in the wording: *ads with EEA impressions recorded since June 2023*, not "ads". |

**One sentence to carry into the implementation:** the Microsoft client must request
`expand=AdDetails` **without** `ImpressionsByCountry`, and must drop `TotalImpressionsRange` at the
parse step. Then the ineligible numbers never enter the process.

---

## 7. PROVENANCE CLASSIFICATION

**`PUBLIC_OBSERVED`** — the same value `advertisingSurface.ts` already hard-codes, and it is
correct here for the strongest possible reason: this is a **regulator-mandated public repository**,
read anonymously, by a documented public API, with no account relationship of any kind between
this platform and either Microsoft or the subject.

The three forbidden classifications are all structurally unreachable, which is worth stating
because it is *why* this provider is safe:

| Forbidden | Why it cannot occur |
| --- | --- |
| `COMPANY_CONFIRMED` | The subject is never asked anything. The only subject-side input is its own public website. |
| `OMNIVYRA_OBSERVED` | Nothing is measured by this platform. Every value is Microsoft's own, carried verbatim. |
| `CONNECTED_SOURCE` | **No credential exists to connect with.** Every status in §2 was obtained unauthenticated. This is not a policy choice that could drift — the recommendation (§10) forbids the developer token precisely so it stays structural. |

`INFERRED` / `ESTIMATED` / `UNAVAILABLE` remain available where they belong: `UNAVAILABLE` is the
`AdsAccessState` for a refusal, and nothing in this mapping infers or estimates anything.

---

## 8. IDENTITY MAPPING ONTO `AdvertiserResolutionState`

| State | Reachable on Microsoft? | Measured basis |
| --- | --- | --- |
| **`MATCHED`** | **YES — proven.** | wix.com `legalName: "Wix.com Ltd"` (HTTP 200) ↔ `4295001869 / "Wix.com Ltd." / Israel / IsVerified: true` (HTTP 200). Test case 2 passes against the unmodified resolver. **The anchor is the website-declared `Organization.legalName` against the provider-verified `AdvertiserName`** — identical to Google's, and backed by a stronger verification programme (§4.2). |
| `PROBABLE_MATCH` | Yes | Names agree but `IsVerified: false`, or jurisdictions disagree — including the ISO-code artefact of §5.3, which is the common case in practice. |
| `NOT_MATCHED` | Yes | A different **verified** legal name. Measured: `Booking.com Transport Ltd` (UK, verified) against a `Booking.com B.V.` subject. |
| `UNRESOLVED` | Yes | No declared legal name on the subject side — **measured on hubspot.com, which publishes none** — or an unverified differing name. |
| `INSUFFICIENT_EVIDENCE` | Rare | Requires an empty `AdvertiserName`; not observed in any response. |

### 8.1 `matchedAdvertiserAccounts` counts ACCOUNTS, not entities

Measured: **six distinct `AdvertiserId`s all named `Booking.com B.V.` / Netherlands / verified**,
each reporting 1 000 ads. Against a `Booking.com B.V.` subject, all six resolve `MATCHED` (test
case 5) — which is the resolver behaving **correctly**: it preserves multiplicity by design
(*"several `MATCHED` accounts is a correct outcome, not a conflict to collapse"*).

The hazard is downstream. `counts.matchedAdvertiserAccounts: 6` must never be rendered as "six
advertisers" or let six ad counts be summed into "6 000 ads". The field name is already honest;
the renderer must stay honest with it. **This is more acute on Microsoft than on Google**, because
AIV issues one account per verification event and the doc's promised parent-id consolidation
demonstrably does not always happen (§4.3).

---

## 9. IS BING SEARCH ADVERTISING WORTH SURFACING? — THE HONEST ANSWER

A strong technical fit is not a reason to build. This section is the reason the recommendation in
§1.1 is hedged rather than enthusiastic.

### 9.1 Share

StatCounter, September 2026 (fetched 2026-10-02, HTTP 200): **Bing 5.29% worldwide**
(Google 89.94%), **Bing 5.34% in Europe** (Google 88.97%). Roughly one search in nineteen.

### 9.2 The EEA restriction is the real limitation, and it is severe

Official, emphasised in Microsoft's own documentation: *"The Ad Library is designed to meet EU
legal compliance requirements. It contains **only** advertisements served within the European
Economic Area (EEA)"*, recording impressions *"in the European Union (EU) or European Economic
Area (EEA) **since June 2023**"*.

So the real coverage is not "5.3% of search" — it is **5.3% of search, in the EEA only, since June
2023**. A tenant whose Bing advertising runs only in the US, India or APAC is **structurally
invisible**, and so is a tenant who advertises nowhere. Those two cases return the identical
`observed, zero candidates`.

**That is the decisive product fact.** An empty Microsoft result is close to uninformative. The
report must never let it read as "this company does not advertise", and `advertisingSurface.ts`
already has the correct discipline (`mayStateNoVerifiedCompanyAdvertising`) — but on Microsoft even
that permitted statement is weak, and should be further qualified by platform and region.

### 9.3 Coverage, sampled

Eleven `Advertisers?searchText=` queries, all HTTP 200:

| Query | `@odata.count` | Plausible subject entity present? |
| --- | --- | --- |
| `Wix` | 1 | **Yes** — `Wix.com Ltd.` / Israel / verified |
| `HubSpot` | 2 | **Yes** — `Hubspot, Inc.` / US / verified |
| `Booking.com` | 7 | **Yes** — ×6 accounts, one entity |
| `Figma` | 1 | **Yes** — `Figma` / US / verified |
| `Zapier` | 1 | **Yes** — `Zapier Inc` / US / verified |
| `Intercom` | 13 | **Yes** — `Intercom Inc` / US / verified, among 12 unrelated |
| `Notion` | 3 | **No** — `Notion Labs Japan`, a Japanese partner, and a US quilting shop. **Notion Labs Inc is absent.** |
| `Calendly` | 0 | No |
| `Ahrefs` | 0 | No |
| `Omnivyra` | **0** | No |
| `DrishiQ` | **0** | No |

Six of eleven well-known brands are present. **Both of this house's own products return zero** —
which is exactly what §9.2 predicts and is the sharpest available statement of who this provider
will and will not serve.

### 9.4 Verdict

Not worth building for coverage. Worth building for **cost and correctness**: it is a few hundred
lines with no browser and no credential, it is the only surface assessed that reaches `MATCHED`
on an open public API, and it ends the single-provider framing of the advertising section. If the
cost were a Railway browser plane and a scraper, the answer would be no. It is not.

---

## 10. WHAT A FUTURE IMPLEMENTATION WOULD REQUIRE

**No commercial precondition. No credential. No negotiation.** Unlike WP-8, nothing here is gated
on a third party's discretion. The whole of it is engineering, and it is small.

1. **`AdsPlatform` gains `'microsoft'`, together with its client** — WP-1's stated rule. Nothing
   else in persistence changes: `scope` is JSONB, the platform filter exists, due-ness is already
   per platform, `resolveObservedPlatform` already refuses to coerce unknowns.
2. **A `createMicrosoftAdLibraryClient` implementing `AdsTransparencyClient`.** Two `fetch` calls.
   `searchAdvertisers` → `GET /Advertisers?searchText&top=24`. `openAdvertiser` → `GET
   /Advertisers/{id}` plus one `GET /Ads?advertiserId={id}&top=24` for `creativeIds` and the capped
   `adCountLabel`. **Omit `searchByDomain`.** Declare `platform = 'microsoft'`.
3. **Enforce §6 at the parse step.** Never request `expand=...ImpressionsByCountry`; drop
   `TotalImpressionsRange`. The ineligible numbers must not enter the process at all.
4. **Stay unauthenticated.** Do not take the developer token. `≤ 14` calls per report sits inside
   the measured ~19-call window, and remaining credential-free is what keeps `CONNECTED_SOURCE`
   structurally unreachable (§7) rather than merely unchosen. If throughput ever demands the token,
   that is a **provenance decision**, not a configuration change, and must be re-decided.
5. **Carry the 1000 ceiling honestly.** `"1000+ ads"` at saturation; never an integer; always
   scoped as *ads with EEA impressions recorded since June 2023*.
6. **Wording, which is most of the remaining risk.** Every Microsoft statement must carry platform
   and region. An empty result is "no EEA Bing advertising was found in the Ad Library", never "no
   advertising". `matchedAdvertiserAccounts` is accounts, not advertisers (§8.1).
7. **Re-run §2's probes before writing code.** Measured limits (`top` 24, `skip` 999, count ceiling
   1000, ~19 calls) are undocumented server behaviour and can change without notice.

**Out of scope for the implementation, deliberately:** the ISO-country defect of §5.3 (resolver
owner's, affects Google equally), a per-platform capability descriptor for the `ambiguityFlagged`
gap of §5.2 (WP-1's), and any use of the impressions fields of §6 (permanently forbidden).

---

## 11. CAVEATS ON THIS EVIDENCE

- **Single vantage, single date.** All of §2 is one non-EU vantage on 2026-10-02. The content is
  EEA-scoped by design, so a vantage inside the EEA may differ; this was not testable here.
- **`X-Cache: TCP_HIT`.** Responses are CDN-cached, so an observation records when we asked, not
  when Microsoft computed. The existing model's first-class `observedAt`/`vantage` already handles
  this correctly.
- **`$metadata` is 403**, so field shapes come from the official documentation, not from the
  service. A field the doc omits may still appear (`RejectionJson` was returned and is not in the
  doc) and must not be relied on.
- **Undocumented limits.** `top` 24, `skip` 999, the 1000 count ceiling and the ~19-call window
  were all measured, none are documented, and all may change.
- **booking.com returned HTTP 202** (bot challenge) with no JSON-LD, so its declared legal name was
  not measured. The two test cases that need an unmeasured subject value are labelled
  `CONSTRUCTED` in their own test names.

---

## 12. SUMMARY

| Question | Answer | Basis |
| --- | --- | --- |
| Reachable without credentials? | **Yes.** HTTP 200, unauthenticated, officially sanctioned. | §2.1, §2.4 |
| Any prohibited access involved? | **None.** `robots.txt` allow-all; ToU has zero automation clauses; the doc permits unauthenticated use by name. | §2.4 |
| Discovery mechanism? | Advertiser-name search only. **No domain discovery exists** — which removes PO-3a's worst failure mode structurally. | §3 |
| Does `IsVerified` mean what Google's `verified` means? | **It means more.** AIV checks government registration documents *and* proof of registered rights to the domain. But it also covers verified individuals, and a verified row can still carry an account label rather than a legal name. | §4.2, §4.3 |
| Destination URL / creative / dates? | `DestinationUrl` **yes** (Google and LinkedIn publish none). Ad copy **yes**, image assets effectively **no** (`AssetJson` empty on all sampled). Dates **yes**, as first/last eligible EEA impression. | §4.1 |
| Pagination / rate limits? | `top` ≤ 24, `skip` ≤ 999, `@odata.count` **saturates at 1000**, first `429` at request #20. All undocumented. | §2.2, §2.3 |
| Provenance? | **`PUBLIC_OBSERVED`.** The three forbidden values are structurally unreachable. | §7 |
| **Can `ObservedAdvertiser` hold it unchanged?** | **YES. No schema change, no field missing.** | **§5** |
| Is `MATCHED` reachable, and on what anchor? | **Yes — proven** on the wix.com ↔ `4295001869` pair, against the unmodified resolver. Anchor: website-declared `Organization.legalName` ↔ provider-verified `AdvertiserName`. | §8, test case 2 |
| What is ineligible for Report 1? | `TotalImpressionsRange` and `ImpressionShare` — **never read, never store, never render**. Drop the `ImpressionsByCountry` array entirely. | §6 |
| Worth it for this product's tenants? | **Marginal on coverage** — Bing 5.3%, EEA-only, since June 2023; both house products return zero. **Worth it on cost and correctness.** | §9 |
| **Decision** | **AVAILABLE.** Build small, second-class, on §10's conditions. | §1 |

---

*Spike only. No provider, no schema change, no migration, no production change, no flag change, no
acquisition, no credential, no push. One focused test was added — and it is a measurement of the
existing resolver against real captured evidence, not a provider test. Google acquisition, the
scheduler, the customer-only gate and the existing advertising rule were read-only inputs and are
untouched. WP-8's and WP-1's worktrees were read-only and are unmodified.*
