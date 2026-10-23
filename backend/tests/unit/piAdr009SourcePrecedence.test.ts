/**
 * PI-ADR-009 — source precedence.
 *
 * The owner declined the BROAD rule (Sales Navigator authoritative for LinkedIn
 * identity, person identity, current company, current title and seniority) and
 * approved a NARROW one (current title and current company only). Both halves
 * are asserted here, because a test that only proved Sales Navigator sometimes
 * wins would pass equally against the rule that was rejected.
 */

import {
  selectCanonicalObservation, selectCanonicalObservations,
  isAuthoritativeAttribute, isAuthoritativeSource,
  AUTHORITATIVE_ATTRIBUTES, type SourceObservation,
} from '../../services/prospectIdentity/sourcePrecedence';

const obs = (
  source: string, attribute: string, value: unknown,
  observedAt: string | null, confidence: number | null = null,
): SourceObservation => ({ source, attribute, value, observedAt, confidence });

const SN = 'salesnav-sim';
const T_OLD = '2026-09-05T09:00:00.000Z';
const T_NEW = '2026-09-08T09:00:00.000Z';

// ───────────────────────────────────────────────────────────────────────────
describe('PI-ADR-009 — RULE 1: Sales Navigator wins its two fields, and only those', () => {
  it('the authoritative set is exactly current title and current company', () => {
    expect([...AUTHORITATIVE_ATTRIBUTES].sort()).toEqual(['company', 'job_title']);
    expect(isAuthoritativeAttribute('job_title')).toBe(true);
    expect(isAuthoritativeAttribute('company')).toBe(true);
    // The fields the owner explicitly declined to make authoritative.
    expect(isAuthoritativeAttribute('seniority')).toBe(false);
    expect(isAuthoritativeAttribute('email')).toBe(false);
    expect(isAuthoritativeAttribute('phone')).toBe(false);
  });

  it('wins job_title even when it is the OLDEST observation', () => {
    const v = selectCanonicalObservation([
      obs(SN, 'job_title', 'VP Marketing', T_OLD, 0.9),
      obs('apollo-sim', 'job_title', 'Marketing Manager', T_NEW, 0.6),
      obs('zoominfo-sim', 'job_title', 'Head of Marketing', T_NEW, 0.55),
    ], 'job_title');

    expect(v.selected?.value).toBe('VP Marketing');
    expect(v.rule).toBe('authoritative_source');
    expect(v.conflicted).toBe(true);
    // Without RULE 1 recency would have chosen a vendor value — that is the
    // whole reason an authority rule exists rather than a recency rule alone.
    expect(v.selected?.observedAt).toBe(T_OLD);
  });

  it('wins current company on the same basis', () => {
    const v = selectCanonicalObservation([
      obs('apollo-sim', 'company', 'Acme Corporation', T_NEW, 0.8),
      obs(SN, 'company', 'Acme', T_OLD, 0.9),
    ], 'company');
    expect(v.selected?.value).toBe('Acme');
    expect(v.rule).toBe('authoritative_source');
  });

  it('does NOT win seniority — the declined half of the broad rule', () => {
    const v = selectCanonicalObservation([
      obs(SN, 'seniority', 'director', T_OLD, 0.9),
      obs('apollo-sim', 'seniority', 'head', T_NEW, 0.4),
    ], 'seniority');
    // Recency decides, so the vendor's newer and LESS confident value wins.
    expect(v.selected?.value).toBe('head');
    expect(v.rule).toBe('most_recent');
  });

  it('does NOT win email — a field it never supplies', () => {
    const v = selectCanonicalObservation([
      obs('apollo-sim', 'email', 'jane@acme.example', T_NEW, 0.9),
    ], 'email');
    expect(v.selected?.value).toBe('jane@acme.example');
    expect(v.rule).toBe('sole_observation');
  });

  it('two Sales Navigator snapshots: the newer snapshot is current, authority intact', () => {
    const v = selectCanonicalObservation([
      obs(SN, 'job_title', 'VP Marketing', T_OLD, 0.9),
      obs(SN, 'job_title', 'SVP Marketing', T_NEW, 0.9),
      obs('apollo-sim', 'job_title', 'Marketing Manager', T_NEW, 0.99),
    ], 'job_title');
    expect(v.selected?.value).toBe('SVP Marketing');
    expect(v.rule).toBe('authoritative_source');
  });

  it('recognises the real and simulated Sales Navigator keys identically', () => {
    for (const k of ['salesnav', 'salesnav-sim', 'linkedin_sales_navigator']) {
      expect(isAuthoritativeSource(k)).toBe(true);
    }
    for (const k of ['apollo-sim', 'marketpulse-person-sim', 'csv', 'crm']) {
      expect(isAuthoritativeSource(k)).toBe(false);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-ADR-009 — ABSENCE IS NOT AUTHORITY', () => {
  it('a silent Sales Navigator does not win by default', () => {
    const v = selectCanonicalObservation([
      obs(SN, 'job_title', null, T_NEW, 0.9),
      obs('apollo-sim', 'job_title', 'Marketing Manager', T_OLD, 0.6),
    ], 'job_title');
    // Falls through to RULE 2, where the only real claim is the vendor's.
    expect(v.selected?.value).toBe('Marketing Manager');
    expect(v.rule).toBe('sole_observation');
  });

  it('a blank string is silence, not a claim', () => {
    const v = selectCanonicalObservation([
      obs(SN, 'company', '   ', T_NEW, 0.9),
      obs('csv', 'company', 'Acme', T_OLD, 0.5),
    ], 'company');
    expect(v.selected?.value).toBe('Acme');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-ADR-009 — RULE 2: recency, then confidence', () => {
  it('most recent wins for a non-authoritative field', () => {
    const v = selectCanonicalObservation([
      obs('apollo-sim', 'phone', '+1-415-555-0101', T_OLD, 0.9),
      obs('rapidapi-sim', 'phone', '+1-415-555-0199', T_NEW, 0.2),
    ], 'phone');
    expect(v.selected?.value).toBe('+1-415-555-0199');
    expect(v.rule).toBe('most_recent');
  });

  it('confidence breaks a recency tie', () => {
    const v = selectCanonicalObservation([
      obs('apollo-sim', 'phone', 'A', T_NEW, 0.4),
      obs('rapidapi-sim', 'phone', 'B', T_NEW, 0.8),
    ], 'phone');
    expect(v.selected?.value).toBe('B');
    expect(v.rule).toBe('higher_confidence');
  });

  it('an unresolved tie is REPORTED, never invented away', () => {
    const v = selectCanonicalObservation([
      obs('apollo-sim', 'phone', 'A', T_NEW, 0.5),
      obs('rapidapi-sim', 'phone', 'B', T_NEW, 0.5),
    ], 'phone');
    expect(v.selected).toBeNull();
    expect(v.rule).toBe('unresolved_tie');
    // And the evidence is still all there to re-decide from.
    expect(v.retained).toHaveLength(2);
  });

  it('an observation with no timestamp loses to one that has a real instant', () => {
    const v = selectCanonicalObservation([
      obs('csv', 'phone', 'A', null, 0.9),
      obs('apollo-sim', 'phone', 'B', T_OLD, 0.1),
    ], 'phone');
    expect(v.selected?.value).toBe('B');
    expect(v.rule).toBe('most_recent');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('PI-ADR-009 — RULE 3: nothing is destroyed', () => {
  const corpus: SourceObservation[] = [
    obs(SN, 'job_title', 'VP Marketing', T_OLD, 0.9),
    obs('apollo-sim', 'job_title', 'Marketing Manager', T_NEW, 0.6),
    obs('zoominfo-sim', 'job_title', 'Head of Marketing', T_NEW, 0.55),
    obs('apollo-sim', 'email', 'jane@acme.example', T_NEW, 0.9),
  ];

  it('every observation survives a selection, winner and losers alike', () => {
    const v = selectCanonicalObservation(corpus, 'job_title');
    expect(v.retained).toHaveLength(3);
    expect(v.retained.map((o) => o.source).sort())
      .toEqual(['apollo-sim', 'salesnav-sim', 'zoominfo-sim']);
    // Provenance survives with the value — a conflict without a source is useless.
    for (const o of v.retained) {
      expect(typeof o.source).toBe('string');
      expect(o.observedAt).toEqual(expect.any(String));
    }
  });

  it('selection is read-time and repeatable — the corpus is not mutated', () => {
    const before = JSON.stringify(corpus);
    selectCanonicalObservation(corpus, 'job_title');
    selectCanonicalObservations(corpus);
    expect(JSON.stringify(corpus)).toBe(before);
  });

  it('a multi-attribute pass reports each field with its own rule', () => {
    const map = selectCanonicalObservations(corpus);
    expect(Object.keys(map).sort()).toEqual(['email', 'job_title']);
    expect(map.job_title.rule).toBe('authoritative_source');
    expect(map.job_title.conflicted).toBe(true);
    expect(map.email.rule).toBe('sole_observation');
    expect(map.email.conflicted).toBe(false);
  });

  it('no observations at all is reported, not defaulted', () => {
    const v = selectCanonicalObservation([], 'job_title');
    expect(v.selected).toBeNull();
    expect(v.rule).toBe('no_observations');
    expect(v.retained).toEqual([]);
  });
});
