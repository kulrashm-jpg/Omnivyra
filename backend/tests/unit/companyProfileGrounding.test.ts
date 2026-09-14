/**
 * CPG-001 — company-profile grounding behaviour tests.
 *
 * These prove BEHAVIOUR, not just execution: each case asserts the resolved
 * status, the effective value, whether history was preserved, and whether the
 * user was (or was not) asked to confirm.
 *
 * Raina-12 values appear ONLY as read-only test inputs (§14). The frozen
 * dataset is not imported, not modified, and not treated as verified truth.
 */

import {
  resolve, buildConfirmationRequest, computeConfidence, revenueKind,
  revenueComparable, isMaterialConflict, isTriviallyDifferent, evidenceFreshness,
  CONFIDENCE_FORMULA, MATERIAL_FIELDS,
} from '../../services/companyProfile/grounding/claimResolution';
import { applyUserDecision, toTraceabilityRow, DecisionError } from '../../services/companyProfile/grounding/confirmation';
import { classifySource, PROVIDER_REALITY } from '../../services/companyProfile/grounding/sourceAuthority';
import { resolveEntity, normalizeDomain } from '../../services/companyProfile/grounding/entityResolution';
import type { EntitySignals, EvidenceClaim, UserClaim } from '../../services/companyProfile/grounding/types';

const ASOF = '2026-09-10T00:00:00.000Z';
const COMPANY = 'company-001';
const DOMAIN = 'secureitsimply.com';

const KNOWN: EntitySignals = {
  companyName: 'Secure IT Simply', domain: DOMAIN, linkedinUrl: 'https://linkedin.com/company/secure-it-simply',
  location: 'India', leadership: ['Jitesh Midha'], registryId: null,
};

function userClaim(field: string, value: string): UserClaim {
  return { field, value, normalizedValue: value.toLowerCase().trim(), assertedAt: '2026-08-01T00:00:00.000Z', assertedBy: 'user-1' };
}

function evidence(over: Partial<EvidenceClaim> & { claimId: string; field: string; value: string }): EvidenceClaim {
  return {
    normalizedValue: over.value.toLowerCase().trim(),
    sourceType: 'editorial', sourceName: 'Test Source', sourceUrl: 'https://inc42.com/x',
    sourcePublishedAt: '2026-08-01T00:00:00.000Z', sourceAccessedAt: '2026-09-01T00:00:00.000Z',
    excerpt: null, verificationMethod: 'crawl',
    entitySignals: { companyName: 'Secure IT Simply', domain: DOMAIN, linkedinUrl: null, location: 'India', leadership: [], registryId: null },
    ...over,
  } as EvidenceClaim;
}

const R = (o: Partial<Parameters<typeof resolve>[0]> = {}) => resolve({
  companyId: COMPANY, field: 'industry', kind: 'FACT', userClaim: null, evidence: [],
  knownEntity: KNOWN, companyDomain: DOMAIN, asOf: ASOF, ...o,
});

describe('CPG-001 (1,2) user fact matching authoritative source(s)', () => {
  it('one Tier-1 first-party source corroborating the user ⇒ PUBLICLY_VERIFIED', () => {
    const g = R({
      userClaim: userClaim('industry', 'Cybersecurity'),
      evidence: [evidence({ claimId: 'e1', field: 'industry', value: 'Cybersecurity', sourceType: 'company_website', sourceUrl: `https://${DOMAIN}/about` })],
    });
    expect(g.status).toBe('PUBLICLY_VERIFIED');
    expect(g.effectiveValue).toBe('Cybersecurity');
    expect(g.isMaterialConflict).toBe(false);
  });

  it('two independent sources agreeing ⇒ PUBLICLY_VERIFIED with higher corroboration', () => {
    const g = R({
      userClaim: userClaim('industry', 'Cybersecurity'),
      evidence: [
        evidence({ claimId: 'e1', field: 'industry', value: 'Cybersecurity', sourceUrl: 'https://inc42.com/a' }),
        evidence({ claimId: 'e2', field: 'industry', value: 'Cybersecurity', sourceUrl: 'https://linkedin.com/company/x', sourceType: 'business_intelligence' }),
      ],
    });
    expect(g.status).toBe('PUBLICLY_VERIFIED');
    expect(g.confidence.components.corroboration).toBeGreaterThan(
      R({ userClaim: userClaim('industry', 'Cybersecurity'), evidence: [evidence({ claimId: 'e1', field: 'industry', value: 'Cybersecurity' })] })
        .confidence.components.corroboration,
    );
  });
});

describe('CPG-001 (3,4) conflict with sources of differing authority', () => {
  const conflicting = (url: string, type: EvidenceClaim['sourceType']) => R({
    field: 'revenue', userClaim: userClaim('revenue', '₹10 Cr+ revenue'),
    evidence: [evidence({ claimId: 'e1', field: 'revenue', value: '₹7.8 Cr FY24 revenue', sourceUrl: url, sourceType: type })],
  });

  // CPG-007 §14: these used the company's OWN site as the authoritative revenue
  // source. CPG-003 marks first_party_website `neverFor: revenue` and the
  // resolver now honours that, so the tier-1 source here is a regulatory filing.
  it('conflict with an authoritative source ⇒ CONFLICTING, user value retained', () => {
    const g = conflicting('https://www.sec.gov/Archives/x/10-k.htm', 'regulatory_filing');
    expect(g.status).toBe('CONFLICTING');
    expect(g.effectiveValue).toBe('₹10 Cr+ revenue');
    expect(g.effectiveValueSource).toBe('user');
    expect(g.isMaterialConflict).toBe(true);
    expect(g.confirmationStatus).toBe('PENDING_USER_CONFIRMATION');
  });

  it('CPG-007 §14: a revenue claim from the company\'s OWN site (neverFor revenue) is excluded, not resolved', () => {
    const g = conflicting(`https://${DOMAIN}/investors`, 'company_website');
    expect(g.status).toBe('USER_PROVIDED');            // nothing usable contradicts the user
    expect(g.isMaterialConflict).toBe(false);
    expect(g.evidence.map((e) => e.claimId)).toContain('e1');       // retained for audit
    expect(g.conflictingEvidence.map((e) => e.claimId)).not.toContain('e1');
  });

  it('conflict with a lower-authority source still conflicts, but scores lower', () => {
    const hi = conflicting('https://www.sec.gov/Archives/x/10-k.htm', 'regulatory_filing');
    const lo = conflicting('https://en.wikipedia.org/wiki/x', 'aggregator');
    expect(lo.status).toBe('CONFLICTING');
    expect(lo.effectiveValue).toBe('₹10 Cr+ revenue');
    expect(lo.confidence.score).toBeLessThan(hi.confidence.score);
  });

  it('produces a user-facing question naming both values and the source URL', () => {
    const g = conflicting('https://inc42.com/company/x', 'editorial');
    const req = buildConfirmationRequest(g, DOMAIN)!;
    expect(req.question).toContain('₹10 Cr+ revenue');
    expect(req.question).toContain('₹7.8 Cr FY24 revenue');
    expect(req.publicSources[0].url).toBe('https://inc42.com/company/x');
    expect(req.options).toContain('USER_CONFIRMED_OWN_VALUE');
    expect(req.options).toContain('PUBLIC_SOURCE_MARKED_STALE');
  });
});

describe('CPG-001 (5) stale sources', () => {
  it('classifies by document age, and unknown when undateable', () => {
    expect(evidenceFreshness('2026-08-01T00:00:00.000Z', ASOF, ASOF)).toBe('fresh');
    expect(evidenceFreshness('2026-01-01T00:00:00.000Z', ASOF, ASOF)).toBe('aging');
    expect(evidenceFreshness('2023-01-01T00:00:00.000Z', ASOF, ASOF)).toBe('stale');
    expect(evidenceFreshness(null, 'not-a-date', ASOF)).toBe('unknown');
  });

  it('an old article does NOT automatically defeat the user (CEO example)', () => {
    const g = R({
      field: 'ceo', userClaim: userClaim('ceo', 'B'),
      evidence: [evidence({ claimId: 'old', field: 'ceo', value: 'A', sourcePublishedAt: '2022-01-01T00:00:00.000Z' })],
    });
    expect(g.effectiveValue).toBe('B');
    expect(g.status).toBe('CONFLICTING');
    expect(g.freshness).toBe('stale');
  });
});

describe('CPG-001 (6) multiple conflicting sources', () => {
  it('retains every conflicting source rather than picking a winner', () => {
    const g = R({
      field: 'ceo', userClaim: userClaim('ceo', 'A'),
      evidence: [
        evidence({ claimId: 'e1', field: 'ceo', value: 'B', sourceUrl: 'https://linkedin.com/company/x', sourceType: 'business_intelligence' }),
        evidence({ claimId: 'e2', field: 'ceo', value: 'C', sourceUrl: 'https://inc42.com/y' }),
      ],
    });
    expect(g.status).toBe('CONFLICTING');
    expect(g.conflictingEvidence.map((e) => e.claimId).sort()).toEqual(['e1', 'e2']);
    expect(g.effectiveValue).toBe('A');
  });
});

describe('CPG-001 (7) entity mismatch', () => {
  it('a different domain forces mismatch even when the name matches', () => {
    const m = resolveEntity(KNOWN, {
      companyName: 'Secure IT Simply', domain: 'someoneelse.com', linkedinUrl: null,
      location: 'India', leadership: [], registryId: null,
    });
    expect(m.status).toBe('mismatch');
    expect(m.conflictingOn).toContain('domain');
  });

  it('name similarity alone never exceeds a weak match', () => {
    const m = resolveEntity(
      { companyName: 'Vector Technics', domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null },
      { companyName: 'Vector Technologies', domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null },
    );
    expect(['weak', 'mismatch']).toContain(m.status);
    expect(m.status).not.toBe('exact');
  });

  it('mismatched evidence cannot become the effective value', () => {
    const g = R({
      field: 'industry', userClaim: null,
      evidence: [evidence({
        claimId: 'x', field: 'industry', value: 'Petroleum',
        entitySignals: { companyName: 'Other Co', domain: 'other.com', linkedinUrl: null, location: 'UAE', leadership: [], registryId: null },
      })],
    });
    expect(g.effectiveValue).toBeNull();
    expect(g.status).toBe('UNVERIFIED');
    // but the rejected evidence is still retained for audit
    expect(g.evidence.map((e) => e.claimId)).toContain('x');
  });

  it('nothing to compare yields unresolved, not mismatch', () => {
    const m = resolveEntity(
      { companyName: null, domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null },
      { companyName: null, domain: null, linkedinUrl: null, location: null, leadership: [], registryId: null },
    );
    expect(m.status).toBe('unresolved');
  });
});

describe('CPG-001 (8,9) unsupported claims and fact vs synthesis', () => {
  it('a user claim with no evidence is USER_PROVIDED, not verified', () => {
    const g = R({ userClaim: userClaim('industry', 'Cybersecurity') });
    expect(g.status).toBe('USER_PROVIDED');
    expect(g.confidence.band).toBe('UNVERIFIED');
  });

  it('SYNTHESIS is never externally verified and carries no evidence', () => {
    const g = R({
      field: 'ideal_customer_profile', kind: 'SYNTHESIS',
      userClaim: userClaim('ideal_customer_profile', 'Enterprise buyers'),
      evidence: [evidence({ claimId: 'e1', field: 'ideal_customer_profile', value: 'Enterprise buyers' })],
    });
    expect(g.status).toBe('SYNTHESIZED');
    expect(g.evidence).toHaveLength(0);
    expect(g.confidence.score).toBe(0);
  });

  it('RECOMMENDATION is also SYNTHESIZED, never a fact', () => {
    expect(R({ kind: 'RECOMMENDATION', field: 'outreach' }).status).toBe('SYNTHESIZED');
  });
});

describe('CPG-001 (10) source URL persistence', () => {
  it('every external source keeps an inspectable URL through to the trace row', () => {
    const g = R({
      userClaim: userClaim('industry', 'Cybersecurity'),
      evidence: [evidence({ claimId: 'e1', field: 'industry', value: 'Cybersecurity', sourceUrl: 'https://inc42.com/company/secure-it-simply' })],
    });
    const row = toTraceabilityRow(g);
    expect(row.sources[0].url).toBe('https://inc42.com/company/secure-it-simply');
    expect(row.sources[0].accessedAt).toBeTruthy();
    expect(row.confidenceMeaning).toMatch(/NOT mean/);
  });
});

describe('CPG-001 (11,12,13,14) confirmation, rejection, correction, history', () => {
  const conflicted = () => R({
    field: 'revenue', userClaim: userClaim('revenue', '₹10 Cr+ revenue'),
    evidence: [evidence({ claimId: 'e1', field: 'revenue', value: '₹7.8 Cr FY24 revenue' })],
  });

  it('user confirms own value ⇒ retained, public evidence NOT deleted', () => {
    const g = applyUserDecision({ grounded: conflicted(), decision: { kind: 'confirm_own' }, actor: 'user-1', asOf: ASOF });
    expect(g.effectiveValue).toBe('₹10 Cr+ revenue');
    expect(g.confirmationStatus).toBe('USER_CONFIRMED_OWN_VALUE');
    expect(g.isMaterialConflict).toBe(false);
    expect(g.conflictingEvidence).toHaveLength(1);
  });

  it('user accepts public value ⇒ effective changes, original user claim preserved', () => {
    const g = applyUserDecision({ grounded: conflicted(), decision: { kind: 'accept_public', evidenceId: 'e1' }, actor: 'user-1', asOf: ASOF });
    expect(g.effectiveValue).toBe('₹7.8 Cr FY24 revenue');
    expect(g.effectiveValueSource).toBe('public_evidence');
    expect(g.userClaim?.value).toBe('₹10 Cr+ revenue'); // NOT destroyed
  });

  it('user correction becomes effective while preserving all prior evidence', () => {
    const g = applyUserDecision({
      grounded: conflicted(),
      decision: { kind: 'correct', newValue: '₹9.2 Cr FY25 revenue', normalizedValue: '₹9.2 cr fy25 revenue' },
      actor: 'user-1', asOf: ASOF,
    });
    expect(g.effectiveValue).toBe('₹9.2 Cr FY25 revenue');
    expect(g.effectiveValueSource).toBe('user_correction');
    expect(g.conflictingEvidence).toHaveLength(1);
    expect(g.history.some((h) => h.action === 'user_corrected')).toBe(true);
  });

  it('marking a source stale never deletes it (PUBLIC_SOURCE_STALE transition)', () => {
    const g = applyUserDecision({
      grounded: conflicted(),
      decision: { kind: 'mark_source_stale', evidenceId: 'e1', reason: 'figure predates our FY25 filing' },
      actor: 'user-1', asOf: ASOF,
    });
    expect(g.confirmationStatus).toBe('PUBLIC_SOURCE_MARKED_STALE');
    expect(g.effectiveValue).toBe('₹10 Cr+ revenue');
    expect(g.conflictingEvidence.find((e) => e.claimId === 'e1')).toBeDefined();
    expect(g.history.some((h) => h.action === 'user_marked_source_stale')).toBe(true);
  });

  it('history is append-only across a decision chain', () => {
    const a = conflicted();
    const b = applyUserDecision({ grounded: a, decision: { kind: 'defer' }, actor: 'user-1', asOf: ASOF });
    const c = applyUserDecision({ grounded: b, decision: { kind: 'confirm_own' }, actor: 'user-1', asOf: ASOF });
    expect(c.history.length).toBeGreaterThan(b.history.length);
    expect(b.history.length).toBeGreaterThan(a.history.length - 1);
    expect(c.history.map((h) => h.action)).toEqual(expect.arrayContaining(['conflict_detected', 'user_deferred', 'user_confirmed_own']));
  });

  it('a user-supplied source must carry a URL', () => {
    expect(() => applyUserDecision({
      grounded: conflicted(),
      decision: { kind: 'supply_source', evidence: evidence({ claimId: 'u1', field: 'revenue', value: 'x', sourceUrl: null }) },
      actor: 'user-1', asOf: ASOF,
    })).toThrow(DecisionError);
  });

  it('decisions never mutate the input object', () => {
    const a = conflicted();
    const before = JSON.stringify(a);
    applyUserDecision({ grounded: a, decision: { kind: 'confirm_own' }, actor: 'user-1', asOf: ASOF });
    expect(JSON.stringify(a)).toBe(before);
  });
});

describe('CPG-001 (15) revenue vs target / run-rate / order-book', () => {
  it('classifies each measure distinctly (Raina-12 shapes, read-only)', () => {
    expect(revenueKind('₹33.5 Cr FY25')).toBe('ACTUAL');
    expect(revenueKind('₹10 Cr FY26 target')).toBe('TARGET');
    expect(revenueKind('~₹18–20 Cr annualised target')).toBe('TARGET');
    expect(revenueKind('₹20 Cr+ 2026 projection')).toBe('TARGET');
    expect(revenueKind('Current monthly run-rate ₹3–5 Cr')).toBe('RUN_RATE');
    expect(revenueKind('FY order book ₹40 Cr')).toBe('ORDER_BOOK');
    expect(revenueKind('₹10 Cr initial investment')).toBe('INVESTMENT');
    expect(revenueKind('Revenue not verified')).toBe('UNVERIFIED');
    expect(revenueKind('₹100 Cr 2026 ambition')).toBe('TARGET');
  });

  it('different measures are NOT comparable and NOT reported as a conflict', () => {
    expect(revenueComparable('₹10 Cr+ revenue', '₹20 Cr FY27 target')).toBe(false);
    expect(isMaterialConflict('revenue', '₹10 Cr+ revenue', '₹20 Cr FY27 target')).toBe(false);
    const g = R({
      field: 'revenue', userClaim: userClaim('revenue', '₹10 Cr+ revenue'),
      evidence: [evidence({ claimId: 'e1', field: 'revenue', value: '₹20 Cr FY27 target' })],
    });
    expect(g.isMaterialConflict).toBe(false);
    expect(g.status).not.toBe('CONFLICTING');
    // the differing measure is still retained, not discarded
    expect(g.conflictingEvidence.map((e) => e.claimId)).toContain('e1');
  });

  it('same measure disagreeing IS a conflict', () => {
    expect(isMaterialConflict('revenue', '₹10 Cr+ revenue', '₹7.8 Cr FY24 revenue')).toBe(true);
  });
});

describe('CPG-001 (16) no silent overwrite — the core guarantee', () => {
  it('public evidence NEVER becomes effective while a user claim exists', () => {
    for (const field of ['revenue', 'industry', 'ceo', 'headquarters', 'products_services']) {
      const g = R({
        field, userClaim: userClaim(field, 'USER VALUE'),
        evidence: [evidence({
          claimId: 'e1', field, value: 'PUBLIC VALUE',
          sourceType: 'company_website', sourceUrl: `https://${DOMAIN}/x`,
        })],
      });
      expect(g.effectiveValue).toBe('USER VALUE');
      expect(g.effectiveValueSource).toBe('user');
    }
  });

  it('public evidence becomes effective ONLY when the user supplied nothing', () => {
    const g = R({
      field: 'industry', userClaim: null,
      evidence: [evidence({ claimId: 'e1', field: 'industry', value: 'Cybersecurity', sourceType: 'company_website', sourceUrl: `https://${DOMAIN}/about` })],
    });
    expect(g.effectiveValue).toBe('Cybersecurity');
    expect(g.effectiveValueSource).toBe('public_evidence');
  });
});

describe('CPG-001 (19) deterministic confidence', () => {
  it('is reproducible and bounded', () => {
    const args = { bestTierWeight: 1, independentSources: 3, freshness: 'fresh' as const, entityMatchWeight: 1, conflicting: false };
    expect(computeConfidence(args)).toEqual(computeConfidence(args));
    expect(computeConfidence(args).score).toBe(100);
    expect(computeConfidence({ ...args, bestTierWeight: 0, independentSources: 0, freshness: 'unknown', entityMatchWeight: 0 }).score).toBeGreaterThanOrEqual(0);
  });

  it('bands follow the documented thresholds', () => {
    expect(computeConfidence({ bestTierWeight: 1, independentSources: 3, freshness: 'fresh', entityMatchWeight: 1, conflicting: false }).band).toBe('VERIFIED_CANDIDATE');
    expect(computeConfidence({ bestTierWeight: 0, independentSources: 0, freshness: 'unknown', entityMatchWeight: 0, conflicting: false }).band).toBe('UNVERIFIED');
  });

  it('a conflict is penalised deterministically', () => {
    const base = { bestTierWeight: 1, independentSources: 2, freshness: 'fresh' as const, entityMatchWeight: 1 };
    const clean = computeConfidence({ ...base, conflicting: false }).score;
    const conflicted = computeConfidence({ ...base, conflicting: true }).score;
    expect(clean - conflicted).toBe(CONFIDENCE_FORMULA.weights.conflictPenalty);
  });

  it('is labelled an engineering default and disclaims probability', () => {
    expect(CONFIDENCE_FORMULA.calibration).toMatch(/NOT EMPIRICALLY CALIBRATED/);
    expect(CONFIDENCE_FORMULA.meaning).toMatch(/does NOT mean 80% likely correct/);
  });
});

describe('CPG-001 (20) material vs immaterial discrepancy', () => {
  it('trivial wording differences do not prompt the user', () => {
    expect(isTriviallyDifferent('Cybersecurity', 'cyber security')).toBe(true);
    expect(isTriviallyDifferent('Acme Ltd', 'Acme Limited')).toBe(true);
    expect(isMaterialConflict('industry', 'Cybersecurity', 'IT Services / Cybersecurity')).toBe(false);
  });

  it('non-material fields never raise a confirmation request', () => {
    expect(MATERIAL_FIELDS.has('favicon_url')).toBe(false);
    expect(isMaterialConflict('favicon_url', 'a.png', 'b.png')).toBe(false);
  });

  it('material fields with genuinely different values do prompt', () => {
    expect(isMaterialConflict('ceo', 'Person A', 'Person B')).toBe(true);
    expect(isMaterialConflict('headquarters', 'Chennai', 'Bengaluru')).toBe(true);
  });
});

describe('CPG-001 source authority + honest provider reality', () => {
  it("promotes the company's own domain to Tier 1 relationally", () => {
    expect(classifySource(`https://${DOMAIN}/about`, 'company_website', DOMAIN).tier).toBe(1);
    expect(classifySource('https://inc42.com/x', 'editorial', DOMAIN).tier).toBe(3);
    expect(classifySource('https://linkedin.com/company/x', 'business_intelligence', DOMAIN).tier).toBe(2);
    expect(classifySource('https://en.wikipedia.org/wiki/x', 'aggregator', DOMAIN).tier).toBe(4);
  });

  it('treats an unknown host as secondary rather than trusted', () => {
    expect(classifySource('https://random-blog.example/x', 'editorial', DOMAIN).tier).toBe(4);
  });

  it('normalizes domains for comparison', () => {
    expect(normalizeDomain('https://www.Example.com/path')).toBe('example.com');
    expect(normalizeDomain(null)).toBeNull();
  });

  it('does not claim retrieval capability it lacks', () => {
    // CPG-010 CORRECTION: stale since CPG-006 built keyless discovery.
    expect(PROVIDER_REALITY.generalWebSearch.available).toBe(true);
    expect(PROVIDER_REALITY.mcaRegistry.available).toBe(false);
    expect(PROVIDER_REALITY.linkedinIngestion.available).toBe(false);
    expect(PROVIDER_REALITY.firstPartyCrawl.available).toBe(true);
    expect(PROVIDER_REALITY.vendorAdapters.credentialGated).toBe(true);
  });
});

// ── (17,18) tenant isolation + authorization ────────────────────────────────
import {
  assertCanRead, assertCanWrite, filterReadable, applyUserDecisionGuarded,
  TenantIsolationError, AuthorizationError, type AccessContext,
} from '../../services/companyProfile/grounding/groundingAccess';

const ctxFor = (role: 'viewer' | 'editor' | 'admin', companyId = COMPANY): AccessContext => ({
  userId: 'user-1', memberships: [{ companyId, role }],
});

describe('CPG-001 (17) tenant isolation', () => {
  const g = () => R({ userClaim: userClaim('industry', 'Cybersecurity') });

  it('refuses reads for a company the caller does not belong to', () => {
    expect(() => assertCanRead(ctxFor('admin', 'other-company'), COMPANY)).toThrow(TenantIsolationError);
  });

  it('refuses writes across tenants even for an admin of another company', () => {
    expect(() => applyUserDecisionGuarded(ctxFor('admin', 'other-company'), g(), { kind: 'confirm_own' }, ASOF))
      .toThrow(TenantIsolationError);
  });

  it('drops foreign rows from a batch read instead of leaking their existence', () => {
    const mine = g();
    const theirs = { ...g(), companyId: 'other-company' };
    const visible = filterReadable(ctxFor('viewer'), [mine, theirs]);
    expect(visible).toHaveLength(1);
    expect(visible[0].companyId).toBe(COMPANY);
  });
});

describe('CPG-001 (18) authorization', () => {
  const conflicted = () => R({
    field: 'revenue', userClaim: userClaim('revenue', '₹10 Cr+ revenue'),
    evidence: [evidence({ claimId: 'e1', field: 'revenue', value: '₹7.8 Cr FY24 revenue' })],
  });

  it('a viewer may read but may NOT resolve a conflict', () => {
    expect(assertCanRead(ctxFor('viewer'), COMPANY)).toBe('viewer');
    expect(() => assertCanWrite(ctxFor('viewer'), COMPANY)).toThrow(AuthorizationError);
    expect(() => applyUserDecisionGuarded(ctxFor('viewer'), conflicted(), { kind: 'confirm_own' }, ASOF))
      .toThrow(AuthorizationError);
  });

  it('an editor may resolve a conflict', () => {
    const out = applyUserDecisionGuarded(ctxFor('editor'), conflicted(), { kind: 'confirm_own' }, ASOF);
    expect(out.confirmationStatus).toBe('USER_CONFIRMED_OWN_VALUE');
  });

  it('pins the actor to the authenticated user, so attribution cannot be spoofed', () => {
    const out = applyUserDecisionGuarded(ctxFor('admin'), conflicted(), { kind: 'confirm_own' }, ASOF);
    expect(out.history[out.history.length - 1].actor).toBe('user-1');
  });
});
