/**
 * CONTACT-INTELLIGENCE-PROGRAM-009 / Phase 3 — internal shadow runtime.
 *
 * Four properties are asserted independently, because a suite that could only detect all four at once
 * would not tell you which one broke:
 *
 *   FLAG      — dark by default, and dark means "did no work", not "did work and hid it"
 *   PARITY    — the arithmetic itself, exercised at 1.0, 0.0 and a partial value
 *   COMPARISON— which fields are compared and what each side reads
 *   PROJECTION— the bundle's projection is the assembled one, not a re-derivation
 *   ABSTENTION— an empty input still yields a valid, wholly-abstaining bundle
 *
 * Every test sets the flag explicitly and restores the environment, so no test depends on another's
 * leftovers.
 */

import {
  computeContactUnderstandingShadow,
  compareToRaw,
  assembleContactUnderstanding,
  projectContact,
  CONTACT_SCORE_DIMENSIONS,
  type ContactEvidenceInput,
} from '../../services/contactIntelligence';

const ASOF = '2026-08-08T00:00:00.000Z';
const SEEN = '2026-08-01T00:00:00.000Z';

const base = (over: Partial<ContactEvidenceInput> = {}): ContactEvidenceInput => ({
  companyId: 'co-1', contactId: 'ct-1', asOf: ASOF, source: 'contact_capture', ...over,
});

/** Every raw field populated ⇒ the pipeline should carry all seven through. */
const full = (): ContactEvidenceInput => base({
  unifiedPersonId: 'up-1',
  identity: { platform: 'x', platformUserId: '12345', handle: '@alice', contactKey: 'x:12345', observedAt: SEEN },
  profile: { displayName: 'Alice', profileUrl: 'https://x.com/alice', observedAt: SEEN },
  channels: [{ channel: 'dm', verified: true, observedAt: SEEN }],
  interactions: [{ threadRef: 't1', observedAt: SEEN }],
});

const savedEnv = { ...process.env };
const enable = () => { process.env.CONTACT_UNDERSTANDING_ENABLED = 'true'; };
afterEach(() => { process.env = { ...savedEnv }; });

describe('Contact shadow runtime — flag guard', () => {
  it('returns null when the flag is OFF (default)', () => {
    delete process.env.CONTACT_UNDERSTANDING_ENABLED;
    expect(computeContactUnderstandingShadow(full())).toBeNull();
  });

  it('stays dark for any value that is not exactly "true"', () => {
    for (const v of ['TRUE', '1', 'yes', '']) {
      process.env.CONTACT_UNDERSTANDING_ENABLED = v;
      expect(computeContactUnderstandingShadow(full())).toBeNull();
    }
  });

  it('the guard is the first statement — a dark call does no work at all', () => {
    // If the guard ran after composition, a malformed input would still throw. It must not.
    delete process.env.CONTACT_UNDERSTANDING_ENABLED;
    expect(() => computeContactUnderstandingShadow(null as unknown as ContactEvidenceInput)).not.toThrow();
    expect(computeContactUnderstandingShadow(null as unknown as ContactEvidenceInput)).toBeNull();
  });

  it('returns a full bundle when ON', () => {
    enable();
    const b = computeContactUnderstandingShadow(full())!;
    expect(b).not.toBeNull();
    expect(Object.keys(b).sort()).toEqual(['comparison', 'projection', 'understanding']);
  });
});

describe('Contact shadow runtime — parity arithmetic', () => {
  it('is 1.0 when every raw field survives the pipeline', () => {
    const raw = full();
    const { understanding } = assembleContactUnderstanding(raw);
    const cmp = compareToRaw(understanding, raw);
    expect(cmp.divergences.every((d) => d.agree)).toBe(true);
    expect(cmp.parity).toBe(1);
  });

  it('is 0 when the understanding agrees with nothing it was given', () => {
    // Compare a wholly-abstaining understanding against a fully-populated raw: every pair disagrees.
    const empty = assembleContactUnderstanding(base()).understanding;
    const cmp = compareToRaw(empty, full());
    expect(cmp.divergences.every((d) => !d.agree)).toBe(true);
    expect(cmp.parity).toBe(0);
  });

  it('is the exact agreeing fraction, not a rounded approximation', () => {
    const raw = full();
    // Drop one of the seven compared fields on the raw side only.
    const partial = { ...raw, profile: { ...raw.profile!, displayName: undefined } };
    const { understanding } = assembleContactUnderstanding(raw);
    const cmp = compareToRaw(understanding, partial as ContactEvidenceInput);
    const agree = cmp.divergences.filter((d) => d.agree).length;
    expect(cmp.parity).toBe(Number((agree / cmp.divergences.length).toFixed(4)));
    expect(cmp.parity).toBeLessThan(1);
    expect(cmp.parity).toBeGreaterThan(0);
  });

  it('parity counts ONLY agreeing divergences', () => {
    const raw = full();
    const { understanding } = assembleContactUnderstanding(raw);
    const cmp = compareToRaw(understanding, raw);
    const agree = cmp.divergences.filter((d) => d.agree).length;
    expect(agree).toBe(cmp.divergences.length);
    expect(cmp.parity * cmp.divergences.length).toBeCloseTo(agree, 6);
  });
});

describe('Contact shadow runtime — comparison surface', () => {
  it('compares exactly the seven carried fields', () => {
    const raw = full();
    const cmp = compareToRaw(assembleContactUnderstanding(raw).understanding, raw);
    expect(cmp.divergences.map((d) => d.field)).toEqual([
      'platform', 'platform_user_id', 'contact_key', 'display_name', 'profile_url', 'unified_person_id', 'reachable',
    ]);
  });

  it('detects a dropped identity field', () => {
    const raw = full();
    const withoutIdentity = { ...raw, identity: undefined };
    const cmp = compareToRaw(assembleContactUnderstanding(withoutIdentity).understanding, raw);
    const platform = cmp.divergences.find((d) => d.field === 'platform')!;
    expect(platform.agree).toBe(false);
    expect(platform.canonical).toBeNull();
    expect(platform.legacy).toBe('x');
  });

  it('detects channels lost between input and facet', () => {
    const raw = full();
    const withoutChannels = { ...raw, channels: [] };
    const cmp = compareToRaw(assembleContactUnderstanding(withoutChannels).understanding, raw);
    const reachable = cmp.divergences.find((d) => d.field === 'reachable')!;
    expect(reachable.canonical).toBe(false);
    expect(reachable.legacy).toBe(true);
    expect(reachable.agree).toBe(false);
  });

  it('reports facet, evidence and contradiction counts', () => {
    const raw = full();
    const cmp = compareToRaw(assembleContactUnderstanding(raw).understanding, raw);
    expect(cmp.contactId).toBe('ct-1');
    expect(cmp.facetCount).toBeGreaterThan(0);
    expect(cmp.evidenceCount).toBeGreaterThan(0);
    expect(cmp.contradictionCount).toBe(0);
  });

  it('evidenceCount is DISTINCT ids, not the sum across facets', () => {
    const raw = full();
    const { understanding } = assembleContactUnderstanding(raw);
    const cmp = compareToRaw(understanding, raw);
    const summed = Object.values(understanding.facets).reduce((n, f) => n + f.evidence.length, 0);
    // Evidence is shared between facets, so the distinct count must be strictly smaller.
    expect(cmp.evidenceCount).toBeLessThan(summed);
  });
});

describe('Contact shadow runtime — projection', () => {
  it('the bundle projection equals projecting the bundle understanding', () => {
    enable();
    const b = computeContactUnderstandingShadow(full())!;
    expect(JSON.stringify(b.projection)).toBe(JSON.stringify(projectContact(b.understanding, ASOF)));
  });

  it('the bundle equals the assembled understanding — no drift between the two seams', () => {
    enable();
    const raw = full();
    const b = computeContactUnderstandingShadow(raw)!;
    const a = assembleContactUnderstanding(raw);
    expect(JSON.stringify(b.understanding)).toBe(JSON.stringify(a.understanding));
    expect(JSON.stringify(b.projection)).toBe(JSON.stringify(a.projection));
  });

  it('is clock-independent — every timestamp comes from asOf', () => {
    enable();
    const b = computeContactUnderstandingShadow(full())!;
    expect(b.understanding.builtAt).toBe(ASOF);
    expect(b.projection.projectedAt).toBe(ASOF);
  });

  it('is deterministic across repeated invocations', () => {
    enable();
    const raw = full();
    expect(JSON.stringify(computeContactUnderstandingShadow(raw)))
      .toBe(JSON.stringify(computeContactUnderstandingShadow(raw)));
  });
});

describe('Contact shadow runtime — abstention', () => {
  it('an empty input still yields a valid bundle that abstains everywhere', () => {
    enable();
    const b = computeContactUnderstandingShadow(base())!;
    expect(b).not.toBeNull();
    for (const d of CONTACT_SCORE_DIMENSIONS) expect(b.projection.scores[d]).toBeNull();
    expect(b.projection.unifiedPersonId).toBeNull();
    expect(b.projection.reachable).toBe(false);
    expect(b.projection.channels).toEqual([]);
    expect(b.understanding.graph.edges).toEqual([]);
  });

  it('an empty input scores parity 1.0 against an empty raw — nothing was lost', () => {
    enable();
    const b = computeContactUnderstandingShadow(base())!;
    // Both sides abstain, so every pair agrees. Parity measures pipeline fidelity, not richness.
    expect(b.comparison.parity).toBe(1);
    expect(b.comparison.divergences.every((d) => d.agree)).toBe(true);
  });

  it('abstention is visible in the comparison, not hidden by it', () => {
    enable();
    const b = computeContactUnderstandingShadow(base())!;
    const platform = b.comparison.divergences.find((d) => d.field === 'platform')!;
    expect(platform.canonical).toBeNull();
    expect(platform.legacy).toBeNull();
  });
});

describe('Contact shadow runtime — writes nothing', () => {
  it('exposes no writer, persister or mutator on its public surface', async () => {
    const mod = await import('../../services/contactIntelligence/shadowRuntime');
    const forbidden = Object.keys(mod).filter((k) => /save|write|persist|upsert|insert|update|delete|flush/i.test(k));
    expect(forbidden).toEqual([]);
  });

  it('does not mutate the input it was given', () => {
    enable();
    const raw = full();
    const before = JSON.stringify(raw);
    computeContactUnderstandingShadow(raw);
    expect(JSON.stringify(raw)).toBe(before);
  });
});
