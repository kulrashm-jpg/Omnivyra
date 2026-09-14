/**
 * CPG-008 — adjudication of public evidence (B-16 public/public conflict,
 * B-17 weak single-source winners).
 *
 * SYNTHETIC ADVERSARIAL FIXTURES. No network, no database, no LLM. Every claim
 * below is hand-built test data, never presented as retrieved evidence. The
 * fixtures test the RULES (sufficiency, comparability, family independence,
 * authority dominance), not the expected outcome of any live example.
 *
 * Sufficiency rule under test (claimAdjudication.ts): a value may become
 * effective only with ≥2 independent provider families (S1), a tier-1 source
 * (S2), or a CPG-003-authoritative source for the field (S3).
 */

import { resolve, buildConfirmationRequest } from '../../services/companyProfile/grounding/claimResolution';
import { applyUserDecision } from '../../services/companyProfile/grounding/confirmation';
import { createInMemoryStore, persistGrounding } from '../../services/companyProfile/grounding/persistence/groundingStore';
import { extractCeo, extractFunding, extractRevenue } from '../../services/companyProfile/grounding/extraction/documentExtractors';
import type { EntitySignals, EvidenceClaim, ExtractionProvenance, UserClaim } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-10T00:00:00.000Z';
const FRESH = '2026-08-20T00:00:00.000Z';
const STALE = '2019-01-01T00:00:00.000Z';
const CO = 'Acme Analytics';
const DOMAIN = 'acme.example.com';
const KNOWN: EntitySignals = { companyName: CO, domain: DOMAIN, linkedinUrl: null, location: null, leadership: [], registryId: null };

let seq = 0;
interface Ev {
  field: string; value: string; norm?: string; url: string;
  year?: number | null; qualifier?: string | null; period?: string | null;
  temporal?: ExtractionProvenance['temporalType']; published?: string | null;
  sourceName?: string; discovered?: boolean; rank?: number;
  entity?: 'name' | 'domain' | 'foreign'; sourceType?: EvidenceClaim['sourceType'];
}
function ev(o: Ev): EvidenceClaim {
  const host = new URL(o.url).hostname;
  const signals: EntitySignals = o.entity === 'domain'
    ? { ...KNOWN, companyName: CO }
    : o.entity === 'foreign'
      ? { companyName: CO, domain: 'someone-else.example', linkedinUrl: null, location: null, leadership: [], registryId: null }
      : { companyName: CO, domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null };
  const money = /^[A-Z]{3} /.test(o.value);
  return {
    claimId: `fx-${++seq}`, field: o.field, value: o.value, normalizedValue: o.norm ?? o.value.toLowerCase(),
    sourceType: o.sourceType ?? 'editorial', sourceName: o.sourceName ?? host, sourceUrl: o.url,
    sourcePublishedAt: o.published === undefined ? FRESH : o.published, sourceAccessedAt: ASOF,
    excerpt: 'fixture', verificationMethod: 'crawl', entitySignals: signals,
    ...(o.discovered === false ? {} : { discovery: { provider: 'keyless_web', query: 'fixture', rank: o.rank ?? 1 } }),
    extraction: {
      sourceStatement: 'FIXTURE statement', temporalType: o.temporal ?? 'HISTORICAL',
      period: o.period ?? null, year: o.year ?? null, currency: money ? o.value.slice(0, 3) : null,
      approximation: false, moneyKind: money ? (o.field === 'funding' ? 'funding' : 'revenue') : null,
      method: 'explicit_statement', acceptedBecause: 'fixture', qualifier: o.qualifier ?? null,
    },
  };
}
const fy = (value: string, url: string, extra: Partial<Ev> = {}) => ev({ field: 'founded_year', value, url, year: Number(value), ...extra });
const wikidata = (value: string, published: string | null = FRESH) => fy(value, 'https://www.wikidata.org/wiki/Q42', {
  sourceName: 'Wikidata', discovered: false, sourceType: 'business_intelligence', published,
});
const pub = (field: string, evidence: EvidenceClaim[]) => resolve({
  companyId: 'c1', field, kind: 'FACT', userClaim: null, evidence, knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF,
});
const user = (field: string, value: string): UserClaim => ({
  field, value, normalizedValue: value.toLowerCase(), assertedAt: '2026-01-01T00:00:00.000Z', assertedBy: 'u1',
});

describe('CPG-008 (1) B-17 — a weak isolated claim is OBSERVED, never effective', () => {
  it('single weak source → OBSERVED_ONLY, effective null, claim retained with its strength', () => {
    const g = pub('funding', [ev({ field: 'funding', value: 'USD 16,400,000 (latest round)', norm: 'USD 16400000', url: 'https://weak-funding.example/x', qualifier: 'latest round' })]);
    expect(g.effectiveValue).toBeNull();
    expect(g.effectiveValueSource).toBe('none');
    expect(g.adjudication!.evidenceState).toBe('OBSERVED_ONLY');
    expect(g.adjudication!.outcome).toBe('INSUFFICIENT_EVIDENCE');
    expect(g.adjudication!.requiresReview).toBe(false);
    expect(g.evidence).toHaveLength(1);                                     // not discarded
    expect(g.adjudication!.candidates[0]).toMatchObject({ sufficient: false, role: 'OBSERVED', families: ['weak-funding.example'] });
    expect(g.confidence.score).toBe(g.adjudication!.candidates[0].strength);  // the field says how weak it is
  });

  it('the same publisher on several pages is ONE family — still observed only', () => {
    const g = pub('founded_year', [fy('2009', 'https://en.wikipedia.org/wiki/Acme'), fy('2009', 'https://hi.wikipedia.org/wiki/Acme'), fy('2009', 'https://en.wikipedia.org/wiki/Acme_Analytics')]);
    expect(g.adjudication!.candidates[0].families).toEqual(['wikipedia.org']);
    expect(g.adjudication!.evidenceState).toBe('OBSERVED_ONLY');
    expect(g.effectiveValue).toBeNull();
  });

  it('a strong source still becomes effective alone (tier-1 source not weak for the field)', () => {
    // CPG-012: this used an MCA master-data page. A registry states the INCORPORATION
    // date, which is not the founding year, so registries are now WEAK for
    // founded_year (S2 does not apply). The rule under test is unchanged; it is
    // exercised with the company's own site, tier 1 and not weak for the field.
    const g = pub('founded_year', [fy('2009', `https://${DOMAIN}/about`, { sourceType: 'company_website' })]);
    expect(g.effectiveValue).toBe('2009');
    expect(g.adjudication!.outcome).toBe('SUFFICIENT_SINGLE_VALUE');
    expect(g.adjudication!.candidates[0].sufficientBecause).toMatch(/S2: a tier-1 source/);
  });

  it('a CPG-003-authoritative source becomes effective alone (Wikidata for founded_year)', () => {
    const g = pub('founded_year', [wikidata('2009')]);
    expect(g.effectiveValue).toBe('2009');
    expect(g.adjudication!.candidates[0].sufficientBecause).toMatch(/S3: a source CPG-003 marks authoritative/);
  });
});

describe('CPG-008 (2) corroboration', () => {
  it('three weak sources agreeing are sufficient (S1) — and entity-weak caps the status at REPORTED', () => {
    const g = pub('founded_year', [fy('2009', 'https://a-news.example/1'), fy('2009', 'https://b-news.example/2'), fy('2009', 'https://c-news.example/3')]);
    expect(g.effectiveValue).toBe('2009');
    expect(g.adjudication!.supportingFamilies).toEqual(['a-news.example', 'b-news.example', 'c-news.example']);
    expect(g.status).toBe('PUBLICLY_REPORTED');                 // name-only entity match: never "verified"
  });

  it('same-publisher repetition cannot manufacture corroboration', () => {
    const g = pub('founded_year', [fy('2009', 'https://news.indiatimes.com/a'), fy('2009', 'https://economictimes.indiatimes.com/b')]);
    expect(g.adjudication!.candidates[0].families).toEqual(['indiatimes.com']);
    expect(g.effectiveValue).toBeNull();
  });
});

describe('CPG-008 (3) B-16 — public/public conflict with no user value', () => {
  it('two equal-quality sources disagreeing → CONFLICTING, no winner, review required', () => {
    const g = pub('founded_year', [fy('2009', 'https://a-news.example/1'), fy('2010', 'https://b-news.example/2')]);
    expect(g.status).toBe('CONFLICTING');
    expect(g.effectiveValue).toBeNull();
    expect(g.isMaterialConflict).toBe(true);
    expect(g.confirmationStatus).toBe('PENDING_USER_CONFIRMATION');
    expect(g.adjudication).toMatchObject({ evidenceState: 'CONFLICTING', outcome: 'PUBLIC_CONFLICT_UNRESOLVED', requiresReview: true });
    expect(g.adjudication!.candidates.map((c) => [c.value, c.role])).toEqual([['2009', 'COMPETING'], ['2010', 'COMPETING']]);
    expect(g.history.some((h) => h.action === 'conflict_detected')).toBe(true);
  });

  it('two STRONG (corroborated) sides disagreeing → still a conflict; no winner is fabricated', () => {
    const g = pub('founded_year', [
      fy('2009', 'https://a-news.example/1'), fy('2009', 'https://b-news.example/2'),
      fy('2010', 'https://c-news.example/3'), fy('2010', 'https://d-news.example/4'),
    ]);
    expect(g.adjudication!.outcome).toBe('PUBLIC_CONFLICT_UNRESOLVED');
    expect(g.adjudication!.candidates.every((c) => c.sufficient)).toBe(true);
    expect(g.effectiveValue).toBeNull();
  });

  it('one strong + one weak disagreeing → the strong one wins; the weak dissent is retained', () => {
    const g = pub('founded_year', [fy('2009', 'https://a-news.example/1'), fy('2009', 'https://b-news.example/2'), fy('2010', 'https://c-news.example/3')]);
    expect(g.effectiveValue).toBe('2009');
    expect(g.adjudication!.outcome).toBe('WINNER_BY_EVIDENCE');
    expect(g.isMaterialConflict).toBe(false);
    expect(g.adjudication!.candidates.find((c) => c.value === '2010')!.role).toBe('DISSENT');
    expect(g.conflictingEvidence.map((e) => e.sourceUrl)).toEqual(['https://c-news.example/3']);
  });

  it('several sufficient sides, but only one with FRESH CPG-003-authoritative support → authority wins', () => {
    const g = pub('founded_year', [wikidata('2009'), fy('2010', 'https://a-news.example/1'), fy('2010', 'https://b-news.example/2')]);
    expect(g.effectiveValue).toBe('2009');
    expect(g.adjudication!.outcome).toBe('WINNER_BY_AUTHORITY');
  });

  it('stale authoritative vs fresh CORROBORATED weaker sources → conflict (authority does not dominate when stale)', () => {
    const g = pub('founded_year', [wikidata('2009', STALE), fy('2010', 'https://a-news.example/1'), fy('2010', 'https://b-news.example/2')]);
    expect(g.adjudication!.outcome).toBe('PUBLIC_CONFLICT_UNRESOLVED');
    expect(g.effectiveValue).toBeNull();
  });

  it('stale authoritative vs one fresh WEAK source → the authoritative source wins (the weak one is insufficient)', () => {
    const g = pub('founded_year', [wikidata('2009', STALE), fy('2010', 'https://a-news.example/1')]);
    expect(g.effectiveValue).toBe('2009');
    expect(g.adjudication!.outcome).toBe('WINNER_BY_EVIDENCE');
  });

  it('a SELF-CONTRADICTING publisher is independent support for neither value', () => {
    // forbes states both years; tracxn states 2010 → 2010 has one clean family, 2009 none.
    const g = pub('founded_year', [
      fy('2009', 'https://www.forbes.com/companies/acme/'), fy('2010', 'https://www.forbes.com/companies/acme/#jsonld'),
      fy('2010', 'https://tracxn.com/d/companies/acme'),
    ]);
    expect(g.adjudication!.outcome).toBe('PUBLIC_CONFLICT_UNRESOLVED');
    // CPG-010: Tracxn is a bound source with its own family ('tracxn'), not a bare host.
    expect(g.adjudication!.candidates.find((c) => c.value === '2010')!.families).toEqual(['tracxn']);
    expect(g.adjudication!.candidates.find((c) => c.value === '2009')!.families).toEqual([]);
  });

  it('CEO: two different current CEOs from equal sources → conflict', () => {
    const g = pub('ceo', [
      ev({ field: 'ceo', value: 'Patrick Collison', url: 'https://a-news.example/1', temporal: 'CURRENT' }),
      ev({ field: 'ceo', value: 'John Collison', url: 'https://b-news.example/2', temporal: 'CURRENT' }),
    ]);
    expect(g.adjudication!.outcome).toBe('PUBLIC_CONFLICT_UNRESOLVED');
  });

  it('the public-conflict confirmation request lists every competing value — no "own value" option', () => {
    const g = pub('founded_year', [fy('2009', 'https://a-news.example/1'), fy('2010', 'https://b-news.example/2')]);
    const q = buildConfirmationRequest(g, DOMAIN)!;
    expect(q.question).toMatch(/Public sources disagree on founded_year: "2009" vs "2010"/);
    expect(q.userValue).toBeNull();
    expect(q.options).not.toContain('USER_CONFIRMED_OWN_VALUE');
    expect(q.competingValues!.map((v) => v.value)).toEqual(['2009', '2010']);
  });
});

describe('CPG-008 (4) comparability — differences that are NOT conflicts', () => {
  it('different fiscal years are different facts (temporal), not a conflict', () => {
    const g = pub('revenue', [
      ev({ field: 'revenue', value: 'INR 60,000,000 (FY2023)', norm: 'INR 60000000', url: 'https://a-news.example/1', year: 2023, period: 'FY' }),
      ev({ field: 'revenue', value: 'INR 78,000,000 (FY2024)', norm: 'INR 78000000', url: 'https://b-news.example/2', year: 2024, period: 'FY' }),
    ]);
    expect(g.isMaterialConflict).toBe(false);
    expect(g.adjudication!.primaryClass).toBe('2024|revenue');
    expect(g.adjudication!.candidates.find((c) => c.comparabilityClass === '2023|revenue')!.role).toBe('OTHER_MEASURE');
  });

  it('total raised vs latest round are different measures, not a conflict', () => {
    const g = pub('funding', [
      ev({ field: 'funding', value: 'USD 332,000,000 (total raised)', norm: 'USD 332000000', url: 'https://a-news.example/1', qualifier: 'total raised' }),
      ev({ field: 'funding', value: 'USD 1,290,000,000 (largest round)', norm: 'USD 1290000000', url: 'https://b-news.example/2', qualifier: 'largest round' }),
    ]);
    expect(g.isMaterialConflict).toBe(false);
    expect(g.adjudication!.primaryClass).toBe('total raised');
  });

  it('two different TOTALS are a conflict (same measure)', () => {
    const g = pub('funding', [
      ev({ field: 'funding', value: 'USD 332,000,000 (total raised)', norm: 'USD 332000000', url: 'https://a-news.example/1', qualifier: 'total raised' }),
      ev({ field: 'funding', value: 'USD 7,000,000,000 (total raised)', norm: 'USD 7000000000', url: 'https://b-news.example/2', qualifier: 'total raised' }),
    ]);
    expect(g.adjudication!.outcome).toBe('PUBLIC_CONFLICT_UNRESOLVED');
  });

  it('two "latest round" figures are separate events: never a conflict', () => {
    const g = pub('funding', [
      ev({ field: 'funding', value: 'USD 5,000,000 (latest round)', norm: 'USD 5000000', url: 'https://a-news.example/1', qualifier: 'latest round' }),
      ev({ field: 'funding', value: 'USD 9,000,000 (latest round)', norm: 'USD 9000000', url: 'https://b-news.example/2', qualifier: 'latest round' }),
    ]);
    expect(g.isMaterialConflict).toBe(false);
    expect(g.adjudication!.evidenceState).toBe('OBSERVED_ONLY');
  });

  it('revenue vs net revenue are never equated; only qualified measures for the year → AMBIGUOUS, no value', () => {
    const g = pub('revenue', [
      ev({ field: 'revenue', value: 'USD 6,900,000,000 (net, 2025)', norm: 'USD 6900000000', url: 'https://a-news.example/1', year: 2025, qualifier: 'net' }),
      ev({ field: 'revenue', value: 'USD 19,400,000,000 (gross, 2025)', norm: 'USD 19400000000', url: 'https://b-news.example/2', year: 2025, qualifier: 'gross' }),
    ]);
    expect(g.isMaterialConflict).toBe(false);
    expect(g.adjudication!.outcome).toBe('AMBIGUOUS_MEASURE');
    expect(g.effectiveValue).toBeNull();
  });

  it('₹7.8 Cr and ₹7.80 Cr are the same value (canonical money key)', () => {
    const g = pub('revenue', [
      ev({ field: 'revenue', value: 'INR 78,000,000 (FY2024)', norm: 'INR 78000000', url: 'https://a-news.example/1', year: 2024, period: 'FY' }),
      ev({ field: 'revenue', value: 'INR 78,000,000.00 (FY2024)', norm: 'INR 78000000', url: 'https://b-news.example/2', year: 2024, period: 'FY' }),
    ]);
    expect(g.adjudication!.candidates).toHaveLength(1);
    expect(g.adjudication!.candidates[0].families).toHaveLength(2);
    expect(g.effectiveValue).not.toBeNull();
  });
});

describe('CPG-008 (5) boundaries that must still hold', () => {
  it('neverFor stays excluded: the company\'s own site cannot supply revenue, even unopposed', () => {
    const g = pub('revenue', [ev({ field: 'revenue', value: 'INR 500,000,000 (FY2024)', norm: 'INR 500000000', url: `https://${DOMAIN}/about`, year: 2024, period: 'FY', sourceType: 'company_website', discovered: false, entity: 'domain' })]);
    expect(g.effectiveValue).toBeNull();
    expect(g.adjudication!.candidates).toHaveLength(0);
    expect(g.evidence).toHaveLength(1);                                     // retained for audit
  });

  it('entity mismatch: another company\'s claim is not a candidate', () => {
    // CPG-012: the strong source is the company's own site (registries are weak for founded_year).
    const g = pub('founded_year', [fy('1999', 'https://a-news.example/1', { entity: 'foreign' }), fy('2009', `https://${DOMAIN}/x`, { sourceType: 'company_website' })]);
    expect(g.adjudication!.candidates.map((c) => c.value)).toEqual(['2009']);
    expect(g.effectiveValue).toBe('2009');
  });

  it('subsidiary / product attribution never produces a candidate (extraction boundary)', () => {
    expect(extractRevenue('<p>Acme Analytics Cloud revenue was $5 million in 2024.</p>', CO).values).toHaveLength(0);
    expect(extractFunding('<p>Acme Analytics Ventures raised $40 million in a Series B round.</p>', CO).values).toHaveLength(0);
  });

  it('a FORMER CEO never competes with the current one (temporal boundary)', () => {
    const current = extractCeo('<p>Acme Analytics CEO Jane Doe announced results.</p>', CO).values;
    const former = extractCeo('<p>Former Acme Analytics CEO John Roe joined another firm.</p>', CO).values;
    expect(current.map((v) => v.value)).toEqual(['Jane Doe']);
    expect(former).toHaveLength(0);
  });

  it('valuation is never funding (extraction boundary)', () => {
    expect(extractFunding('<p>Acme Analytics raised funds at a valuation of $2 billion in 2024.</p>', CO).values).toHaveLength(0);
  });

  it('search rank and evidence order change nothing', () => {
    const a = [fy('2009', 'https://a-news.example/1', { rank: 1 }), fy('2010', 'https://b-news.example/2', { rank: 2 })];
    const b = [fy('2010', 'https://b-news.example/2', { rank: 1 }), fy('2009', 'https://a-news.example/1', { rank: 9 })];
    const strip = (x: ReturnType<typeof pub>) => ({ ...x.adjudication!, candidates: x.adjudication!.candidates.map(({ claimIds, ...c }) => c) });
    expect(strip(pub('founded_year', a))).toEqual(strip(pub('founded_year', b)));
  });
});

describe('CPG-008 (6) user value — CPG-001 behaviour intact', () => {
  it('user ₹10 Cr vs public ₹7.8 Cr FY2024 → CONFLICTING, PENDING_USER_CONFIRMATION, user value effective', () => {
    const g = resolve({
      companyId: 'c1', field: 'revenue', kind: 'FACT', userClaim: { ...user('revenue', '₹10 Cr'), normalizedValue: '₹10 cr' },
      evidence: [ev({ field: 'revenue', value: 'INR 78,000,000 (FY2024)', norm: 'INR 78000000', url: 'https://a-news.example/1', year: 2024, period: 'FY' })],
      knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF,
    });
    expect(g.status).toBe('CONFLICTING');
    expect(g.confirmationStatus).toBe('PENDING_USER_CONFIRMATION');
    expect(g.effectiveValue).toBe('₹10 Cr');
    expect(g.adjudication).toMatchObject({ evidenceState: 'CONFLICTING', outcome: 'USER_VALUE', requiresReview: true });
  });

  it('a user value beside a weak public claim stays effective (B-17 does not demote the user)', () => {
    const g = resolve({
      companyId: 'c1', field: 'founded_year', kind: 'FACT', userClaim: user('founded_year', '2009'),
      evidence: [fy('2009', 'https://a-news.example/1')], knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF,
    });
    expect(g.effectiveValue).toBe('2009');
    expect(g.adjudication).toMatchObject({ evidenceState: 'EFFECTIVE', outcome: 'USER_VALUE' });
  });

  it('accept_public on a PUBLIC conflict makes the chosen value effective by USER_DECISION', () => {
    const g = pub('founded_year', [fy('2009', 'https://a-news.example/1'), fy('2010', 'https://b-news.example/2')]);
    const chosen = g.conflictingEvidence.find((e) => e.value === '2010')!;
    const d = applyUserDecision({ grounded: g, decision: { kind: 'accept_public', evidenceId: chosen.claimId }, actor: 'u1', asOf: ASOF });
    expect(d.effectiveValue).toBe('2010');
    expect(d.adjudication).toMatchObject({ evidenceState: 'EFFECTIVE', outcome: 'USER_DECISION', requiresReview: false });
  });

  it('correcting a public conflict makes the user\'s correction effective', () => {
    const g = pub('founded_year', [fy('2009', 'https://a-news.example/1'), fy('2010', 'https://b-news.example/2')]);
    const d = applyUserDecision({ grounded: g, decision: { kind: 'correct', newValue: '2011', normalizedValue: '2011' }, actor: 'u1', asOf: ASOF });
    expect(d.effectiveValue).toBe('2011');
    expect(d.adjudication!.outcome).toBe('USER_DECISION');
  });
});

describe('CPG-008 (7) persistence keeps the evidence state', () => {
  const persist = (store: ReturnType<typeof createInMemoryStore>, g: ReturnType<typeof pub>, asOf = ASOF) =>
    persistGrounding(store, { companyId: 'c1', companyDomain: DOMAIN, fields: [g], sourceOutcomes: [], actor: 'system', asOf });

  it('a public conflict is stored as CONFLICTING with every competing value and the reason', async () => {
    const store = createInMemoryStore();
    await persist(store, pub('founded_year', [fy('2009', 'https://a-news.example/1'), fy('2010', 'https://b-news.example/2')]));
    const f = (await store.getField('c1', 'founded_year'))!;
    expect(f).toMatchObject({ evidenceState: 'CONFLICTING', adjudicationOutcome: 'PUBLIC_CONFLICT_UNRESOLVED', requiresReview: true, effectiveValue: null });
    expect(f.adjudicationCandidates.map((c) => c.sourceUrls[0]).sort()).toEqual(['https://a-news.example/1', 'https://b-news.example/2']);
    expect(f.adjudicationReason).toMatch(/public sources disagree/);
  });

  it('an observed-only field is stored with NO effective value', async () => {
    const store = createInMemoryStore();
    await persist(store, pub('founded_year', [fy('2009', 'https://a-news.example/1')]));
    const f = (await store.getField('c1', 'founded_year'))!;
    expect(f).toMatchObject({ evidenceState: 'OBSERVED_ONLY', effectiveValue: null, independentFamilies: 0 });
    expect((await store.listClaims('c1'))).toHaveLength(1);                // the claim itself is kept
  });

  it('a previously effective value withdrawn by weaker evidence is recorded in history, not silently dropped', async () => {
    const store = createInMemoryStore();
    await persist(store, pub('founded_year', [fy('2009', 'https://a-news.example/1'), fy('2009', 'https://b-news.example/2')]));
    expect((await store.getField('c1', 'founded_year'))!.effectiveValue).toBe('2009');
    await persist(store, pub('founded_year', [fy('2009', 'https://a-news.example/1')]), '2026-09-11T00:00:00.000Z');
    expect((await store.getField('c1', 'founded_year'))!.effectiveValue).toBeNull();
    const hist = await store.listHistory('c1', 'founded_year');
    expect(hist.some((h) => h.action === 'value_changed' && h.fromValue === '2009' && h.toValue === null)).toBe(true);
  });

  it('a user-locked value survives a later observed-only acquisition and is stored as EFFECTIVE', async () => {
    const store = createInMemoryStore();
    const withUser = resolve({ companyId: 'c1', field: 'founded_year', kind: 'FACT', userClaim: user('founded_year', '2008'),
      evidence: [], knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF });
    await persist(store, withUser);
    await persist(store, pub('founded_year', [fy('2009', 'https://a-news.example/1')]), '2026-09-11T00:00:00.000Z');
    const f = (await store.getField('c1', 'founded_year'))!;
    expect(f).toMatchObject({ effectiveValue: '2008', effectiveValueSource: 'user', evidenceState: 'EFFECTIVE', adjudicationOutcome: 'USER_VALUE' });
  });
});
