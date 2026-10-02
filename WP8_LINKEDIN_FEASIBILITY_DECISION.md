# WP-8 — LinkedIn Advertising Observation: Provider Feasibility Decision

**Workstream:** Report 1 completion orchestration, Track G (WP-8)
**Branch:** `r1/wp8-linkedin-feasibility` (base `3d643f5c` = production-verified Report 1 release)
**Type:** Feasibility spike. No provider was built. No code ships with this document.
**Measured:** 2026-10-02 (all HTTP statuses below were observed on that date from a single
non-EU vantage; the Ad Library is a vantage-sensitive surface and these are point observations,
not a guarantee of behaviour elsewhere).

---

## 1. DECISION

> ## **UNAVAILABLE**

There is **no obtainable public or API route** by which this platform can observe a subject
company's LinkedIn advertising, and there is no tenant action that unlocks one.

The decision is `UNAVAILABLE` rather than `REQUIRES_TENANT_ASSISTANCE` because tenant assistance
does not help here. `REQUIRES_TENANT_ASSISTANCE` is the right answer when a surface is reachable
but identity cannot be anchored from public evidence. For LinkedIn **both** halves fail, and the
first one fails harder:

1. **The surface is not programmatically obtainable at all.** The documented Ad Library API
   endpoint is unreachable (HTTP 403 from two independent clients), there is no published API
   reference anywhere, and the only LinkedIn API that *is* obtainable — the Advertising API —
   is scoped by its own documentation to "Ad Accounts you administer" and therefore cannot, by
   construction, observe a third party. Automated access to the Ad Library **web UI** is
   prohibited by LinkedIn's `robots.txt` (`User-agent: *` / `Disallow: /`) and by §8.2 of the
   LinkedIn User Agreement. Under the no-circumvention rule that route is closed, full stop.
2. **Even if the surface were reachable, `MATCHED` would be structurally unreachable.** LinkedIn
   publishes no verification assertion about an advertiser. The existing resolver reaches
   `MATCHED` only when a website-declared legal name equals a **provider-verified** advertiser
   legal name. LinkedIn's Ad Library publishes advertiser name, payer name, format, preview and
   restriction status — and no verified flag. The ceiling is `PROBABLE_MATCH`, which is
   `eligibleForCompanyClaim: false`, which lands in `otherAdvertisers` and can never produce a
   company-level claim.

**Expressed in the existing vocabulary** (`backend/services/ads/adsTransparencyObservation.ts`,
`backend/services/ads/advertiserIdentityResolver.ts`):

| Dimension | Value | Why |
| --- | --- | --- |
| `AdsAccessState` for LinkedIn | **`unavailable`** | "Public advertising evidence could not be acquired for this report." No provider surface exists that this platform may lawfully reach. |
| Best reachable `AdvertiserResolutionState` | **`PROBABLE_MATCH`** (hypothetical ceiling only) | Payer-name agreement without a provider verification assertion. Today, with no reachable surface, the actual state is **no observation at all** — not even `INSUFFICIENT_EVIDENCE`, because no advertiser record is ever constructed. |
| `eligibleForCompanyClaim` | **false**, structurally | `MATCHED` is the only state that sets it, and `MATCHED` requires `advertiser.verified`. |

**Fallback (what Report 1 should do instead):** do not add a LinkedIn provider. If and when WP-1's
`platform` dimension lands, LinkedIn may be represented as a platform whose observation outcome is
the fixed terminal state `unavailable`, with a reason string in the house idiom — *"LinkedIn
publishes no programmatically obtainable advertising repository; absence of evidence here is not
evidence of absence of advertising."* That is a one-line data statement, not a provider. No
acquisition, no browser job, no scheduler entry, no credential.

---

## 2. EVIDENCE — WHAT WAS ACTUALLY FETCHED

Every row below is a real request made during this spike. No status is recalled or inferred.
Where a surface refused, the refusal was recorded and **no bypass of any kind was attempted** —
no UA rotation beyond a single ordinary desktop UA, no proxying, no session injection, no
challenge solving.

### 2.1 LinkedIn surfaces

| URL | Method / client | Status | Note |
| --- | --- | --- | --- |
| `https://www.linkedin.com/ad-library/api` | curl, desktop UA | **403** | The URL LinkedIn's own help article links to as "Ad Library API". |
| `https://www.linkedin.com/ad-library/api` | WebFetch (independent client/stack) | **403** | Same refusal from a second client — not a one-off. |
| `https://www.linkedin.com/ad-library/home` | curl, desktop UA | **403** | |
| `https://www.linkedin.com/ad-library/` | curl, desktop UA | **403** | |
| `https://www.linkedin.com/ad-library/search?companyIds=1035` | curl, desktop UA | **403** | Whether a stable company-ID query parameter exists could therefore not be observed. |
| `https://www.linkedin.com/robots.txt` | curl | **200** | 4 862 lines. See §2.2. |
| `https://www.linkedin.com/help/linkedin/answer/a1517918` | curl + WebFetch | **200** | Official "LinkedIn's Ad Library" help article. Text quoted in §3. |
| `https://www.linkedin.com/help/lms/answer/a1620070` | WebFetch | **200** | Official "Ad Library targeting parameters and impressions". |
| `https://www.linkedin.com/legal/user-agreement` | WebFetch | **200** | §8.2 quoted in §2.3. |
| `https://www.linkedin.com/legal/dsa` | curl | **404** | No such page at that path. |
| `https://developer.linkedin.com/product-catalog/marketing/advertising-api` | curl + WebFetch | **200** | Contains no mention of an Ad Library or of third-party ad data. |

**The one load-bearing HTML fact**, extracted from the help article's own markup (HTTP 200,
33 704 bytes):

```html
<a rel="" href="https://www.linkedin.com/ad-library/api" target="_blank">Ad Library API</a>
```

So LinkedIn's official, currently-served help article advertises an "Ad Library API" and links to
a URL that returns **403** to every unauthenticated client tried. That is the whole API story: the
product is referenced but its documentation is not served.

### 2.2 `robots.txt` — the governing constraint on the UI route

`https://www.linkedin.com/robots.txt` (HTTP 200, 120 190 bytes, 4 862 lines) enumerates ~40 named
crawlers with per-agent allowances. **No rule anywhere in the file mentions `ad-library`** (zero
case-insensitive matches). The file's final block, at line 4857, is the catch-all:

```
User-agent: *
Disallow: /

# Notice: If you would like to crawl LinkedIn,
# please email whitelist-crawl@linkedin.com to apply
# for white listing.
```

Any agent this platform would operate — including the existing Railway browser — falls under
`User-agent: *` and is disallowed from the entire site, Ad Library included. LinkedIn additionally
states the remedy: apply for whitelisting. That is a commercial negotiation with LinkedIn, not an
engineering task, and it is outside any wave's scope.

### 2.3 LinkedIn User Agreement §8.2 ("Don'ts") — the contractual constraint

Fetched from `https://www.linkedin.com/legal/user-agreement` (HTTP 200). Three clauses are
directly dispositive:

- *"Develop, support or use software, devices, scripts, robots or any other means or processes
  (such as crawlers, browser plugins and add-ons or any other technology) to scrape or copy the
  Services, including profiles and other data from the Services"*
- *"Use bots or other unauthorized automated methods to access the Services"*
- *"Override any security feature or bypass or circumvent any access controls or use limits of the
  Services"*

The 403s observed in §2.1 are an access control. Under the no-circumvention rule they are a
**finding**, not an obstacle to route around.

### 2.4 The API gateway 401 proves nothing — control experiment

The architecture audit's note that `api.linkedin.com` responds to an `adLibrary` path was tested
properly, with a control:

| URL | Status | Body |
| --- | --- | --- |
| `https://api.linkedin.com/rest/adLibrary?q=criteria` | 401 | `{"status":401,"serviceErrorCode":65604,"code":"EMPTY_ACCESS_TOKEN","message":"Empty oauth2 access token"}` |
| `https://api.linkedin.com/rest/adLibrary` | 401 | *(identical body)* |
| `https://api.linkedin.com/v2/adLibrary` | 401 | *(identical body)* |
| **`https://api.linkedin.com/rest/thisPathDoesNotExist12345`** | **401** | **(identical body)** |

The gateway returns `EMPTY_ACCESS_TOKEN` for a deliberately nonsensical path. **The 401 is
path-independent**: it is emitted before routing. It is therefore *not* evidence that an
`adLibrary` resource exists. Any future claim that "the endpoint responds, we just need a token"
is unsupported by this evidence and must not be repeated.

### 2.5 No published API reference exists

| URL | Status |
| --- | --- |
| `https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/ad-library` | **404** |
| `https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/ad-library-api` | **404** |
| `https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/adlibrary` | **404** |
| `https://learn.microsoft.com/en-us/linkedin/marketing/community-management/ad-library` | **404** |
| `https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/advertising-targeting/ad-library` | **404** |

Microsoft Learn is the official home of LinkedIn's API documentation. A domain-restricted search
of `learn.microsoft.com` / `developer.linkedin.com` / `linkedin.com` for an Ad Library API
reference returned no LinkedIn API reference page — the only API-reference hit was Microsoft
Advertising's (a different product; see §6). The upstream docs repository
(`MicrosoftDocs/linkedin-api-docs`, named in the Learn page metadata) is not publicly readable —
`gh api repos/MicrosoftDocs/linkedin-api-docs/git/trees/live` returned **HTTP 404 Not Found** on an
authenticated token — so it could not be searched either.

### 2.6 The obtainable LinkedIn API cannot see a third party

From `https://learn.microsoft.com/en-us/linkedin/marketing/integrations/marketing-tiers`
(HTTP 200, official, `ms.date 2026-04-01`, default moniker `li-lms-2026-09`):

> "LinkedIn has two tiers of access to our Advertising API: Development and Standard."

| Tier | API access granted (quoted) |
| --- | --- |
| Development | "**Read:** No limits on reading data related to **Ad Accounts you administer**" |
| Standard | "**Read**: No limits on reading data related to **Ad Accounts you administer**" |

> "Access to the Advertising API is reserved for applications building supported use cases."
> "LinkedIn reserves the right to review applications and select partners at its discretion and a
> partner might not be upgraded even if they meet these minimum requirements."

Both tiers are **application-gated, not self-serve**, and both are scoped to accounts the caller
administers. The product-catalog page
(`https://developer.linkedin.com/product-catalog/marketing/advertising-api`, HTTP 200) lists four
supported use cases — campaign/creative management, performance analytics, audience targeting,
event promotion — and makes **no mention of an Ad Library, of competitor data, or of any
third-party advertiser**. A subject company could in principle grant this platform OAuth access to
its *own* ad account, but that yields self-reported first-party campaign data, not public
observation; it would carry provenance `TENANT_DECLARED`, not `PUBLIC_OBSERVED`, and it cannot see
anyone else. It is a different capability from the one WP-8 was asked to assess.

### 2.7 EUR-Lex itself refused automated access

Direct fetches of the DSA text were challenged and are recorded as such:

| URL | Status |
| --- | --- |
| `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32022R2065` | **202**, 0 bytes (bot challenge) |
| `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=OJ:L:2022:277:FULL` | **202**, 2 038 bytes (challenge page) |
| `https://eur-lex.europa.eu/eli/reg/2022/2065/oj/eng` (WebFetch) | empty body |
| `http://publications.europa.eu/resource/celex/32022R2065` | **404** |

No evasion was attempted. Article 39 is therefore cited in §5 from a **third-party verbatim
mirror**, explicitly labelled as such.

---

## 3. FIELD MATRIX — WHAT THE AD LIBRARY PUBLISHES

Source: `https://www.linkedin.com/help/linkedin/answer/a1517918` (official, HTTP 200) and
`https://www.linkedin.com/help/lms/answer/a1620070` (official, HTTP 200). Verbatim from the first:

> "As part of our commitment to creating a safe and trusted ad experience, the Ad Library includes
> information about ads served on LinkedIn, including: Ad preview / Ad format / Advertiser name /
> Payer name / Whether the ad is restricted"
>
> "Keep in mind, to comply with the law we don't display the ad preview, advertiser name, or payer
> name for restricted ads."
>
> "The Ad Library includes ads that ran on LinkedIn after June 1, 2023, and ads remain in Ad
> Library for one year after their last impression on LinkedIn."

### 3.1 Search / filter dimensions (official)

| Filter | Scope | Source |
| --- | --- | --- |
| Company or advertiser name | All ads | a1517918 |
| Payer name | All ads | a1517918 |
| Keyword | All ads | a1517918 |
| Country | All ads | a1517918 |
| Date range | All ads | a1517918 |
| Impression range | **EU-targeted ads only**, behind a "More" button | a1517918 |
| Ad targeting parameters | **EU-targeted ads only**, behind a "More" button | a1517918 |

### 3.2 Published fields

| Field | Published? | EU-only? | Official source | Notes |
| --- | --- | --- | --- | --- |
| Ad preview (creative) | Yes | No | a1517918 | Withheld for restricted ads. |
| Ad format | Yes | No | a1517918 | |
| Advertiser name | Yes | No | a1517918 | A **Page/display name**. No legal-entity guarantee, no verification flag. Withheld for restricted ads. |
| **Payer name** | **Yes** | No | a1517918 | The DSA Art. 39(2)(c) funding entity. Withheld for restricted ads. See §4. |
| Restriction status | Yes | No | a1517918 | |
| Dates the ad ran | Yes | **EU-targeted only** | a1517918 | "information about ad impressions, ad targeting, and the dates the ad ran". |
| Estimated total impressions | Yes | **EU-targeted only** | a1620070 | |
| Impression breakdown by country | Yes | **EU-targeted only** | a1620070 | "rounded to the nearest percent", `<1%` for 0–1%. |
| Targeting parameters (12 categories) | Yes | **EU-targeted only** | a1620070 | Language, Job, Education, Company, Location, Audience, Age, Gender, Demographic, Member Interests and Traits, Predictive Audience, Audience Expansion Targeting. Inclusion vs exclusion indicated. |
| **Advertiser verification flag** | **No** | — | absent from a1517918 | **Decisive.** No equivalent of Google's "Advertiser has verified their identity". |
| **Advertiser legal name (as a distinct field)** | **No** | — | absent from a1517918 | Not in the official field list. Third-party guides claim EU ads show a legal entity name when it differs from the brand page — *unverified third-party claim*, and in any case it would be EU-only and unverified. |
| **Advertiser jurisdiction / "based in"** | **No** | — | absent from a1517918 | No per-advertiser country field; only per-ad impression country shares, EU-only. |
| **Destination URL** | **No** | — | absent from a1517918 | Not published as a field. Rules out the secondary destination-domain discovery path the Google provider uses. |
| **Stable advertiser identifier** | **Unobservable** | — | — | The `companyIds` query parameter probe returned 403; its stability could not be assessed. |
| **Ambiguity warning** | **No** | — | absent from a1517918 | No equivalent of Google's "Multiple advertiser accounts have a similar name". |
| Retention window | Ads from **2023-06-01**; retained **1 year after last impression** | No | a1517918 | |

**Compared with the Google surface the resolver was built for**, LinkedIn is missing four of the
five inputs `ObservedAdvertiser` needs: `legalName` (as a distinct, reliable field), `basedIn`,
`verified`, and `ambiguityFlagged`. Only `advertiserId` has a plausible analogue, and it could not
be observed. A LinkedIn provider could not populate the existing observation type.

---

## 4. IDENTITY-ANCHOR ANALYSIS — CAN THE PAYER NAME SUBSTITUTE FOR GOOGLE'S `verified`?

**No.** It is a genuinely interesting anchor and it is not sufficient.

### Why it looked promising

LinkedIn is the only surface in scope that publishes the **funding entity separately from the
advertiser**, and it is a *searchable* dimension, not merely a displayed one. Google publishes no
payer at all. A payer name is a billing-side string: LinkedIn collected it for legal compliance
rather than letting the advertiser choose it as a display label, which makes it closer to a legal
entity name than a Page name is. Where a brand advertises through an agency or a holding company,
the payer is often the only place the real legal entity surfaces.

### Why it fails against this codebase's actual rule

`resolveAdvertiserIdentity` reaches `MATCHED` only through this gate:

```
if (!advertiser.verified) {
  return deny('PROBABLE_MATCH',
    'The legal names agree but the advertiser identity is not provider-verified.');
}
```

The comment above it states the reasoning the whole design rests on:

> "Google's verification is what makes the advertiser side an independent assertion rather than
> another copy of the public brand string."

This is the same objection the file already records against matching a Wikidata label: two strings
derived from the same public usage agreeing with each other demonstrates only that two systems
know the brand. That is correlated evidence, not corroboration.

A LinkedIn payer name is **not accompanied by any published verification assertion**. LinkedIn
does not state that it verified the payer's identity, and publishes no flag this platform could
read. So payer-name agreement is exactly the `PROBABLE_MATCH` case the existing rule already
handles correctly — and `PROBABLE_MATCH` sets `eligibleForCompanyClaim: false`.

Three further defects, each independently sufficient:

1. **No ambiguity signal.** LinkedIn publishes no "multiple similar advertisers" warning. The
   Google resolver uses that warning to block attribution *and* exclusion symmetrically. Without
   it, a LinkedIn name collision is silently indistinguishable from a true match — the resolver
   would be blind in exactly the direction the `Wix` case was built to defend.
2. **No jurisdiction corroboration.** No per-advertiser country field, so the final corroboration
   step degrades to "both unknown", and the `bothJurisdictionsKnown` branch never fires.
3. **Restricted ads blank the anchor.** Official text: payer name is not displayed for restricted
   ads. The anchor is absent precisely where scrutiny would matter most.

### Conclusion

Ceiling = **`PROBABLE_MATCH`**. `MATCHED` is **structurally unreachable** for LinkedIn from public
evidence alone — and that conclusion is independent of the access problem. Even a whitelisted
crawl or a granted Ad Library API key would not raise the ceiling, because the ceiling is set by
what LinkedIn *publishes*, not by what this platform can *reach*. Raising it would require
LinkedIn to begin publishing a verification assertion. **Do not attempt to compensate with
similarity matching, suffix stripping, or token overlap** — §5 of the resolver prohibits all
three, and the `Wix` / `Booking.com` cases recorded in that file show why.

---

## 5. THE REGULATORY PREMISE — VERIFIED, AND IT DOES NOT HELP

**LinkedIn is a designated VLOP.** Designated by the European Commission on 2023-04-25 in the
first batch under the DSA. *(Multiple secondary sources concur; the Commission's own designation
page was not fetched directly in this spike — treat the exact date as secondary, the designation
itself as uncontested and independently corroborated by LinkedIn's own compliance behaviour: the
Ad Library's EU-only fields exist precisely because of it.)*

**DSA Article 39 ("Additional online advertising transparency")** obliges designated VLOPs to
compile and make publicly available an advertisements repository, accessible "through its
interface, **API**, and searchable tools", retained for **one year after the advertisement was
last presented**, excluding recipients' personal data. Article 39(2) requires, among other items:

- (b) the natural or legal person **on whose behalf** the advertisement is presented;
- (c) the natural or legal person **who paid for** the advertisement, if different from (b);
- (d) the period during which the advertisement was presented;
- (e) whether it was targeted to particular groups, and the main targeting parameters;
- (g) total reach and aggregate numbers broken down by Member State.

*Source: third-party verbatim mirror `https://www.eu-digital-services-act.com/Digital_Services_Act_Article_39.html`
(HTTP 200). **Labelled third-party**: EUR-Lex returned HTTP 202 bot challenges to four separate
official-URL attempts (§2.7) and no evasion was attempted. Before any commercial or legal reliance
is placed on this wording, re-read Article 39 from EUR-Lex in a browser.*

Article 39 explains the field matrix in §3 exactly — payer separate from advertiser, EU-only
impressions and targeting, one-year retention. The premise is sound.

**But the obligation runs to the regulator and the public, not to this platform, and it does not
create an entitlement.** Three observations follow:

1. The Article 39 API obligation is satisfied, in LinkedIn's judgement, by whatever sits behind
   `linkedin.com/ad-library/api` — a URL that returns 403 to the public. Whether that constitutes
   compliance is a matter for the Commission and the Irish Digital Services Coordinator. It is not
   a lever this platform can pull.
2. Article 39's minimum content does **not** include an identity-verification assertion. So even
   full, frictionless Article 39 compliance would still leave `MATCHED` unreachable (§4). The
   regulation guarantees *transparency about ads*, not *verified identity of advertisers*.
3. **Article 40 is not a fallback.** DSA Art. 40 vetted-researcher data access is restricted to
   researchers affiliated to a research organisation, **independent from commercial interests**,
   vetted by a Digital Services Coordinator, for the sole purpose of researching systemic risks. A
   commercial SaaS product generating customer-facing company reports is categorically ineligible.
   Do not propose this route again.

---

## 6. ADJACENT FINDING (NOT WP-8 SCOPE, RECORDED SO IT IS NOT LOST)

Searches for "Ad Library API" surface
`https://learn.microsoft.com/en-us/advertising/guides/ad-library-api`. **This is Microsoft
Advertising (Bing), not LinkedIn.** Its own description: *"The Ad Library is a public transparency
tool that allows you to view all ads shown on Bing.com."* It covers Bing search ads, EEA-delivered
only, and does **not** cover LinkedIn ads. Anyone researching this area will hit it and may
mistake it for LinkedIn's; it is recorded here so that confusion is resolved once.

It is nonetheless a genuinely open transparency API, which is worth noting because it is the
counterexample that makes the LinkedIn verdict credible. Verified live during this spike, with no
credential of any kind:

```
GET https://adlibrary.api.bingads.microsoft.com/api/v1/Advertisers?searchText=HubSpot&top=3
→ 200
{"@odata.count":2,"value":[
  {"AdvertiserId":4295007715,"AdvertiserName":"Hubspot, Inc.",
   "AdvertiserCountry":"United States","IsVerified":true},
  {"AdvertiserId":187119795,"AdvertiserName":"Afick HubSpot Ads Account",
   "AdvertiserCountry":"United States","IsVerified":false}]}

GET https://adlibrary.api.bingads.microsoft.com/api/v1/Ads/78202980498079
      ?expand=AdDetails(expand=ImpressionsByCountry,Targets)
→ 200
{"AdId":78202980498079,"AdvertiserName":"Hubspot, Inc.","AdvertiserId":4295007715,
 "DestinationUrl":"https://www.hubspot.jp/products/marketing/forms",
 "AdDetails":{"PaidForByName":null,"StartDate":"2025-04-04","EndDate":"2026-09-24",
   "TotalImpressionsRange":"2.5K - 5K",
   "ImpressionsByCountry":[{"Country":"Austria","ImpressionShare":"1.8%"}, …]}}
```

Note what that second result contains and LinkedIn's does not: `IsVerified` (a provider
verification assertion), `AdvertiserCountry` (jurisdiction), `AdvertiserName` documented as "the
name of the account **or legal name of a verified advertiser**", `PaidForByName` (payer), and
`DestinationUrl`. Those are, field for field, the five inputs `ObservedAdvertiser` needs — the
exact set LinkedIn withholds. Authentication, per the official doc: *"Like the Ad Library UI, the
Ad Library API is publicly available and doesn't require any user sign-up or log-in"*, with higher
rate limits available via a free Microsoft Advertising developer token. The live 200s above are
the proof.

**This is not a WP-8 deliverable and nothing was built for it.** It is flagged for the
orchestrator as a candidate second provider worth its own scoped decision, because — unlike
LinkedIn — its surface is open, its terms permit it, and it can reach `MATCHED` under the existing
resolver unchanged. Its limits (Bing search ads only, EEA/EU impressions only, since June 2023)
would need their own assessment. **Do not treat this paragraph as authorisation to build it.**

---

## 7. WHAT A FUTURE WP-8 IMPLEMENTATION WOULD REQUIRE

Three preconditions, in dependency order. **All three must hold.** Today none does.

1. **A lawful, obtainable access route.** Exactly one of:
   - LinkedIn serves the Ad Library API publicly, with a published reference (today: 403 and no
     reference); **or**
   - LinkedIn grants this platform API/partner access on written application — a commercial
     negotiation with no published self-serve path and no documented SLA; **or**
   - LinkedIn whitelists this platform's crawler via `whitelist-crawl@linkedin.com`, the remedy
     its own `robots.txt` names. Also commercial, also discretionary.

   Absent one of these in writing, **no acquisition code may be written**, because any automated
   fetch would breach `robots.txt` and User Agreement §8.2. This is a hard gate, not a preference.

2. **A verification assertion, or an explicit decision to live at `PROBABLE_MATCH`.** Either
   LinkedIn begins publishing a per-advertiser verification flag — outside this platform's control
   and not required by Article 39 — or the programme consciously accepts that LinkedIn advertising
   can only ever appear as an unattributed candidate in `otherAdvertisers`, never as the company's
   own advertising. **That second option is a product decision with a real cost**: the report would
   show LinkedIn ads it is not permitted to say belong to the subject. Whether that is worth
   surfacing at all should be settled *before* any build, not discovered after it.

3. **Observation-type extension, which is a real design problem, not a mapping exercise.**
   `ObservedAdvertiser` requires `legalName`, `basedIn`, `verified`, `ambiguityFlagged`. LinkedIn
   supplies none of them. Filling them with `null`/`false` would make every LinkedIn record take
   the `INSUFFICIENT_EVIDENCE` branch on the first guard — correct, but pointless. Doing better
   means a per-platform capability descriptor saying which anchors a platform publishes, so the
   resolver can refuse honestly rather than by accident. **That is WP-1's `platform` dimension and
   WP-2's identity anchors, not WP-8's.** WP-8 should not pre-empt either.

**Sequencing:** precondition 1 is commercial and gates everything. Until it is satisfied in
writing, the only correct WP-8 artefact is this document. If it is ever satisfied, re-run §2's
probes before writing a line of code — this evidence has a short shelf life.

**Explicitly out of bounds, permanently:** scraping the Ad Library UI, any anti-bot evasion, any
authenticated-session reuse, any third-party scraper marketplace (several exist and were observed
in search results; all operate against §8.2 and none may be used as a data source), and any
inference of advertiser identity by name similarity.

---

## 8. SUMMARY TABLE

| Question asked of WP-8 | Answer | Basis |
| --- | --- | --- |
| 1. What is reachable without authentication? | **Nothing programmatically.** Every `/ad-library*` path returned **403**. The UI is open to a human browser per official help, but `robots.txt` `Disallow: /` and UA §8.2 forbid automated access. | §2.1, §2.2, §2.3 |
| 2. Does a usable public API exist? | **No usable one.** Officially referenced as "Ad Library API", linked from a live help article, **403** from two clients, **zero** published reference (five candidate doc paths all 404). The gateway 401 is path-independent and proves nothing. The obtainable Advertising API is application-gated and scoped to "Ad Accounts you administer". | §2.1, §2.4, §2.5, §2.6 |
| 3. What fields are available? | Advertiser name, payer name, preview, format, restriction — all ads. Impressions, country split, 12 targeting categories, run dates — **EU-targeted ads only**. No verification flag, no jurisdiction, no destination URL. | §3 |
| 4. Practical automation feasibility? | **Zero**, under the no-circumvention rule. The only lawful paths are a LinkedIn partner grant or crawler whitelisting — both commercial, neither self-serve. | §2.2, §2.3, §7 |
| 5. Reachable `AdvertiserResolutionState`? | Ceiling **`PROBABLE_MATCH`**. `MATCHED` structurally unreachable: payer name carries no provider verification assertion, and no ambiguity or jurisdiction signal exists. Today, no state at all — no observation is constructible. | §4 |
| **Provider decision** | **UNAVAILABLE** | §1 |

---

*Spike only. No provider, no schema change, no production change, no flag change, no acquisition.
Google acquisition, the scheduler, the customer-only gate, the dark-default endpoint and the
existing advertising rule were all read-only inputs and are untouched.*
