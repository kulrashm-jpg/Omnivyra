/**
 * PI-SCORE-PROVENANCE-001 — the persistence contract.
 *
 * These tests exist to hold three lines that are easy to cross by accident:
 * the record must COPY the evaluator's output rather than recompute it, an
 * unchanged evaluation must not accumulate history, and an abstention must not
 * become a zero on its way into the database.
 */

import { toScoreEvaluationRecord } from '../../services/leadUnderstanding/persistence';
import { evaluationInputDigest } from '../../services/leadUnderstanding/scoreEvaluationStore';
import { SCORING_RULES_VERSION } from '../../services/intelligence/canonical/scoring';
import type { LeadUnderstanding } from '../../services/leadUnderstanding/types';

const dim = (dimension: string, value: number | null, abstained = false) => ({
  dimension, value, confidence: 0.75, method: 'deterministic' as const,
  contributors: abstained ? [] : ['engine'], calibrated: false, abstained,
});

function understanding(overrides: Partial<Record<string, number | null>> = {}): LeadUnderstanding {
  const v = { intent: 0.4, icp: 0.8, urgency: 0.2, opportunity: 0.6, priority: 0.45, ...overrides };
  return {
    key: { companyId: 'org-a', leadKey: 'lead-1' },
    facets: { note: 'facets' } as never,
    score: {
      dimensions: {
        intent: dim('intent', v.intent ?? null, v.intent === null),
        icp: dim('icp', v.icp ?? null, v.icp === null),
        urgency: dim('urgency', v.urgency ?? null, v.urgency === null),
        opportunity: dim('opportunity', v.opportunity ?? null, v.opportunity === null),
        priority: dim('priority', v.priority ?? null, v.priority === null),
      },
      overall: 0.52,
      confidence: 0.66,
    },
    reasoning: [{ claim: 'priority', conclusion: 0.45, because: [{ kind: 'icp_version', ref: 'icp-1:2' }], confidence: 0.66, method: 'deterministic', assumptions: [], unknowns: [] }],
    contradictions: [],
    graph: { nodes: [], edges: [] },
    version: 1,
    builtAt: '2026-09-26T00:00:00.000Z',
  } as unknown as LeadUnderstanding;
}

const SUBJECT = {
  organizationId: 'org-a',
  prospectId: 'prospect-1',
  personId: 'person-1',
  accountId: 'account-1',
  icpId: 'icp-1',
  icpVersion: 2,
  asOf: '2026-09-26T00:00:00.000Z',
  contextGaps: [],
};

const subjectFor = (u: LeadUnderstanding) => ({
  ...SUBJECT,
  rulesVersion: SCORING_RULES_VERSION,
  inputDigest: evaluationInputDigest(u, SUBJECT),
});

describe('PI-SCORE-PROVENANCE-001 — the record copies, it never computes', () => {
  it('stores every dimension exactly as the evaluator emitted it', () => {
    const u = understanding();
    const r = toScoreEvaluationRecord(u, subjectFor(u));
    expect(r.score_intent).toBe(0.4);
    expect(r.score_icp).toBe(0.8);
    expect(r.score_urgency).toBe(0.2);
    expect(r.score_opportunity).toBe(0.6);
    expect(r.score_priority).toBe(0.45);
    expect(r.score_overall).toBe(0.52);
    expect(r.confidence).toBe(0.66);
  });

  it('carries an ABSTENTION through as null — never as 0', () => {
    const u = understanding({ icp: null });
    const r = toScoreEvaluationRecord(u, subjectFor(u));
    expect(r.score_icp).toBeNull();
    // The distinction the whole platform rests on: not knowing is not zero.
    expect(r.score_icp).not.toBe(0);
  });

  it('records the ICP identity and version that produced the icp dimension', () => {
    const u = understanding();
    const r = toScoreEvaluationRecord(u, subjectFor(u));
    expect(r.icp_id).toBe('icp-1');
    expect(r.icp_version).toBe(2);
  });

  it('records the scoring-rules version, not the API version', () => {
    const u = understanding();
    const r = toScoreEvaluationRecord(u, subjectFor(u));
    expect(r.rules_version).toBe(SCORING_RULES_VERSION);
    expect(r.rules_version).not.toBe('ws10.1');
  });

  it('uses the injected asOf as scored_at — it invents no clock', () => {
    const u = understanding();
    const r = toScoreEvaluationRecord(u, subjectFor(u));
    expect(r.scored_at).toBe('2026-09-26T00:00:00.000Z');
  });
});

describe('PI-SCORE-PROVENANCE-001 — idempotency', () => {
  it('identical inputs produce an identical digest', () => {
    const a = evaluationInputDigest(understanding(), SUBJECT);
    const b = evaluationInputDigest(understanding(), SUBJECT);
    expect(a).toBe(b);
  });

  it('a different asOf does NOT change the digest — otherwise every tick is new history', () => {
    const u = understanding();
    const a = evaluationInputDigest(u, SUBJECT);
    const b = evaluationInputDigest(u, { ...SUBJECT, asOf: '2027-01-01T00:00:00.000Z' });
    expect(a).toBe(b);
  });

  it('a changed score DOES change the digest — a real change is new history', () => {
    const a = evaluationInputDigest(understanding(), SUBJECT);
    const b = evaluationInputDigest(understanding({ intent: 0.9 }), SUBJECT);
    expect(a).not.toBe(b);
  });

  it('a new ICP version changes the digest', () => {
    const u = understanding();
    const a = evaluationInputDigest(u, SUBJECT);
    const b = evaluationInputDigest(u, { ...SUBJECT, icpVersion: 3 });
    expect(a).not.toBe(b);
  });

  it('a different tenant changes the digest — identity is part of the evaluation', () => {
    const u = understanding();
    const a = evaluationInputDigest(u, SUBJECT);
    const b = evaluationInputDigest(u, { ...SUBJECT, organizationId: 'org-b' });
    expect(a).not.toBe(b);
  });
});
