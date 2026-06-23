/**
 * Phase 13G — Customer Action Playbook tests (pure, deterministic).
 */

import {
  evaluateSuppression,
  generateCompanyPlaybooks,
  generatePortfolioPlaybooks,
  PLAYBOOK_CATALOG,
  type PlaybookCompanyInput,
  type PlaybookDef,
} from '../../services/customerActionPlaybookService';
import type { ReadinessArea, ReadinessState } from '../../services/customerReadinessService';
import type { ConfidenceLevel } from '../../services/customerSignalConfidenceService';

const ALL_AREAS: ReadinessArea[] = ['COMPANY_PROFILE', 'WEBSITE', 'GOOGLE_ANALYTICS', 'GOOGLE_SEARCH_CONSOLE', 'SOCIAL_INTEGRATIONS', 'COMMUNITY', 'TEAM_MEMBERS', 'BILLING'];
const rec = <T>(v: T): Record<ReadinessArea, T> => Object.fromEntries(ALL_AREAS.map((a) => [a, v])) as Record<ReadinessArea, T>;

const input = (over: Partial<PlaybookCompanyInput> & { areas?: Partial<Record<ReadinessArea, ReadinessState>>; signal_confidence?: Partial<Record<ReadinessArea, ConfidenceLevel>> } = {}): PlaybookCompanyInput => ({
  company_id: 'co_1', company_name: 'Acme', priority_tier: 'CRITICAL', priority_score: 80,
  areas: { ...rec<ReadinessState>('NOT_READY'), ...(over.areas ?? {}) },
  signal_confidence: { ...rec<ConfidenceLevel>('HIGH'), ...(over.signal_confidence ?? {}) },
  outcome_classification: 'IMPROVED', acquisition_evidence_complete: true,
  ...over,
});

const VERIFY = PLAYBOOK_CATALOG.find((p) => p.playbook_id === 'VERIFY_DOMAIN')!;

describe('generateCompanyPlaybooks — generation', () => {
  it('generates playbooks for NOT_READY areas with trustworthy signals', () => {
    const { recommended } = generateCompanyPlaybooks(input({ signal_confidence: rec<ConfidenceLevel>('HIGH') }));
    expect(recommended.length).toBe(3); // top 3 cap
    expect(recommended[0].confidence).toBe('HIGH');
    expect(recommended.every((p) => p.area !== 'COMMUNITY')).toBe(true);
  });
  it('no playbook for a READY area (not a suppression)', () => {
    const { recommended, suppressed } = generateCompanyPlaybooks(input({ areas: { ...rec<ReadinessState>('READY') } }));
    expect(recommended).toHaveLength(0);
    expect(suppressed).toHaveLength(0);
  });
});

describe('suppression rules', () => {
  it('LOW signal confidence → SIGNAL_LOW_CONFIDENCE', () => {
    expect(evaluateSuppression(VERIFY, input({ signal_confidence: { WEBSITE: 'LOW' } }))).toBe('SIGNAL_LOW_CONFIDENCE');
  });
  it('UNKNOWN signal confidence → SIGNAL_UNKNOWN_CONFIDENCE', () => {
    expect(evaluateSuppression(VERIFY, input({ signal_confidence: { WEBSITE: 'UNKNOWN' } }))).toBe('SIGNAL_UNKNOWN_CONFIDENCE');
  });
  it('UNKNOWN area state → GAP_UNCERTAIN', () => {
    expect(evaluateSuppression(VERIFY, input({ areas: { WEBSITE: 'UNKNOWN' } }))).toBe('GAP_UNCERTAIN');
  });
  it('required signal missing → REQUIRED_SIGNAL_MISSING', () => {
    const pb: PlaybookDef = { ...VERIFY, required_signals: ['COMPANY_PROFILE'] };
    expect(evaluateSuppression(pb, input({ signal_confidence: { WEBSITE: 'HIGH', COMPANY_PROFILE: 'UNKNOWN' } }))).toBe('REQUIRED_SIGNAL_MISSING');
  });
  it('outcome-dependent playbook + NO_HISTORY → INSUFFICIENT_OUTCOME_HISTORY', () => {
    const pb: PlaybookDef = { ...VERIFY, requires_outcome: true };
    expect(evaluateSuppression(pb, input({ outcome_classification: 'NO_HISTORY' }))).toBe('INSUFFICIENT_OUTCOME_HISTORY');
  });
  it('acquisition-dependent playbook + incomplete evidence → ACQUISITION_EVIDENCE_INCOMPLETE', () => {
    const pb: PlaybookDef = { ...VERIFY, requires_acquisition_evidence: true };
    expect(evaluateSuppression(pb, input({ acquisition_evidence_complete: false }))).toBe('ACQUISITION_EVIDENCE_INCOMPLETE');
  });
  it('trustworthy gap → not suppressed (null)', () => {
    expect(evaluateSuppression(VERIFY, input())).toBeNull();
  });
  it('stale-signal areas are suppressed, healthy ones recommended (mixed company)', () => {
    const { recommended, suppressed } = generateCompanyPlaybooks(input({
      signal_confidence: { WEBSITE: 'HIGH', COMPANY_PROFILE: 'LOW', TEAM_MEMBERS: 'LOW', GOOGLE_ANALYTICS: 'MEDIUM', GOOGLE_SEARCH_CONSOLE: 'MEDIUM', SOCIAL_INTEGRATIONS: 'MEDIUM', BILLING: 'MEDIUM' },
    }));
    expect(suppressed.map((s) => s.playbook_id)).toEqual(expect.arrayContaining(['COMPLETE_PROFILE', 'INVITE_TEAM']));
    expect(recommended.map((r) => r.playbook_id)).toContain('VERIFY_DOMAIN');
  });
});

describe('prioritization', () => {
  it('ranks by priority, then confidence, then expected value; caps at 3', () => {
    const { recommended } = generateCompanyPlaybooks(input({ priority_tier: 'CRITICAL', signal_confidence: { WEBSITE: 'HIGH', COMPANY_PROFILE: 'HIGH', BILLING: 'HIGH', GOOGLE_ANALYTICS: 'MEDIUM', GOOGLE_SEARCH_CONSOLE: 'MEDIUM', SOCIAL_INTEGRATIONS: 'MEDIUM', TEAM_MEMBERS: 'MEDIUM' } }));
    expect(recommended).toHaveLength(3);
    // HIGH-impact HIGH-confidence playbooks rank first
    expect(['VERIFY_DOMAIN', 'COMPLETE_PROFILE', 'ACTIVATE_BILLING']).toEqual(expect.arrayContaining([recommended[0].playbook_id]));
    expect(recommended[0].expected_value).toBeGreaterThanOrEqual(recommended[2].expected_value);
  });
});

describe('portfolio + determinism', () => {
  const inputs = [
    input({ company_id: 'a', company_name: 'Alpha', priority_tier: 'CRITICAL' }),
    input({ company_id: 'b', company_name: 'Beta', priority_tier: 'MEDIUM', signal_confidence: { WEBSITE: 'LOW' } }),
  ];
  it('aggregates portfolio metrics', () => {
    const r = generatePortfolioPlaybooks(inputs);
    expect(r.portfolio.total_recommended).toBeGreaterThan(0);
    expect(r.portfolio.most_common_playbooks.length).toBeGreaterThan(0);
    expect(r.portfolio.top_recommendations.length).toBeLessThanOrEqual(20);
    expect(r.portfolio.suppressed_by_reason.SIGNAL_LOW_CONFIDENCE).toBeGreaterThanOrEqual(1); // Beta WEBSITE LOW
    expect(r.portfolio.confidence_distribution.HIGH).toBeGreaterThan(0);
  });
  it('top recommendations ordered by priority (CRITICAL first)', () => {
    const r = generatePortfolioPlaybooks(inputs);
    expect(r.portfolio.top_recommendations[0].priority).toBe('CRITICAL');
  });
  it('identical inputs → identical output', () => {
    expect(JSON.stringify(generatePortfolioPlaybooks(inputs))).toBe(JSON.stringify(generatePortfolioPlaybooks(inputs)));
  });
});
