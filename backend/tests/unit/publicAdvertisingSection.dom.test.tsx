/**
 * @jest-environment jsdom
 *
 * WP-9 / PO-3 — React presentation of publicly observed advertising.
 *
 * ─── WHAT THESE TESTS ARE FOR ─────────────────────────────────────────────
 * The advertising surface is the one place in Report 1 where a rendering mistake becomes a
 * FABRICATED CLAIM about the customer's business: saying an ad account is theirs when the
 * resolver refused to say so, or saying they do not advertise when we simply could not look.
 *
 * So these tests do not check layout. They check the four things that can hurt someone:
 *   1. every evidence state renders as a DISTINCT, correctly-worded state;
 *   2. an unread public surface is never rendered as "the company does not advertise";
 *   3. internal resolver state names never reach the page;
 *   4. no performance figure (spend, CTR, ROAS, CAC, impressions) is ever invented — the public
 *      transparency record contains none of them.
 *
 * They are written against the semantics of the HTML export
 * (`backend/services/intelligence/exportRendererReport1.ts` -> `renderPublicAdvertising`), which
 * is the authority on the customer-facing wording and on the guards.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import PublicAdvertisingSection, {
  type PublicAdvertisingSectionProps,
} from '../../../components/reports/advertising/PublicAdvertisingSection';
import {
  buildFreshness,
  buildPublicAdvertisingView,
  toEvidenceState,
} from '../../../components/reports/advertising/publicAdvertisingView';
import type { ReportData } from '../../../pages/reports/view/reportView.types';

/** Fixed clock — observation age is a rendered state, so it must not depend on the wall clock. */
const NOW = new Date('2026-09-30T12:00:00.000Z');

type AnyAdvertising = any;

function advertiserFixture(overrides: Record<string, unknown> = {}): AnyAdvertising {
  return {
    advertiserId: 'AR01',
    legalName: 'Example Holdings Ltd',
    basedIn: 'United Kingdom',
    verified: true,
    ambiguityFlagged: false,
    adCountLabel: '~300 ads',
    creativeIds: ['c1', 'c2'],
    profileUrl: 'https://adstransparency.example/advertiser/AR01',
    resolutionState: 'MATCHED',
    resolutionBasis: 'Website-declared legal name matches the provider-verified advertiser legal name.',
    discoveredVia: 'advertiser_name',
    ...overrides,
  };
}

function advertisingFixture(overrides: Record<string, unknown> = {}): AnyAdvertising {
  return {
    accessState: 'observed',
    reason: null,
    source: 'ads_transparency',
    provenance: 'PUBLIC_OBSERVED',
    vantage: 'London, United Kingdom',
    observedAt: '2026-09-27T08:08:00.000Z',
    subjectLegalNameUsed: 'Example Holdings Ltd',
    companyAdvertisers: [],
    otherAdvertisers: [],
    counts: {
      domainAdCountLabel: '~4K ads',
      advertiserAccountsDiscovered: 3,
      matchedAdvertiserAccounts: 0,
    },
    ...overrides,
  };
}

function renderSection(advertising: AnyAdvertising) {
  return render(<PublicAdvertisingSection advertising={advertising} now={NOW} />);
}

/** Everything a customer can read on the page. */
function visibleText(container: HTMLElement): string {
  return container.textContent ?? '';
}

/** The disclaimer legitimately contains the words "does not advertise"; nothing else may. */
const ABSENCE_DISCLAIMER = 'This is not a finding that the company does not advertise.';

const ABSENCE_CLAIM_PATTERNS = [
  /(?:is|are|was|were|do|does|did)\s+not\s+(?:currently\s+)?advertis/i,
  /\bno\s+(?:paid\s+)?(?:advertising|ads)\b/i,
  /\bnot\s+running\s+(?:any\s+)?ads\b/i,
  /\bnever\s+advertis/i,
];

const INTERNAL_STATE_PATTERNS = [
  /\bMATCHED\b/,
  /\bPROBABLE_MATCH\b/,
  /\bNOT_MATCHED\b/,
  /\bUNRESOLVED\b/,
  /\bINSUFFICIENT_EVIDENCE\b/,
  /eligibleForCompanyClaim/,
  /accessState/,
  /resolutionState/,
  /resolutionBasis/,
  /subjectLegalNameUsed/,
  /ads_transparency/,
];

const PERFORMANCE_FIGURE_PATTERNS = [
  /\bspend\b/i,
  /\bbudget\b/i,
  /\bCTR\b/,
  /\bclick-?through\b/i,
  /\bROAS\b/,
  /\bCAC\b/,
  /\bimpressions?\b/i,
  /\bconversions?\b/i,
  /\bcost\s+per\b/i,
];

function assertCustomerSafe(container: HTMLElement) {
  const text = visibleText(container);
  const withoutDisclaimer = text.split(ABSENCE_DISCLAIMER).join(' ');
  for (const pattern of ABSENCE_CLAIM_PATTERNS) {
    expect(withoutDisclaimer).not.toMatch(pattern);
  }
  for (const pattern of INTERNAL_STATE_PATTERNS) {
    expect(text).not.toMatch(pattern);
  }
  for (const pattern of PERFORMANCE_FIGURE_PATTERNS) {
    expect(text).not.toMatch(pattern);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Absence of a payload
// ───────────────────────────────────────────────────────────────────────────

describe('PublicAdvertisingSection — no observation', () => {
  it('renders nothing at all when advertising is null', () => {
    const { container } = renderSection(null);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing at all when advertising is undefined', () => {
    const { container } = renderSection(undefined);
    expect(container.innerHTML).toBe('');
  });

  it('does not assert an absence of advertising when there is no payload', () => {
    const { container } = renderSection(null);
    // The strongest form of the guard: with no observation the page says NOTHING about ads,
    // rather than an empty section that reads as "we looked and found none".
    expect(visibleText(container)).toBe('');
    expect(screen.queryByTestId('advertising-section')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Section state: unavailable (we could not look)
// ───────────────────────────────────────────────────────────────────────────

describe('PublicAdvertisingSection — unavailable state', () => {
  const blocked = advertisingFixture({
    accessState: 'blocked',
    reason: 'The public ad transparency surface refused the request from this vantage.',
    companyAdvertisers: [],
    otherAdvertisers: [],
  });

  it('renders the unavailable state and carries the provider reason verbatim', () => {
    const { container } = renderSection(blocked);
    expect(screen.getByTestId('advertising-section')).toHaveAttribute(
      'data-section-state',
      'unavailable',
    );
    expect(visibleText(container)).toContain(
      'The public ad transparency surface refused the request from this vantage.',
    );
  });

  it('states explicitly that this is NOT a finding that the company does not advertise', () => {
    renderSection(blocked);
    expect(screen.getByTestId('advertising-not-an-absence-claim')).toHaveTextContent(
      ABSENCE_DISCLAIMER,
    );
  });

  it('renders no advertiser cards and no ownership statement when it could not look', () => {
    renderSection(blocked);
    expect(screen.queryAllByTestId('advertising-advertiser')).toHaveLength(0);
    expect(screen.queryByTestId('advertising-ownership')).toBeNull();
  });

  it('falls back to a safe reason when the provider gave none', () => {
    const { container } = renderSection(
      advertisingFixture({ accessState: 'unreachable', reason: null }),
    );
    expect(visibleText(container)).toContain(
      'Public advertising evidence could not be established for this report.',
    );
    assertCustomerSafe(container);
  });

  it.each(['blocked', 'restricted', 'requires_auth', 'unreachable', 'unavailable'])(
    'treats access state %s as unavailable, never as an absence of advertising',
    (accessState) => {
      const { container } = renderSection(
        advertisingFixture({ accessState, reason: 'The surface could not be read.' }),
      );
      expect(screen.getByTestId('advertising-section')).toHaveAttribute(
        'data-section-state',
        'unavailable',
      );
      assertCustomerSafe(container);
    },
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Evidence states
// ───────────────────────────────────────────────────────────────────────────

describe('PublicAdvertisingSection — evidence states', () => {
  it('renders an observed company advertiser as its own state, with its ad count', () => {
    const { container } = renderSection(
      advertisingFixture({
        companyAdvertisers: [advertiserFixture()],
        counts: { domainAdCountLabel: null, advertiserAccountsDiscovered: 1, matchedAdvertiserAccounts: 1 },
      }),
    );

    expect(screen.getByTestId('advertising-company-group')).toBeInTheDocument();
    const chip = screen.getByTestId('advertising-evidence-chip');
    expect(chip).toHaveAttribute('data-evidence-state', 'observed');
    expect(chip).toHaveTextContent('Observed');
    expect(screen.getByTestId('advertising-advertiser-ad-count')).toHaveTextContent('~300 ads');
    expect(visibleText(container)).toContain('Example Holdings Ltd');
    assertCustomerSafe(container);
  });

  it('renders an inferred advertiser as "likely, not confirmed" and never as the company’s', () => {
    const { container } = renderSection(
      advertisingFixture({
        otherAdvertisers: [
          advertiserFixture({
            advertiserId: 'AR02',
            resolutionState: 'PROBABLE_MATCH',
            verified: false,
            adCountLabel: '~500 ads',
            resolutionBasis:
              'The legal names agree but the advertiser identity is not provider-verified.',
          }),
        ],
      }),
    );

    const chip = screen.getByTestId('advertising-evidence-chip');
    expect(chip).toHaveAttribute('data-evidence-state', 'inferred');
    expect(chip).toHaveTextContent('Likely, not confirmed');
    // An unattributed advertiser must never carry an ad count: beside a name, it reads as theirs.
    expect(screen.queryByTestId('advertising-advertiser-ad-count')).toBeNull();
    expect(visibleText(container)).not.toContain('~500 ads');
    expect(screen.queryByTestId('advertising-company-group')).toBeNull();
    assertCustomerSafe(container);
  });

  it('renders an insufficient-evidence advertiser in plain language', () => {
    const { container } = renderSection(
      advertisingFixture({
        otherAdvertisers: [
          advertiserFixture({
            advertiserId: 'AR03',
            legalName: null,
            resolutionState: 'INSUFFICIENT_EVIDENCE',
            resolutionBasis: 'The advertiser profile exposed no legal name to compare.',
          }),
        ],
      }),
    );

    const chip = screen.getByTestId('advertising-evidence-chip');
    expect(chip).toHaveAttribute('data-evidence-state', 'insufficient_evidence');
    expect(chip).toHaveTextContent('Insufficient evidence');
    expect(visibleText(container)).toContain('Unnamed advertiser');
    assertCustomerSafe(container);
  });

  it('renders an unresolved advertiser as "could not be resolved"', () => {
    const { container } = renderSection(
      advertisingFixture({
        otherAdvertisers: [
          advertiserFixture({
            advertiserId: 'AR04',
            resolutionState: 'UNRESOLVED',
            ambiguityFlagged: true,
            resolutionBasis:
              'The provider flags multiple advertiser accounts with a similar name, so this account can be neither attributed nor excluded on its name.',
          }),
        ],
      }),
    );

    const chip = screen.getByTestId('advertising-evidence-chip');
    expect(chip).toHaveAttribute('data-evidence-state', 'unresolved');
    expect(chip).toHaveTextContent('Could not be resolved');
    assertCustomerSafe(container);
  });

  it('renders a not-matched advertiser as a separate entity, not as the company', () => {
    const { container } = renderSection(
      advertisingFixture({
        otherAdvertisers: [
          advertiserFixture({
            advertiserId: 'AR05',
            legalName: 'Unrelated Reseller GmbH',
            resolutionState: 'NOT_MATCHED',
            resolutionBasis:
              'A different verified legal name (Unrelated Reseller GmbH) — a separate entity, not this company.',
          }),
        ],
      }),
    );

    expect(screen.getByTestId('advertising-evidence-chip')).toHaveAttribute(
      'data-evidence-state',
      'separate_entity',
    );
    expect(screen.getByTestId('advertising-other-group')).toBeInTheDocument();
    assertCustomerSafe(container);
  });

  it('renders every evidence state as a visually distinct state in one report', () => {
    const { container } = renderSection(
      advertisingFixture({
        companyAdvertisers: [advertiserFixture({ advertiserId: 'AR-A' })],
        otherAdvertisers: [
          advertiserFixture({ advertiserId: 'AR-B', resolutionState: 'PROBABLE_MATCH' }),
          advertiserFixture({ advertiserId: 'AR-C', resolutionState: 'NOT_MATCHED' }),
          advertiserFixture({ advertiserId: 'AR-D', resolutionState: 'INSUFFICIENT_EVIDENCE' }),
          advertiserFixture({ advertiserId: 'AR-E', resolutionState: 'UNRESOLVED' }),
        ],
      }),
    );

    const states = screen
      .getAllByTestId('advertising-evidence-chip')
      .map((el) => el.getAttribute('data-evidence-state'));
    expect(states).toEqual([
      'observed',
      'inferred',
      'separate_entity',
      'insufficient_evidence',
      'unresolved',
    ]);
    const tones = screen
      .getAllByTestId('advertising-evidence-chip')
      .map((el) => el.getAttribute('data-tone'));
    expect(new Set(tones).size).toBeGreaterThan(1);
    assertCustomerSafe(container);
  });

  it('does not echo an unrecognised resolution state onto the page', () => {
    const { container } = renderSection(
      advertisingFixture({
        otherAdvertisers: [
          advertiserFixture({ advertiserId: 'AR06', resolutionState: 'SOME_FUTURE_STATE' }),
        ],
      }),
    );
    expect(visibleText(container)).not.toContain('SOME_FUTURE_STATE');
    expect(screen.getByTestId('advertising-evidence-chip')).toHaveAttribute(
      'data-evidence-state',
      'unresolved',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Identity state
// ───────────────────────────────────────────────────────────────────────────

describe('PublicAdvertisingSection — identity state', () => {
  it('states ownership is decidable when the site declares a legal name', () => {
    renderSection(advertisingFixture({ companyAdvertisers: [advertiserFixture()] }));
    expect(screen.getByTestId('advertising-identity')).toHaveAttribute(
      'data-identity-state',
      'legal_name_declared',
    );
  });

  it('refuses "none found" when no legal name was declared, and says why instead', () => {
    const { container } = renderSection(
      advertisingFixture({ subjectLegalNameUsed: null, companyAdvertisers: [] }),
    );

    expect(screen.getByTestId('advertising-identity')).toHaveAttribute(
      'data-identity-state',
      'legal_name_not_declared',
    );
    const ownership = screen.getByTestId('advertising-ownership');
    expect(ownership).toHaveAttribute('data-ownership', 'ownership_not_establishable');
    expect(ownership).toHaveTextContent('Ownership could not be established');
    expect(visibleText(container)).not.toContain('No advertiser matching');
    assertCustomerSafe(container);
  });

  it('states the honest absence only when a declared legal name made it decidable', () => {
    const { container } = renderSection(
      advertisingFixture({ subjectLegalNameUsed: 'Example Holdings Ltd', companyAdvertisers: [] }),
    );

    const ownership = screen.getByTestId('advertising-ownership');
    expect(ownership).toHaveAttribute('data-ownership', 'none_found_with_declared_name');
    expect(ownership).toHaveTextContent('No advertiser matching');
    expect(ownership).toHaveTextContent('Example Holdings Ltd');
    // The qualifier that keeps it from reading as "you do not advertise".
    expect(ownership).toHaveTextContent(
      'rather than a complete account of your advertising',
    );
    assertCustomerSafe(container);
  });

  it('shows no ownership statement when company advertisers were found', () => {
    renderSection(advertisingFixture({ companyAdvertisers: [advertiserFixture()] }));
    expect(screen.queryByTestId('advertising-ownership')).toBeNull();
  });

  it('distinguishes verified, unverified and provider-ambiguous advertiser identities', () => {
    renderSection(
      advertisingFixture({
        otherAdvertisers: [
          advertiserFixture({ advertiserId: 'V1', verified: true, resolutionState: 'NOT_MATCHED' }),
          advertiserFixture({ advertiserId: 'V2', verified: false, resolutionState: 'PROBABLE_MATCH' }),
          advertiserFixture({ advertiserId: 'V3', ambiguityFlagged: true, resolutionState: 'UNRESOLVED' }),
        ],
      }),
    );
    const states = screen
      .getAllByTestId('advertising-advertiser-identity')
      .map((el) => el.getAttribute('data-identity-state'));
    expect(states).toEqual(['provider_verified', 'unverified', 'ambiguous']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Freshness
// ───────────────────────────────────────────────────────────────────────────

describe('PublicAdvertisingSection — freshness (observation age)', () => {
  it('renders the observation age and the date it was taken', () => {
    renderSection(advertisingFixture({ observedAt: '2026-09-27T08:08:00.000Z' }));
    const chip = screen.getByTestId('advertising-freshness');
    expect(chip).toHaveTextContent('Observed 3 days ago');
    expect(chip).toHaveTextContent('2026-09-27');
    expect(chip).toHaveAttribute('data-tone', 'fresh');
  });

  it('renders today and one-day-old observations in their own wording', () => {
    renderSection(advertisingFixture({ observedAt: '2026-09-30T06:00:00.000Z' }));
    expect(screen.getByTestId('advertising-freshness')).toHaveTextContent('Observed today');
  });

  it.each([
    ['2026-09-29T06:00:00.000Z', 'Observed 1 day ago', 'fresh'],
    ['2026-09-10T12:00:00.000Z', 'Observed 20 days ago', 'recent'],
    ['2026-05-01T12:00:00.000Z', 'Observed 152 days ago', 'ageing'],
  ])('ages %s to "%s" (%s)', (observedAt, label, tone) => {
    renderSection(advertisingFixture({ observedAt }));
    const chip = screen.getByTestId('advertising-freshness');
    expect(chip).toHaveTextContent(label);
    expect(chip).toHaveAttribute('data-tone', tone);
  });

  it('says the date is not recorded rather than guessing one', () => {
    renderSection(advertisingFixture({ observedAt: 'not-a-date' }));
    const chip = screen.getByTestId('advertising-freshness');
    expect(chip).toHaveTextContent('Observation date not recorded');
    expect(chip).toHaveAttribute('data-tone', 'unknown');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Geography and surface (and the WP-1 seams)
// ───────────────────────────────────────────────────────────────────────────

describe('PublicAdvertisingSection — geography and surface', () => {
  it('labels the vantage as where the record was searched FROM', () => {
    renderSection(advertisingFixture({ vantage: 'London, United Kingdom' }));
    expect(screen.getByTestId('advertising-vantage')).toHaveTextContent(
      'Searched from London, United Kingdom',
    );
  });

  it('labels an advertiser location as a stated location, not as where ads ran', () => {
    const { container } = renderSection(
      advertisingFixture({ companyAdvertisers: [advertiserFixture({ basedIn: 'Ireland' })] }),
    );
    expect(screen.getByTestId('advertising-advertiser-location')).toHaveTextContent(
      'Stated location: Ireland',
    );
    expect(visibleText(container)).toContain('not where their ads ran');
  });

  it('abstains from ad platform and delivery geography instead of inventing them', () => {
    const { container } = renderSection(
      advertisingFixture({ companyAdvertisers: [advertiserFixture()] }),
    );
    expect(screen.getByTestId('advertising-scope-limits')).toHaveTextContent(
      'are not part of the public record this report reads',
    );
    // The seam must not be filled with a hardcoded platform name.
    expect(visibleText(container)).not.toMatch(/\bGoogle\b/);
    expect(visibleText(container)).not.toMatch(/\b(Meta|Facebook|LinkedIn|TikTok|Bing)\b/);
  });

  it('names the observed surface without naming a per-ad platform', () => {
    renderSection(advertisingFixture());
    expect(screen.getByTestId('advertising-surface')).toHaveTextContent(
      'Public Ads Transparency Center',
    );
  });

  it('reports the domain ad count only beside third parties, never beside the company', () => {
    const { container } = renderSection(
      advertisingFixture({
        companyAdvertisers: [advertiserFixture({ adCountLabel: null })],
        otherAdvertisers: [
          advertiserFixture({ advertiserId: 'AR09', resolutionState: 'NOT_MATCHED' }),
        ],
        counts: {
          domainAdCountLabel: '~4K ads',
          advertiserAccountsDiscovered: 2,
          matchedAdvertiserAccounts: 1,
        },
      }),
    );
    const others = screen.getByTestId('advertising-other-group');
    expect(others).toHaveTextContent('~4K ads');
    expect(others).toHaveTextContent('pointing at this domain in total, across all advertisers');
    expect(screen.getByTestId('advertising-company-group')).not.toHaveTextContent('~4K ads');
    assertCustomerSafe(container);
  });

  it('never places the domain ad count on the page when there are no third parties', () => {
    const { container } = renderSection(
      advertisingFixture({
        companyAdvertisers: [advertiserFixture({ adCountLabel: null })],
        otherAdvertisers: [],
      }),
    );
    expect(visibleText(container)).not.toContain('~4K ads');
  });

  it('states how many advertiser accounts were examined', () => {
    renderSection(
      advertisingFixture({
        counts: { domainAdCountLabel: null, advertiserAccountsDiscovered: 3, matchedAdvertiserAccounts: 0 },
      }),
    );
    expect(screen.getByTestId('advertising-provenance')).toHaveTextContent(
      '3 advertiser accounts examined',
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The pure view model
// ───────────────────────────────────────────────────────────────────────────

describe('host contract — the web view can actually reach this payload', () => {
  /**
   * The gap WP-9 closed was a TYPE gap, so it is worth a type-level assertion: the field the
   * report API has been sending since PO-3 must be assignable to the component's prop, or the
   * React web view cannot render it without an `any` cast. `ts-jest` runs with diagnostics on,
   * so a regression here fails this suite at compile time rather than silently at runtime.
   */
  type AdvertisingReachesTheSection =
    ReportData['advertising'] extends PublicAdvertisingSectionProps['advertising'] ? true : never;

  it('declares advertising on ReportData in a shape the section accepts', () => {
    const assignable: AdvertisingReachesTheSection = true;
    expect(assignable).toBe(true);
  });

  it('accepts the payload the report API sends and renders the observed section from it', () => {
    const fromApi: ReportData['advertising'] = advertisingFixture({
      companyAdvertisers: [advertiserFixture()],
    });
    const { container } = render(<PublicAdvertisingSection advertising={fromApi} now={NOW} />);
    expect(screen.getByTestId('advertising-section')).toHaveAttribute(
      'data-section-state',
      'observed',
    );
    assertCustomerSafe(container);
  });

  it('renders nothing when the report API sends no observation', () => {
    const fromApi: ReportData['advertising'] = null;
    const { container } = render(<PublicAdvertisingSection advertising={fromApi} now={NOW} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('publicAdvertisingView — pure model', () => {
  it('returns null for an absent observation so the renderer has nothing to draw', () => {
    expect(buildPublicAdvertisingView(null, NOW)).toBeNull();
    expect(buildPublicAdvertisingView(undefined, NOW)).toBeNull();
  });

  it('maps every known resolution state, and unknown ones to unresolved', () => {
    expect(toEvidenceState('MATCHED')).toBe('observed');
    expect(toEvidenceState('PROBABLE_MATCH')).toBe('inferred');
    expect(toEvidenceState('NOT_MATCHED')).toBe('separate_entity');
    expect(toEvidenceState('INSUFFICIENT_EVIDENCE')).toBe('insufficient_evidence');
    expect(toEvidenceState('UNRESOLVED')).toBe('unresolved');
    expect(toEvidenceState('whatever-lands-next')).toBe('unresolved');
    expect(toEvidenceState(null)).toBe('unresolved');
  });

  it('treats a company advertiser as observed regardless of the state string on the record', () => {
    // The partition is the contract. A record that reached `companyAdvertisers` passed the single
    // ownership gate upstream, and this renderer does not second-guess it by re-reading the state.
    const view = buildPublicAdvertisingView(
      advertisingFixture({
        companyAdvertisers: [advertiserFixture({ resolutionState: 'PROBABLE_MATCH' })],
      }),
      NOW,
    );
    expect(view?.companyAdvertisers[0].evidence.state).toBe('observed');
  });

  it('keeps the seam flags false until the contract carries platform and delivery geography', () => {
    const view = buildPublicAdvertisingView(advertisingFixture(), NOW);
    expect(view?.surface.platformsAvailable).toBe(false);
    expect(view?.geography.campaignScopeAvailable).toBe(false);
  });

  it('carries no ad count for advertisers that are not the company’s', () => {
    const view = buildPublicAdvertisingView(
      advertisingFixture({
        otherAdvertisers: [advertiserFixture({ resolutionState: 'PROBABLE_MATCH' })],
      }),
      NOW,
    );
    expect(view?.otherAdvertisers[0].adCountLabel).toBeNull();
  });

  it('drops a profile URL that is not an http(s) location', () => {
    const view = buildPublicAdvertisingView(
      advertisingFixture({
        companyAdvertisers: [advertiserFixture({ profileUrl: 'javascript:alert(1)' })],
      }),
      NOW,
    );
    expect(view?.companyAdvertisers[0].profileUrl).toBeNull();
  });

  it('survives a malformed payload without throwing', () => {
    const view = buildPublicAdvertisingView(
      {
        accessState: 'observed',
        companyAdvertisers: null,
        otherAdvertisers: undefined,
        counts: undefined,
        vantage: '   ',
        observedAt: null,
        subjectLegalNameUsed: '  ',
      } as AnyAdvertising,
      NOW,
    );
    expect(view?.companyAdvertisers).toEqual([]);
    expect(view?.otherAdvertisers).toEqual([]);
    expect(view?.advertiserAccountsDiscovered).toBe(0);
    expect(view?.geography.searchVantage).toBeNull();
    expect(view?.ownership.kind).toBe('ownership_not_establishable');
  });

  it('computes observation age from the injected clock only', () => {
    expect(buildFreshness('2026-09-23T12:00:00.000Z', NOW).ageDays).toBe(7);
    expect(buildFreshness('2026-09-23T12:00:00.000Z', NOW).tone).toBe('fresh');
    expect(buildFreshness('2026-09-22T12:00:00.000Z', NOW).tone).toBe('recent');
    // A clock skew must not produce a negative age.
    expect(buildFreshness('2026-10-05T12:00:00.000Z', NOW).ageDays).toBe(0);
  });
});
