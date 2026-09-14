/**
 * CPG-007 — extracted values entering the EXISTING CPG-001 resolver.
 *
 * FIXTURE TESTS. No network, no database, no LLM. Every page below is
 * hand-written test data, labelled as such, and is never presented as retrieved
 * evidence. Values flow through the REAL path:
 *
 *   discovery (fixture provider) → safeFetch seam (fixture fetcher)
 *     → extractField → EvidenceClaim → resolve() → persistGrounding()
 *
 * Several tests pin defects found while wiring this path. Each is named for the
 * defect so a regression reads as one.
 */

import {
  parseMoney, parseAllMoney, canonicalMoneyKey, toEvidenceValue, decodeEntities, type SourceDerivedValue,
} from '../../services/companyProfile/grounding/extraction/valueTypes';
import {
  extractRevenue, extractFoundedYear, extractCeo, extractFunding, extractDocumentDate, mentionsCompany, orgIsSubject,
} from '../../services/companyProfile/grounding/extraction/documentExtractors';
import {
  resolve, isMaterialConflict, buildConfirmationRequest,
} from '../../services/companyProfile/grounding/claimResolution';
import { createDiscoveredWebSource } from '../../services/companyProfile/grounding/acquisition/discoveredSource';
import type { DiscoveryProvider, RawSearchResult } from '../../services/companyProfile/grounding/discovery/webDiscovery';
import type { AcquisitionContext, EvidenceFetcher } from '../../services/companyProfile/grounding/acquisition/evidenceSource';
import type { EntitySignals, EvidenceClaim, UserClaim } from '../../services/companyProfile/grounding/types';
import { createInMemoryStore, persistGrounding } from '../../services/companyProfile/grounding/persistence/groundingStore';

const ASOF = '2026-09-10T00:00:00.000Z';

// ── fixture plumbing ─────────────────────────────────────────────────────────

const known = (companyName: string, domain: string): EntitySignals => ({
  companyName, domain, linkedinUrl: null, location: null, leadership: [], registryId: null,
});

const provider = (urls: string[]): DiscoveryProvider => ({
  id: 'keyless_web', isAvailable: () => true,
  async search(): Promise<RawSearchResult[]> { return urls.map((url, i) => ({ url, rank: i + 1 })); },
});

const fetcher = (pages: Record<string, string>): EvidenceFetcher => async (url) =>
  pages[url] !== undefined ? { ok: true, status: 200, url, text: pages[url] } : { ok: false, status: 404, url, text: '' };

/** A FIXTURE news page: the publisher declares its own name and JSON-LD. */
const newsPage = (publisher: string, body: string, published?: string) => `<html><head>
  <meta property="og:site_name" content="${publisher}"/>
  ${published ? `<meta property="article:published_time" content="${published}"/>` : ''}
  <script type="application/ld+json">{"@type":"NewsMediaOrganization","name":"${publisher}"}</script>
</head><body><p>${body}</p></body></html>`;

/** Run the REAL discovered-source path and return the evidence it produced. */
async function acquire(companyName: string, domain: string, field: string, pages: Record<string, string>): Promise<EvidenceClaim[]> {
  const src = createDiscoveredWebSource({ provider: provider(Object.keys(pages)), fields: [field] });
  const ctx: AcquisitionContext = { companyId: 'c1', knownEntity: known(companyName, domain), companyDomain: domain, asOf: ASOF, fetcher: fetcher(pages) };
  const res = await src.acquire(ctx);
  return res.state === 'retrieved' ? res.claims.filter((c) => c.field === field) : [];
}

const user = (field: string, value: string): UserClaim => ({
  field, value, normalizedValue: value.toLowerCase().replace(/\s+/g, ' ').trim(),
  assertedAt: '2026-01-01T00:00:00.000Z', assertedBy: 'user-1',
});

const resolveWith = (companyName: string, domain: string, field: string, evidence: EvidenceClaim[], u: UserClaim | null) =>
  resolve({ companyId: 'c1', field, kind: 'FACT', userClaim: u, evidence, knownEntity: known(companyName, domain), companyDomain: domain, asOf: ASOF });

const ACME = 'Acme Analytics';
const ACME_DOMAIN = 'acmeanalytics.in';

// ─────────────────────────────────────────────────────────────────────────────

describe('CPG-007 (A) money canonicalisation — defects found while wiring the resolver', () => {
  it('DEFECT: float artifacts — every 2-decimal amount × every multiplier is exact', () => {
    // 0.14 × 1e7 used to be 1400000.0000000002 (28,462 of these combinations).
    const mults: [string, number][] = [['thousand', 1e3], ['lakh', 1e5], ['million', 1e6], ['crore', 1e7], ['billion', 1e9]];
    let bad = 0;
    for (let cents = 1; cents <= 99_999; cents++) {
      const text = (cents / 100).toFixed(2);
      for (const [word, factor] of mults) {
        if (parseMoney(`$${text} ${word}`)!.amount !== (cents * factor) / 100) bad++;
      }
    }
    expect(bad).toBe(0);
    expect(parseMoney('₹0.14 Cr')!.amount).toBe(1_400_000);
  });

  it('same currency + same amount compares EQUAL across notations', () => {
    const k = 'INR 78000000';
    for (const v of ['₹7.8 Cr', '₹7.8 crore', '₹78,000,000', 'INR 78000000', 'Rs. 7.8 crore', 'INR 78,000,000 (FY2024)']) {
      expect(canonicalMoneyKey('revenue', v)).toBe(k);
    }
  });

  it('DEFECT: different currencies never corroborate (was: both "78000000")', () => {
    expect(canonicalMoneyKey('revenue', '$78,000,000')).toBe('USD 78000000');
    expect(canonicalMoneyKey('revenue', '$78,000,000')).not.toBe(canonicalMoneyKey('revenue', '₹7.8 Cr'));
  });

  it('DEFECT: $5M vs $5B is a material conflict (text folding called them equal)', () => {
    expect(isMaterialConflict('revenue', 'USD 5,000,000', 'USD 5,000,000,000')).toBe(true);
    expect(isMaterialConflict('funding', '$5 million', '$5 billion')).toBe(true);
  });

  it('non-money fields and currency-less values fall back to text comparison (null key)', () => {
    expect(canonicalMoneyKey('ceo', '$5 million')).toBeNull();
    expect(canonicalMoneyKey('revenue', '10 crore')).toBeNull();
  });

  it('renders extracted money currency-qualified, with the period the SOURCE stated', () => {
    const v: SourceDerivedValue = {
      field: 'revenue', value: '78000000', normalizedValue: '78000000', sourceStatement: 's',
      temporalType: 'HISTORICAL', period: 'FY', year: 2024, currency: 'INR', unit: 'crore',
      approximation: false, moneyKind: 'revenue', method: 'explicit_statement', acceptedBecause: 'x',
    };
    expect(toEvidenceValue(v)).toEqual({ value: 'INR 78,000,000 (FY2024)', normalizedValue: 'INR 78000000' });
    expect(toEvidenceValue({ ...v, period: null, year: null })).toEqual({ value: 'INR 78,000,000', normalizedValue: 'INR 78000000' });
    // Non-money values are untouched.
    expect(toEvidenceValue({ ...v, field: 'ceo', value: 'Jane Doe', normalizedValue: 'jane doe', moneyKind: null, currency: null }))
      .toEqual({ value: 'Jane Doe', normalizedValue: 'jane doe' });
  });

  it('revenue-vs-target is still NOT a conflict (different measures, CPG-001 rule intact)', () => {
    expect(isMaterialConflict('revenue', '₹10 Cr', 'revenue target of ₹50 Cr')).toBe(false);
  });
});

describe('CPG-007 (B) attribution — the entity boundary (§13)', () => {
  it('DEFECT: every significant name token must appear as a whole word', () => {
    expect(mentionsCompany('Cloudflare revenue totaled $1 billion.', 'Cloudflare')).toBe(true);
    // "services" alone used to attribute the sentence to "Acme Services".
    expect(mentionsCompany("The company's services revenue totaled $5 million.", 'Acme Services')).toBe(false);
    // "tata" alone used to attribute Tata Motors' revenue to TCS.
    expect(mentionsCompany('Tata Motors revenue was ₹4 lakh crore.', 'Tata Consultancy Services')).toBe(false);
    // Substrings are not words: "cloudflared" is a different token.
    expect(mentionsCompany('The cloudflared daemon shipped.', 'Cloudflare')).toBe(false);
  });

  it('DEFECT: a revenue sentence naming only a shared word is rejected, not attributed', () => {
    const r = extractRevenue("<p>The company's services revenue totaled $5 million in 2024.</p>", 'Acme Services');
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/not named/);
  });

  it('DEFECT: the PUBLISHER\'s JSON-LD Organization never supplies founded_year or CEO', () => {
    const page = `<script type="application/ld+json">{"@type":"Organization","name":"Reuters","foundingDate":"1851",
      "employee":[{"@type":"Person","name":"Paul Bascobert","jobTitle":"Chief Executive Officer"}]}</script>`;
    const f = extractFoundedYear(page, 'Cloudflare');
    const c = extractCeo(page, 'Cloudflare');
    expect(f.values).toHaveLength(0);
    expect(c.values).toHaveLength(0);
    expect(f.rejected[0].reason).toMatch(/not the subject company/);
    expect(c.rejected[0].reason).toMatch(/not the subject company/);
  });

  it('the SUBJECT company\'s JSON-LD Organization is still used (by name, legalName or alternateName)', () => {
    const page = `<script type="application/ld+json">{"@type":"Organization","name":"Cloudflare, Inc.","foundingDate":"2009-07-26"}</script>`;
    expect(extractFoundedYear(page, 'Cloudflare').values[0]).toMatchObject({ value: '2009', method: 'json_ld' });
    expect(orgIsSubject({ name: 'CF', legalName: 'Cloudflare, Inc.' }, 'Cloudflare')).toBe(true);
    expect(orgIsSubject({ name: 'X', alternateName: ['Cloudflare'] }, 'Cloudflare')).toBe(true);
    expect(orgIsSubject({ name: 'Reuters' }, 'Cloudflare')).toBe(false);
  });
});

describe('CPG-007 (B2) sentence boundaries — defects found on real page structure', () => {
  it('DEFECT: <script>/<style> contents never become statement text', async () => {
    const [c] = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.'),
    });
    // Was: '{"@type":"NewsMediaOrganization","name":"Mint"} Acme Analytics revenue…'
    expect(c.extraction!.sourceStatement).toBe('Acme Analytics revenue was ₹7.8 crore in FY2024.');
  });

  it('DEFECT: a script body stating revenue is not evidence', () => {
    const page = '<script>var s = "Acme Analytics revenue was ₹99 crore in FY2024.";</script><p>Welcome to our site today.</p>';
    expect(extractRevenue(page, ACME).values).toHaveLength(0);
  });

  it('DEFECT: a sentence never spans two blocks (no manufactured attribution)', () => {
    // A nav item naming the company + an unattributed paragraph used to fuse
    // into "Acme Analytics The company's revenue was ₹5 crore in FY2024."
    const page = "<nav><a>Acme Analytics</a></nav><p>The company's revenue was ₹5 crore in FY2024.</p>";
    const r = extractRevenue(page, ACME);
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/not named/);
  });
});

describe('CPG-007 (C) document date — explicit markup only, never a fiscal period', () => {
  it('reads ISO article:published_time and JSON-LD datePublished', () => {
    expect(extractDocumentDate('<meta property="article:published_time" content="2025-02-06T21:05:00Z"/>')).toBe('2025-02-06T21:05:00.000Z');
    expect(extractDocumentDate('<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2024-11-01"}</script>')).toBe('2024-11-01T00:00:00.000Z');
  });

  it('refuses free-text dates (would need a locale and a year guess)', () => {
    expect(extractDocumentDate('<meta property="article:published_time" content="March 3"/>')).toBeNull();
    expect(extractDocumentDate('<html><body>Published 3 March 2025</body></html>')).toBeNull();
  });

  it('the document date never becomes the value\'s period', async () => {
    const claims = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.', '2026-05-01T00:00:00Z'),
    });
    expect(claims[0].sourcePublishedAt).toBe('2026-05-01T00:00:00.000Z');
    expect(claims[0].extraction).toMatchObject({ period: 'FY', year: 2024 });
    expect(claims[0].value).toBe('INR 78,000,000 (FY2024)');
  });
});

describe('CPG-007 (D) extracted evidence through the real acquisition path', () => {
  it('produces a typed claim with full extraction provenance', async () => {
    const [c] = await acquire('Cloudflare', 'cloudflare.com', 'revenue', {
      'https://www.reuters.com/x': newsPage('Reuters', 'In the year 2025, Cloudflare had annual revenue of $2.17B with 29.85% growth.'),
    });
    expect(c).toMatchObject({
      field: 'revenue',                       // NOT revenue_source_statement
      value: 'USD 2,170,000,000 (FY2025)',
      normalizedValue: 'USD 2170000000',
      sourceUrl: 'https://www.reuters.com/x',
      extraction: {
        temporalType: 'HISTORICAL', period: 'FY', year: 2025, currency: 'USD',
        approximation: false, moneyKind: 'revenue', method: 'explicit_statement',
      },
    });
    expect(c.extraction!.sourceStatement).toContain('$2.17B');
    expect(c.excerpt).toBe(c.extraction!.sourceStatement.slice(0, 300));
  });

  it('DEFECT: a publisher-named page is NOT an entity mismatch (was: every value discarded)', async () => {
    const ev = await acquire('Cloudflare', 'cloudflare.com', 'revenue', {
      'https://www.reuters.com/x': newsPage('Reuters', 'Cloudflare revenue totaled $1.67 billion in 2024.'),
    });
    expect(ev[0].entitySignals.companyName).toBe('Cloudflare');   // the subject, not "Reuters"
    const g = resolveWith('Cloudflare', 'cloudflare.com', 'revenue', ev, null);
    expect(g.entityMatch.status).toBe('weak');                  // name only — never decisive
    expect(g.evidence).toHaveLength(1);                         // retained, not discarded
    // CPG-008 (B-17): one weak, uncorroborated publisher is OBSERVED, not
    // effective. (Before CPG-008 this single article became the effective value.)
    expect(g.effectiveValue).toBeNull();
    expect(g.adjudication!.evidenceState).toBe('OBSERVED_ONLY');
    expect(g.adjudication!.candidates[0]).toMatchObject({ value: 'USD 1,670,000,000 (2024)', role: 'OBSERVED', sufficient: false });
  });

  it('a FORECAST never reaches the resolver', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/f': newsPage('Mint', 'Acme Analytics expects revenue to reach ₹20 crore in FY2026.'),
    });
    expect(ev).toHaveLength(0);
  });
});

describe('CPG-007 (E) §15 corroboration — two independent documents, one value', () => {
  const pages = {
    'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.'),
    'https://economictimes.indiatimes.com/b': newsPage('The Economic Times', 'Acme Analytics reported revenue of ₹7.8 crore for FY2024.'),
  };

  it('two hosts stating the same amount AGREE with the user\'s differently-written value', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', pages);
    expect(ev).toHaveLength(2);
    expect(new Set(ev.map((e) => e.normalizedValue))).toEqual(new Set(['INR 78000000']));

    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, user('revenue', '₹7.8 Cr'));
    // DEFECT pinned: "₹7.8 cr" vs "78000000" used to be a FALSE CONFLICT.
    expect(g.status).not.toBe('CONFLICTING');
    expect(g.isMaterialConflict).toBe(false);
    expect(g.conflictingEvidence).toHaveLength(0);
    // Name-only identity caps the status at REPORTED — honest, not VERIFIED.
    expect(g.status).toBe('PUBLICLY_REPORTED');
    expect(g.effectiveValue).toBe('₹7.8 Cr');
    expect(g.effectiveValueSource).toBe('user');
  });

  it('two independent sources score higher than one (corroboration is counted)', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', pages);
    const two = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, user('revenue', '₹7.8 Cr'));
    const one = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev.slice(0, 1), user('revenue', '₹7.8 Cr'));
    expect(two.confidence.score).toBeGreaterThan(one.confidence.score);
  });

  it('the same host twice is ONE source — enforced at discovery AND in the resolver', async () => {
    // Layer 1: CPG-006 discovery keeps one candidate per host.
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': pages['https://www.livemint.com/a'],
      'https://www.livemint.com/c': newsPage('Mint', 'Acme Analytics revenue stood at ₹7.8 crore in FY2024.'),
    });
    expect(ev).toHaveLength(1);

    // Layer 2: even if two same-host claims arrive (another path), the
    // resolver counts ONE independent source.
    const twin: EvidenceClaim = { ...ev[0], claimId: 'twin', sourceUrl: 'https://www.livemint.com/c' };
    const dup = resolveWith(ACME, ACME_DOMAIN, 'revenue', [ev[0], twin], user('revenue', '₹7.8 Cr'));
    const one = resolveWith(ACME, ACME_DOMAIN, 'revenue', [ev[0]], user('revenue', '₹7.8 Cr'));
    expect(dup.confidence.score).toBe(one.confidence.score);
  });
});

describe('CPG-007 (F) §17/§18 conflict pathway (FIXTURE — not a real company)', () => {
  it('§18: user ₹10 Cr vs public ₹7.8 Cr FY2024 → CONFLICTING, user value retained, question asked', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.'),
    });
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, user('revenue', '₹10 Cr'));

    // DEFECT pinned: revenueKind('78000000') was NOT_REVENUE → conflict suppressed.
    expect(g.status).toBe('CONFLICTING');
    expect(g.isMaterialConflict).toBe(true);
    expect(g.confirmationStatus).toBe('PENDING_USER_CONFIRMATION');
    // No silent overwrite.
    expect(g.effectiveValue).toBe('₹10 Cr');
    expect(g.effectiveValueSource).toBe('user');
    expect(g.history.some((h) => h.action === 'conflict_detected')).toBe(true);

    const q = buildConfirmationRequest(g, ACME_DOMAIN)!;
    expect(q.userValue).toBe('₹10 Cr');
    expect(q.publicValue).toBe('INR 78,000,000 (FY2024)');   // the user SEES the period
    expect(q.publicSources[0].url).toBe('https://www.livemint.com/a');
  });

  it('§17: when sources disagree, the one contradicting the user is the material conflict', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.'),
      'https://economictimes.indiatimes.com/b': newsPage('The Economic Times', 'Acme Analytics reported revenue of ₹9.1 crore for FY2024.'),
    });
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, user('revenue', '₹7.8 Cr'));
    expect(g.status).toBe('CONFLICTING');
    expect(g.conflictingEvidence.map((e) => e.value)).toEqual(['INR 91,000,000 (FY2024)']);
  });

  it('DEFECT pinned: the same number in another currency is a conflict, never a match', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.'),
    });
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, user('revenue', '$78,000,000'));
    expect(g.status).toBe('CONFLICTING');
  });

  it('B-16 CLOSED (CPG-008, flipped from the CPG-007 "known gap" pin): disagreeing public sources ARE flagged with no user value', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.'),
      'https://economictimes.indiatimes.com/b': newsPage('The Economic Times', 'Acme Analytics reported revenue of ₹9.1 crore for FY2024.'),
    });
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, null);
    expect(g.evidence).toHaveLength(2);
    expect(g.status).toBe('CONFLICTING');
    expect(g.isMaterialConflict).toBe(true);
    expect(g.effectiveValue).toBeNull();                        // no winner fabricated
    expect(g.adjudication!.outcome).toBe('PUBLIC_CONFLICT_UNRESOLVED');
    expect(g.conflictingEvidence.map((e) => e.sourceUrl).sort()).toEqual([
      'https://economictimes.indiatimes.com/b', 'https://www.livemint.com/a']);
  });
});

/**
 * Every sentence in this block is VERBATIM from the CPG-007 live run
 * (2026-09-10), where the first extractor version produced the wrong result.
 * Used as parser fixtures only; the live run itself is reported separately.
 */
describe('CPG-007 (H) live-run defects — pinned with the verbatim live sentences', () => {
  const p = (s: string) => `<p>${s}</p>`;

  it('ZERODHA: net profit was returned as revenue (first amount taken)', () => {
    const r = extractRevenue(p("Bengaluru: Stockbroking platform Zerodha 's net profit rose 1.2% to ₹4,283 crore in FY26, while revenue remained broadly unchanged from the ₹8,847 crore it reported a year earlier."), 'Zerodha');
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/2 amounts/);
  });

  it('a single amount bound to PROFIT is never revenue', () => {
    const r = extractRevenue(p('Zerodha reported a net profit of ₹4,283 crore in FY26 on flat revenue.'), 'Zerodha');
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/bound to "net profit"/);
  });

  it('FABRICATED ZERO: "Rs" inside "years"/"Partners" and a bare comma are not money', () => {
    expect(parseAllMoney('Cloudflare, Inc. has reported revenue across 6 fiscal years , compounding at +38.1% annually over 5 years .')).toEqual([]);
    expect(parseAllMoney('Pelion Venture Partners , located in Salt Lake City (United States) , made their first investment')).toEqual([]);
    expect(parseMoney('Rs 30 crore')).toMatchObject({ amount: 300_000_000, currency: 'INR' });
    expect(parseMoney('rs. 5 lakh')).toMatchObject({ amount: 500_000, currency: 'INR' });
  });

  it('a restated conversion is one figure, not two', () => {
    const all = parseAllMoney('Econovus Packaging has raised Rs 40 crore, about $4.2 million, in a pre-Series A funding round');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ amount: 400_000_000, currency: 'INR' });
    expect(parseAllMoney('has raised ₹30 Cr ($3.2 Mn) in a fresh funding round')).toHaveLength(1);
  });

  it('ZERODHA: rounds it INVESTED in are not its funding', () => {
    const investorSentences = [
      'Pune-based deeptech startup Minimac Systems has raised Rs 30 crore in a pre-Series A funding round led by Rainmatter, the investment arm of Zerodha.',
      'Indian data centre operator CtrlS has raised Rs 250 crore from Zerodha co-founder Nikhil Kamath and entrepreneur Sreeram Reddy Vanga to support its infrastructure expansion across the country.',
      'In a pre-Series A investment round headed by Rainmatter by Zerodha and involving Rockstud Capital, the engineered sustainable packaging startup Econovus Packaging raised Rs 40 crore.',
      'Rainmatter, Zerodha’s investment arm, participated in the $2.5 million pre-Series A round led by Centre Court Capital for Michezo Sports, a sports infrastructure startup based in Bengaluru.',
      'Goldi Solar, a manufacturer of solar photovoltaic (PV) modules, has raised Rs 137.5 crore from Nikhil Kamath, a co-founder of Zerodha.',
      'Essar-backed Blue Energy Motors has secured USD 30 million in a fresh funding round led by Zerodha co-founder Nikhil Kamath and textile trading firm Omnitex Industries.',
    ];
    for (const s of investorSentences) {
      const r = extractFunding(p(s), 'Zerodha');
      expect({ s, n: r.values.length }).toEqual({ s, n: 0 });
      expect(r.rejected[0].reason).toMatch(/investor|after the event|identify a person|different entity|investment in/);
    }
  });

  it('ZERODHA (replay): its founders INVESTING in another company is not Zerodha funding', () => {
    const r = extractFunding(p("Zerodha's Kamath Brothers Invest INR 250 Cr in InCred Ahead of IPO InCred operates through three entities—InCred Finance, InCred Capital, and InCred Money."), 'Zerodha');
    expect(r.values).toHaveLength(0);
    // Round name alone, no raise verb and no "round": not even considered.
    expect(extractFunding(p('Zerodha shares were discussed ahead of the IPO of ₹500 crore.'), 'Zerodha').values).toHaveLength(0);
    // A possessive round name is still the company's own round.
    expect(extractFunding(p("Stripe's Series I round raised $6.87B in 2023."), 'Stripe').values[0]).toMatchObject({ period: 'Series I' });
  });

  it('ZERODHA: a subsidiary\'s income is not funding ("growth" is not a round)', () => {
    const r = extractFunding(p('Zerodha Capital, the lending arm of Zerodha Group, reported a 44.2% rise in total income to Rs 53.5 crore in FY26, helped by growth in its loan-against-securities business.'), 'Zerodha');
    expect(r.values).toHaveLength(0);
  });

  it('the company as the party that raised IS still accepted (extraction is not authority)', () => {
    // Verbatim from trysignalbase.com. Extracted because it is an explicit
    // statement; whether that source is credible is decided downstream.
    const r = extractFunding(p('Zerodha, the Indian financial services company, has secured $16.4 million in its latest funding round.'), 'Zerodha');
    expect(r.values[0]).toMatchObject({ value: '16400000', currency: 'USD', qualifier: 'latest round' });
  });

  it('FUNDING MEASURES: total raised ≠ largest round, and a list of round types is not a period', () => {
    const total = extractFunding(p('CloudFlare has raised a total of $332M over 7 funding rounds : 2 Early-Stage , 3 Late-Stage and 2 Post IPO round s .'), 'Cloudflare').values[0];
    expect(total).toMatchObject({ value: '332000000', qualifier: 'total raised', period: null });   // was period "IPO"
    expect(toEvidenceValue(total).value).toBe('USD 332,000,000 (total raised)');

    const largest = extractFunding(p('CloudFlare&#x27;s largest funding round so far was a Post IPO round for $1.29B in Aug 2021 .'), 'Cloudflare').values[0];
    expect(largest).toMatchObject({ value: '1290000000', qualifier: 'largest round', period: 'post-IPO', year: 2021 });
    expect(toEvidenceValue(largest).value).toBe('USD 1,290,000,000 (largest round, post-IPO 2021)');

    const seriesI = extractFunding(p('Stripe&#x27;s largest funding round so far was a Series I round for $6.87B in Mar 2023 .'), 'Stripe').values[0];
    expect(seriesI).toMatchObject({ period: 'Series I', year: 2023 });
  });

  it('STRIPE (fresh run): a REFUTED rumour is not a funding event', () => {
    // designbeep.com, 2026-09-04 — five of these produced "$1B funding" values.
    const refuting = [
      'The claim that Stripe raises $1 billion in new financing round does not match what the company has announced.',
      'Rather than a story in which Stripe raises $1 billion in new financing round style capital, the real event was this.',
      'Anyone encountering a claim that Stripe raises $1 billion in new financing round has quite plausibly encountered a garbled version of this statistic.',
      "Understanding this explains why the framing that Stripe raises $1 billion in new financing round keeps failing to match reality.",
      'A few practical points for anyone tracking private valuations and claims like Stripe raises $1 billion in new financing round.',
    ];
    for (const s of refuting) {
      const r = extractFunding(p(s), 'Stripe');
      expect({ s, n: r.values.length }).toEqual({ s, n: 0 });
    }
    expect(extractFunding(p(refuting[0]), 'Stripe').rejected[0].reason).toMatch(/negated|hypothetical|claim/);
    // Negation applies to every field.
    expect(extractRevenue(p("Cloudflare revenue was not $5 billion in 2025."), 'Cloudflare').values).toHaveLength(0);
    expect(extractFoundedYear(p('Zerodha was not founded in 2008.'), 'Zerodha').values).toHaveLength(0);
    expect(extractCeo(p("Jane Doe, CEO of Stripe, wasn't confirmed."), 'Stripe').values).toHaveLength(0);
    // …but the month May is not the modal "may".
    expect(extractFunding(p('Stripe raised $600 million in a Series H round in May 2021.'), 'Stripe').values[0]).toMatchObject({ value: '600000000', period: 'Series H' });
    expect(extractFunding(p('Stripe may raise $600 million in a new round.'), 'Stripe').values).toHaveLength(0);
  });

  it('a sentence naming a total AND a round is refused — neither order nor proximity decides', () => {
    // Both verbatim. In the first the amount is the total; in the second it is
    // the round. Each heuristic tried got one of them wrong.
    const total = extractFunding(p('Stripe has raised roughly $9.81 billion in total across 24 rounds according to funding databases, with the March 2023 Series I standing as its largest single round.'), 'Stripe');
    const round = extractFunding(p("Cloudflare's last funding round was on Aug 2026 for a total of $2.2B."), 'Cloudflare');
    for (const r of [total, round]) {
      expect(r.values).toHaveLength(0);
      expect(r.rejected[0].reason).toMatch(/several funding measures/);
    }
  });

  it('STRIPE: CEO was "Inside Stripe" (headline words before the title)', () => {
    const r = extractCeo(p('"Inside Stripe CEO Patrick Collison\'s family life as he weds childhood sweetheart" .'), 'Stripe');
    expect(r.values.map((v) => v.value)).toEqual(['Patrick Collison']);
  });

  it('CEO: company-anchored forms, case-sensitive names, Title-Case and former titles', () => {
    expect(extractCeo(p('Zerodha CEO Nithin Kamath recalls terrifying stroke experience.'), 'Zerodha').values[0]?.value).toBe('Nithin Kamath');
    expect(extractCeo(p('Matthew Prince is the co-founder and CEO of Cloudflare.'), 'Cloudflare').values[0]?.value).toBe('Matthew Prince');
    const title = extractCeo(p('Zerodha CEO Nithin Kamath Recalls Terrifying Stroke Experience.'), 'Zerodha');
    expect(title.values).toHaveLength(0);
    expect(title.rejected[0].reason).toMatch(/Title-Case/);
    const former = extractCeo(p('Former Stripe CEO Jane Doe joined the board of another company.'), 'Stripe');
    expect(former.values).toHaveLength(0);
    expect(former.rejected[0].reason).toMatch(/former/);
  });

  it('CLOUDFLARE: a product launch year is not the founding year', () => {
    expect(extractFoundedYear(p("Cloudflare's Project Galileo, launched in 2014, offers DDoS protection to NGOs for free."), 'Cloudflare').values).toHaveLength(0);
    expect(extractFoundedYear(p('Rainmatter, founded in 2016 by Zerodha, backs climate startups.'), 'Zerodha').values).toHaveLength(0);
    expect(extractFoundedYear(p('Zerodha was founded in 2010 by Nithin and Nikhil Kamath.'), 'Zerodha').values[0]?.value).toBe('2010');
  });

  it('STRIPE: revenue of Stripe\'s CUSTOMERS / products is not Stripe\'s revenue', () => {
    expect(extractRevenue(p('Stripe Atlas businesses collectively generate over $5 billion in yearly revenue.'), 'Stripe').values).toHaveLength(0);
    expect(extractRevenue(p('Businesses that processed under $100,000 annually saw a revenue growth of 140% after borrowing from Stripe Capital.'), 'Stripe').values).toHaveLength(0);
  });

  it('CLOUDFLARE: a quarter or trailing-twelve-month figure is not fiscal-year revenue', () => {
    const q = extractRevenue(p('Cloudflare had revenue of $696.06M in the quarter ending June 30, 2026, with 35.87% growth.'), 'Cloudflare');
    expect(q.values).toHaveLength(0);
    expect(q.rejected[0].reason).toMatch(/quarterly/);
    expect(extractRevenue(p('Cloudflare revenue in the last twelve months was $2.51B.'), 'Cloudflare').values).toHaveLength(0);
  });

  it('STRIPE: "estimated" is a hedge, and net vs gross are shown as different measures', () => {
    const net = extractRevenue(p('In 2025 , Stripe had an estimated net revenue of $6.9 billion , up 36% YoY.'), 'Stripe').values[0];
    expect(net).toMatchObject({ value: '6900000000', approximation: true, qualifier: 'net', year: 2025 });
    expect(toEvidenceValue(net).value).toBe('USD 6,900,000,000 (net, 2025)');
    const gross = extractRevenue(p('Stripe’s gross revenue reached an estimated $19.4 billion in 2025.'), 'Stripe').values[0];
    expect(gross).toMatchObject({ value: '19400000000', approximation: true, qualifier: 'gross' });
  });

  it('HTML entities are decoded in the verbatim statement; code/embed blocks are not prose', () => {
    const r = extractRevenue(p('In 2025, Stripe&#x27;s revenue reached $19.4B.'), 'Stripe');
    expect(r.values[0].sourceStatement).toBe("In 2025, Stripe's revenue reached $19.4B.");
    const embed = '<textarea>&lt;div style=&quot;x&quot;&gt;Cloudflare revenue was $9 billion in 2025.&lt;/div&gt;</textarea><p>Other text on the page today.</p>';
    expect(extractRevenue(embed, 'Cloudflare').values).toHaveLength(0);
    expect(decodeEntities('&lt;b&gt; &#39;x&#x27; &amp;amp; &unknown;')).toBe("<b> 'x' &amp; &unknown;");
  });
});

describe('CPG-007 (I) §21 matrix gaps', () => {
  const p = (s: string) => `<p>${s}</p>`;

  it('revenue: explicit CURRENT revenue', () => {
    expect(extractRevenue(p('Acme Analytics annual revenue is ₹12 crore.'), ACME).values[0])
      .toMatchObject({ value: '120000000', temporalType: 'CURRENT', currency: 'INR' });
  });

  it('founded: a domain-registration-like date is not a founding year', () => {
    expect(extractFoundedYear(p('The acmeanalytics.in domain was registered in 2005 and renewed in 2024.'), ACME).values).toHaveLength(0);
    expect(extractFoundedYear(p('WHOIS: Creation Date 2005-03-01 for Acme Analytics.'), ACME).values).toHaveLength(0);
  });

  it('funding: an acquisition price is not funding', () => {
    const r = extractFunding(p('Acme Analytics acquired DataCo for $40 million in a deal that closed its round of consolidation.'), ACME);
    expect(r.values).toHaveLength(0);
  });

  it('entity: a multi-company document yields only the subject company\'s values', () => {
    const doc = p('Cloudflare revenue was $1.67 billion in 2024.') + p('Akamai revenue was $3.99 billion in 2024.')
      + p('Cloudflare and Akamai together reported revenue of $5.66 billion.');
    const cf = extractRevenue(doc, 'Cloudflare');
    expect(cf.values.map((v) => v.value)).toEqual(['1670000000']);
    const ak = extractRevenue(doc, 'Akamai');
    expect(ak.values.map((v) => v.value)).toEqual(['3990000000']);
  });

  it('provenance: discovery provider, query and rank survive into persistence', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.'),
    });
    expect(ev[0].discovery).toEqual({ provider: 'keyless_web', query: expect.stringContaining('Acme Analytics'), rank: 1 });
    const store = createInMemoryStore();
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, null);
    await persistGrounding(store, { companyId: 'c1', companyDomain: ACME_DOMAIN, fields: [g], sourceOutcomes: [], actor: 'system', asOf: ASOF });
    const [row] = await store.listClaims('c1');
    expect(row.discovery).toEqual(ev[0].discovery);
    expect(row.sourceUrl).toBe('https://www.livemint.com/a');
    expect(row.extraction!.sourceStatement).toBe('Acme Analytics revenue was ₹7.8 crore in FY2024.');
  });
});

describe('CPG-007 (J) resolver — historical vs current, and CPG-003 authority (§6, §14)', () => {
  const two = {
    'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹6 crore in FY2023.'),
    'https://economictimes.indiatimes.com/b': newsPage('The Economic Times', 'Acme Analytics reported revenue of ₹7.8 crore for FY2024.'),
  };

  it('an OLDER fiscal year is history, not a contradiction of the current value', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', two);
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, user('revenue', '₹7.8 Cr'));
    expect(g.status).not.toBe('CONFLICTING');
    expect(g.isMaterialConflict).toBe(false);
    expect(g.evidence).toHaveLength(2);              // FY2023 retained, not discarded
  });

  it('the LATEST period contradicting the user is still a conflict (user value outdated)', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', two);
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, user('revenue', '₹6 Cr'));
    expect(g.status).toBe('CONFLICTING');
    expect(g.conflictingEvidence[0].value).toBe('INR 78,000,000 (FY2024)');
  });

  it('with no user value, the latest SUFFICIENTLY-SUPPORTED period becomes effective regardless of document order', async () => {
    // CPG-008: FY2024 is now corroborated by two publishers — a single weak
    // source would be OBSERVED only (B-17), so the fixture must earn its value.
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      ...two,
      'https://www.business-standard.com/c': newsPage('Business Standard', 'Acme Analytics revenue stood at ₹7.8 crore in FY2024.'),
    });
    expect(resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, null).effectiveValue).toBe('INR 78,000,000 (FY2024)');
    expect(resolveWith(ACME, ACME_DOMAIN, 'revenue', [...ev].reverse(), null).effectiveValue).toBe('INR 78,000,000 (FY2024)');
    // FY2023 is a different fact (another period), not a dissent.
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, null);
    expect(g.adjudication!.candidates.find((c) => c.value.includes('FY2023'))!.role).toBe('OTHER_MEASURE');
    expect(g.isMaterialConflict).toBe(false);
  });

  it('the latest-period preference is REVENUE-only (a later founding year is not "better")', () => {
    const fy = (value: string, host: string): EvidenceClaim => ({
      claimId: host, field: 'founded_year', value, normalizedValue: value, sourceType: 'editorial', sourceName: host,
      sourceUrl: `https://${host}/x`, sourcePublishedAt: null, sourceAccessedAt: ASOF, excerpt: null, verificationMethod: 'crawl',
      entitySignals: { companyName: ACME, domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null },
      extraction: { sourceStatement: `founded in ${value}`, temporalType: 'HISTORICAL', period: null, year: Number(value),
        currency: null, approximation: false, moneyKind: null, method: 'explicit_statement', acceptedBecause: 'x' },
    });
    // CPG-008: two equal, uncorroborated publishers disagreeing is a CONFLICT,
    // not a win for whichever came first (before CPG-008: '2009' by list order).
    const g = resolveWith(ACME, ACME_DOMAIN, 'founded_year', [fy('2009', 'a.example'), fy('2010', 'b.example')], null);
    expect(g.effectiveValue).toBeNull();
    expect(g.status).toBe('CONFLICTING');
    const r = resolveWith(ACME, ACME_DOMAIN, 'founded_year', [fy('2010', 'b.example'), fy('2009', 'a.example')], null);
    expect(r.effectiveValue).toBeNull();                        // order-independent
  });

  it('§14: a perfectly parsed revenue value from a neverFor=revenue source is excluded from resolution', () => {
    // Hand-built claim on the company's OWN domain (CPG-003: first_party_website neverFor revenue).
    const own: EvidenceClaim = {
      claimId: 'own', field: 'revenue', value: 'INR 500,000,000 (FY2024)', normalizedValue: 'INR 500000000',
      sourceType: 'company_website', sourceName: ACME_DOMAIN, sourceUrl: `https://${ACME_DOMAIN}/about`,
      sourcePublishedAt: null, sourceAccessedAt: ASOF, excerpt: 'Acme Analytics revenue was ₹50 crore in FY2024.',
      verificationMethod: 'crawl',
      entitySignals: { companyName: ACME, domain: ACME_DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null },
      extraction: { sourceStatement: 'Acme Analytics revenue was ₹50 crore in FY2024.', temporalType: 'HISTORICAL', period: 'FY', year: 2024,
        currency: 'INR', approximation: false, moneyKind: 'revenue', method: 'explicit_statement', acceptedBecause: 'x' },
    };
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', [own], user('revenue', '₹10 Cr'));
    expect(g.status).toBe('USER_PROVIDED');
    expect(g.isMaterialConflict).toBe(false);
    expect(g.evidence.map((e) => e.claimId)).toEqual(['own']);   // retained for audit
    expect(resolveWith(ACME, ACME_DOMAIN, 'revenue', [own], null).effectiveValue).toBeNull();
  });
});

describe('CPG-007 (G) §20 persistence keeps extraction provenance', () => {
  it('stores temporal type, period, currency, approximation and the verbatim statement', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was approximately ₹7.8 crore in FY2024.', '2025-06-01T00:00:00Z'),
    });
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, user('revenue', '₹10 Cr'));
    const store = createInMemoryStore();
    await persistGrounding(store, { companyId: 'c1', companyDomain: ACME_DOMAIN, fields: [g], sourceOutcomes: [], actor: 'system', asOf: ASOF });

    const [row] = (await store.listClaims('c1')).filter((c) => c.field === 'revenue');
    expect(row.value).toBe('INR 78,000,000 (FY2024)');
    expect(row.normalizedValue).toBe('INR 78000000');
    expect(row.sourcePublishedAt).toBe('2025-06-01T00:00:00.000Z');
    expect(row.extraction).toMatchObject({
      temporalType: 'HISTORICAL', period: 'FY', year: 2024, currency: 'INR',
      approximation: true, moneyKind: 'revenue', method: 'explicit_statement',
    });
    expect(row.extraction!.sourceStatement).toBe('Acme Analytics revenue was approximately ₹7.8 crore in FY2024.');
  });

  it('DEFECT (live E2E): two discovered publishers are TWO provider families, not one "user_reference"', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.'),
      'https://economictimes.indiatimes.com/b': newsPage('The Economic Times', 'Acme Analytics reported revenue of ₹7.8 crore for FY2024.'),
    });
    const store = createInMemoryStore();
    await persistGrounding(store, { companyId: 'c1', companyDomain: ACME_DOMAIN, fields: [resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, null)], sourceOutcomes: [], actor: 'system', asOf: ASOF });
    const rows = await store.listClaims('c1');
    // CPG-008: families are publisher-level (registrable domain).
    expect(new Set(rows.map((r) => r.providerFamily))).toEqual(new Set(['livemint.com', 'indiatimes.com']));
    expect((await store.getField('c1', 'revenue'))!.independentFamilies).toBe(2);
  });

  it('DEFECT (live E2E): families are counted for the EFFECTIVE value only — disagreement is not corroboration', async () => {
    const ev = await acquire(ACME, ACME_DOMAIN, 'revenue', {
      'https://www.livemint.com/a': newsPage('Mint', 'Acme Analytics revenue was ₹7.8 crore in FY2024.'),
      'https://economictimes.indiatimes.com/b': newsPage('The Economic Times', 'Acme Analytics reported revenue of ₹9.1 crore for FY2024.'),
    });
    const store = createInMemoryStore();
    await persistGrounding(store, { companyId: 'c1', companyDomain: ACME_DOMAIN, fields: [resolveWith(ACME, ACME_DOMAIN, 'revenue', ev, user('revenue', '₹7.8 Cr'))], sourceOutcomes: [], actor: 'system', asOf: ASOF });
    // Two publishers, but only ONE supports the effective (user) value.
    expect((await store.getField('c1', 'revenue'))!.independentFamilies).toBe(1);
  });

  it('DEFECT (live E2E): the same value stated twice on ONE page is one observation', async () => {
    const page = newsPage('Tracxn', 'Acme Analytics has raised a total of $3M over 2 funding rounds.</p><p>Acme Analytics has raised a total of $3M over 2 rounds.');
    const ev = await acquire(ACME, ACME_DOMAIN, 'funding', { 'https://tracxn.com/x': page });
    expect(ev).toHaveLength(2);                                 // two statements extracted…
    const store = createInMemoryStore();
    await persistGrounding(store, { companyId: 'c1', companyDomain: ACME_DOMAIN, fields: [resolveWith(ACME, ACME_DOMAIN, 'funding', ev, null)], sourceOutcomes: [], actor: 'system', asOf: ASOF });
    const rows = await store.listClaims('c1');
    expect(rows).toHaveLength(1);                               // …one claim row
    expect(rows[0].observationCount).toBe(1);                   // …one observation, not two
  });

  it('claims from non-extraction sources carry extraction = null', async () => {
    const g = resolveWith(ACME, ACME_DOMAIN, 'revenue', [{
      claimId: 'x', field: 'revenue', value: '₹7.8 Cr', normalizedValue: '₹7.8 cr', sourceType: 'editorial',
      sourceName: 'n', sourceUrl: 'https://n.example/x', sourcePublishedAt: null, sourceAccessedAt: ASOF,
      excerpt: null, verificationMethod: 'crawl',
      entitySignals: { companyName: ACME, domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null },
    }], null);
    const store = createInMemoryStore();
    await persistGrounding(store, { companyId: 'c1', companyDomain: ACME_DOMAIN, fields: [g], sourceOutcomes: [], actor: 'system', asOf: ASOF });
    expect((await store.listClaims('c1'))[0].extraction).toBeNull();
  });
});
