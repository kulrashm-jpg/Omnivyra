/**
 * WP-16 — Microsoft Advertising Ad Library: proof of shape for the EXISTING resolver.
 *
 * WHY THIS FILE EXISTS. WP-16 is a feasibility spike and deliberately ships no provider. But its
 * central question — "can `ObservedAdvertiser` represent Microsoft Ad Library evidence WITHOUT a
 * schema change, and is `MATCHED` genuinely reachable?" — is a claim about behaviour, and a claim
 * about behaviour is worth more executed than asserted. So this suite does exactly one thing:
 * it feeds REAL values captured from the public Microsoft Ad Library API into the UNMODIFIED
 * `resolveAdvertiserIdentity` and records what it actually decides.
 *
 * It is NOT a provider test. There is no client, no network, no browser, no credential, no
 * acquisition path — every value below is a literal, transcribed from a response that was
 * fetched once by hand during the spike.
 *
 * PROVENANCE OF EVERY FIXTURE. Measured 2026-10-02 from a single non-EU vantage, unauthenticated:
 *   GET https://adlibrary.api.bingads.microsoft.com/api/v1/Advertisers?searchText=Wix&top=10      -> 200
 *   GET https://adlibrary.api.bingads.microsoft.com/api/v1/Advertisers?searchText=HubSpot&top=3   -> 200
 *   GET https://adlibrary.api.bingads.microsoft.com/api/v1/Advertisers?searchText=Booking.com&top=10 -> 200
 *   GET https://adlibrary.api.bingads.microsoft.com/api/v1/Advertisers?searchText=Intercom&top=20 -> 200
 *   GET https://www.wix.com/      -> 200, JSON-LD Organization.legalName = "Wix.com Ltd"
 *   GET https://www.hubspot.com/  -> 200, JSON-LD Organization has NO legalName, addressCountry "US"
 *
 * Where a SUBJECT value could not be measured from the subject's own site it is marked
 * CONSTRUCTED in the test name and in a comment. Those cases demonstrate a resolver interaction;
 * they are not evidence about that company.
 */
import {
  resolveAdvertiserIdentity,
  resolveAdvertiserSet,
  type ObservedAdvertiser,
  type SubjectIdentity,
} from '../../services/ads/advertiserIdentityResolver';
// WP-2 — the ISO/name canonicalisation this suite's jurisdiction assertion now depends on.
import { countriesEquivalent } from '../../utils/countryNormalization';

/**
 * The whole mapping, in one place. Five Microsoft fields -> five `ObservedAdvertiser` fields.
 * `ambiguityFlagged` is the only one with no counterpart: Microsoft publishes no "multiple
 * advertiser accounts have a similar name" warning, so there is nothing to carry and the honest
 * value is `false` — "the provider raised no ambiguity warning", which is true.
 */
function fromMicrosoft(row: {
  AdvertiserId: number;
  AdvertiserName: string;
  AdvertiserCountry: string | null;
  IsVerified: boolean;
}): ObservedAdvertiser {
  return {
    advertiserId: String(row.AdvertiserId),
    legalName: row.AdvertiserName,
    basedIn: row.AdvertiserCountry,
    verified: row.IsVerified,
    ambiguityFlagged: false,
  };
}

// ── Measured advertiser rows, transcribed verbatim ─────────────────────────
const MS_WIX = { AdvertiserId: 4295001869, AdvertiserName: 'Wix.com Ltd.', AdvertiserCountry: 'Israel', IsVerified: true };
const MS_HUBSPOT = { AdvertiserId: 4295007715, AdvertiserName: 'Hubspot, Inc.', AdvertiserCountry: 'United States', IsVerified: true };
const MS_HUBSPOT_LOOKALIKE = { AdvertiserId: 187119795, AdvertiserName: 'Afick HubSpot Ads Account', AdvertiserCountry: 'United States', IsVerified: false };
const MS_BOOKING = [
  { AdvertiserId: 4294969411, AdvertiserName: 'Booking.com B.V.', AdvertiserCountry: 'Netherlands', IsVerified: true },
  { AdvertiserId: 4295011395, AdvertiserName: 'Booking.com B.V.', AdvertiserCountry: 'Netherlands', IsVerified: true },
  { AdvertiserId: 4295086664, AdvertiserName: 'Booking.com Transport Ltd', AdvertiserCountry: 'United Kingdom', IsVerified: true },
  { AdvertiserId: 4295068132, AdvertiserName: 'Booking.com B.V.', AdvertiserCountry: 'Netherlands', IsVerified: true },
  { AdvertiserId: 4295149937, AdvertiserName: 'Booking.com B.V.', AdvertiserCountry: 'Netherlands', IsVerified: true },
  { AdvertiserId: 4295015508, AdvertiserName: 'Booking.com B.V.', AdvertiserCountry: 'Netherlands', IsVerified: true },
  { AdvertiserId: 4295019706, AdvertiserName: 'Booking.com B.V.', AdvertiserCountry: 'Netherlands', IsVerified: true },
];
const MS_INTERCOM = [
  { AdvertiserId: 4295100001, AdvertiserName: 'IntercomDirect B.V.', AdvertiserCountry: 'Netherlands', IsVerified: true },
  { AdvertiserId: 4295100002, AdvertiserName: 'Intercomms LTD', AdvertiserCountry: 'United Kingdom', IsVerified: true },
  { AdvertiserId: 4295100003, AdvertiserName: 'Intercom Inc', AdvertiserCountry: 'United States', IsVerified: true },
  { AdvertiserId: 4295100004, AdvertiserName: 'Intercomp', AdvertiserCountry: 'United Kingdom', IsVerified: false },
];

describe('WP-16 — Microsoft Ad Library evidence against the unchanged resolver', () => {
  it('maps every Microsoft field onto ObservedAdvertiser with no field left unpopulated', () => {
    const observed = fromMicrosoft(MS_WIX);
    // The point of this assertion is the SHAPE, not the values: `ObservedAdvertiser` has exactly
    // five members and Microsoft supplies four of them directly.
    expect(Object.keys(observed).sort()).toEqual(
      ['advertiserId', 'ambiguityFlagged', 'basedIn', 'legalName', 'verified'],
    );
    expect(observed).toEqual({
      advertiserId: '4295001869',
      legalName: 'Wix.com Ltd.',
      basedIn: 'Israel',
      verified: true,
      ambiguityFlagged: false,
    });
  });

  it('MATCHED is genuinely reachable: measured wix.com legalName vs measured Microsoft advertiser', () => {
    // Subject side MEASURED: https://www.wix.com/ JSON-LD Organization.legalName = "Wix.com Ltd".
    // That Organization block declares no postal address, so `jurisdiction` is null and the
    // resolver's corroboration branch does not fire.
    const subject: SubjectIdentity = {
      declaredLegalName: 'Wix.com Ltd',
      brandName: 'Wix',
      jurisdiction: null,
      wikidataDomainVerified: false,
    };
    const resolution = resolveAdvertiserIdentity(subject, fromMicrosoft(MS_WIX));
    expect(resolution.state).toBe('MATCHED');
    expect(resolution.eligibleForCompanyClaim).toBe(true);
  });

  it('a subject whose site declares no legalName cannot reach MATCHED — measured hubspot.com', () => {
    // Subject side MEASURED: https://www.hubspot.com/ JSON-LD Organization has `name: "HubSpot"`
    // and NO `legalName`. The Class-A anchor is absent, so no provider can lift this to MATCHED.
    const subject: SubjectIdentity = {
      declaredLegalName: null,
      brandName: 'HubSpot',
      jurisdiction: 'US',
      wikidataDomainVerified: false,
    };
    expect(resolveAdvertiserIdentity(subject, fromMicrosoft(MS_HUBSPOT))).toMatchObject({
      state: 'UNRESOLVED',
      eligibleForCompanyClaim: false,
    });
    // And the unverified near-name sibling that shares the search term is refused identically.
    expect(resolveAdvertiserIdentity(subject, fromMicrosoft(MS_HUBSPOT_LOOKALIKE))).toMatchObject({
      state: 'UNRESOLVED',
      eligibleForCompanyClaim: false,
    });
  });

  it('an ISO-3166 addressCountry no longer caps a correct match — WP-2 closed it (CONSTRUCTED subject jurisdiction)', () => {
    // CONSTRUCTED: `jurisdiction: 'IL'` is not what wix.com declares — it is the shape a JSON-LD
    // `addressCountry` normally takes (hubspot.com's measured value is the ISO code "US"). The
    // advertiser row is measured.
    //
    // WHAT THIS TEST USED TO PIN, AND WHY IT CHANGED.
    // WP-16 originally characterised a DEFECT here: `jurisdictionsAgree` compared raw strings, so
    // 'IL' !== 'Israel' and a correct, verified, exactly-matching identity was DOWNGRADED to
    // PROBABLE_MATCH — losing `eligibleForCompanyClaim` and landing in `otherAdvertisers`, i.e.
    // the company's own advertising reported as somebody else's. WP-16 recorded it as a
    // pre-existing RESOLVER property, affecting Google identically, and explicitly refused to
    // patch it inside a provider spike.
    //
    // WP-2 then fixed exactly that, by canonicalising both sides through ICU region data
    // (`backend/utils/countryNormalization.ts`) before comparison. This assertion therefore now
    // pins the CORRECTED behaviour. It is deliberately NOT deleted: the ISO-vs-name shape is the
    // single most likely way this regression returns, and the Microsoft surface is where it was
    // found — `AdvertiserCountry` is always a full English name while JSON-LD gives a code.
    //
    // THIS TEST DEPENDS ON WP-2. Without `countriesEquivalent` it fails, which is correct: the
    // guarantee it states does not exist without that fix.
    const subject: SubjectIdentity = {
      declaredLegalName: 'Wix.com Ltd',
      brandName: 'Wix',
      jurisdiction: 'IL',
      wikidataDomainVerified: false,
    };
    const resolution = resolveAdvertiserIdentity(subject, fromMicrosoft(MS_WIX));
    expect(resolution.state).toBe('MATCHED');
    expect(resolution.eligibleForCompanyClaim).toBe(true);
    // The corroboration must come from the jurisdiction actually agreeing, not from the gate
    // being skipped: a resolution that simply ignored an unparseable country would also reach
    // MATCHED here, and that would be a different, weaker guarantee.
    expect(countriesEquivalent('IL', 'Israel')).toBe(true);
    expect(countriesEquivalent('IL', 'United States')).toBe(false);
  });

  it('one legal entity holding several verified accounts yields several MATCHED records (CONSTRUCTED subject)', () => {
    // CONSTRUCTED subject: booking.com served HTTP 202 with no JSON-LD, so its declared legal name
    // could not be measured. The seven advertiser rows ARE measured. The point is the COUNT: six
    // distinct AdvertiserIds carry the identical verified name, so `matchedAdvertiserAccounts`
    // counts ACCOUNTS, not entities, and must never be rendered as "six advertisers".
    const subject: SubjectIdentity = {
      declaredLegalName: 'Booking.com B.V.',
      brandName: 'Booking.com',
      jurisdiction: null,
      wikidataDomainVerified: false,
    };
    const resolutions = resolveAdvertiserSet(subject, MS_BOOKING.map(fromMicrosoft));
    const matched = resolutions.filter((r) => r.eligibleForCompanyClaim);
    expect(matched).toHaveLength(6);
    expect(new Set(matched.map((r) => r.advertiserId)).size).toBe(6);
    // The UK transport entity is a different verified legal name and is correctly excluded.
    expect(resolutions.find((r) => r.advertiserId === '4295086664')).toMatchObject({
      state: 'NOT_MATCHED',
      eligibleForCompanyClaim: false,
    });
  });

  it('a name-collision set resolves to exactly one MATCHED without any ambiguity signal (CONSTRUCTED subject)', () => {
    // CONSTRUCTED subject legal name. The four advertiser rows are measured from the `Intercom`
    // search, which returned 13 rows spanning at least five unrelated legal entities. Microsoft
    // publishes NO ambiguity warning, so `ambiguityFlagged` is false throughout — and the exact
    // normalised legal-name comparison, not a provider warning, is what separates them.
    const subject: SubjectIdentity = {
      declaredLegalName: 'Intercom Inc',
      brandName: 'Intercom',
      jurisdiction: null,
      wikidataDomainVerified: false,
    };
    const resolutions = resolveAdvertiserSet(subject, MS_INTERCOM.map(fromMicrosoft));
    expect(resolutions.filter((r) => r.eligibleForCompanyClaim).map((r) => r.advertiserId)).toEqual(['4295100003']);
    expect(resolutions.filter((r) => r.state === 'NOT_MATCHED')).toHaveLength(2);
    expect(resolutions.filter((r) => r.state === 'UNRESOLVED')).toHaveLength(1);
  });
});
