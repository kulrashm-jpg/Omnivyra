/**
 * CONVERSATION-INTELLIGENCE-001 Phase B — canonical readiness invariants.
 *
 * Proves the DoD Phase 8 contract for `profileKnowledgeReadiness` (the ONE
 * canonical readiness signal): readiness is derived EXCLUSIVELY from knowledge
 * completeness (value-weighted), is monotonic as knowledge accrues, decreases
 * only on a user correction that removes/lowers a node, is knowledge-VALUE based
 * (not field/message COUNT), and `enoughToProceed` flips true exactly when the
 * high-value core set is satisfied — never before.
 *
 * These assert the evaluator directly (pure functions, no I/O, no AI), separate
 * from companyKnowledgeGraph.test.ts which stays green untouched.
 */
import {
  buildCompanyKnowledgeGraph,
  profileKnowledgeReadiness,
} from '../../services/companyProfile/companyKnowledgeGraph';
import type { CompanyProfile } from '../../services/companyProfile/types';

const base = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  company_id: 'c1',
  ...over,
});

const readiness = (over: Partial<CompanyProfile> = {}) =>
  profileKnowledgeReadiness(buildCompanyKnowledgeGraph(base(over)));

const band = (fields: string[], b: 'High' | 'Medium' | 'Low'): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [f, b]));

describe('Phase B — readiness is MONOTONIC as knowledge accrues', () => {
  test('score never decreases as nodes move unknown → inferred → observed → confirmed', () => {
    // Incrementally establish the same node at rising states; score must be
    // non-decreasing at every step (satisfaction is presence-based, and richer
    // states only add value — never remove it).
    const steps: Array<Partial<CompanyProfile>> = [
      {}, // unknown: nothing established
      { products_services: 'Analytics' }, // present → inferred (low), satisfied
      { products_services: 'Analytics', field_confidence: band(['products_services'], 'High') }, // observed
      {
        products_services: 'Analytics',
        field_confidence: band(['products_services'], 'High'),
        user_locked_fields: ['products_services'],
      }, // confirmed (user)
    ];
    const scores = steps.map((s) => readiness(s).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
    // And it strictly rose from empty once the node was established.
    expect(scores[scores.length - 1]).toBeGreaterThan(scores[0]);
  });

  test('adding successive DISTINCT nodes never lowers the score', () => {
    const additions = [
      { name: 'Acme' },
      { name: 'Acme', website_url: 'acme.com' },
      { name: 'Acme', website_url: 'acme.com', industry: 'Software' },
      { name: 'Acme', website_url: 'acme.com', industry: 'Software', products_services: 'Analytics' },
      {
        name: 'Acme', website_url: 'acme.com', industry: 'Software',
        products_services: 'Analytics', target_audience: 'Retail', unique_value: 'Real-time',
      },
    ];
    const scores = additions.map((a) => readiness(a).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
    expect(scores[scores.length - 1]).toBeGreaterThan(scores[0]);
  });

  test('score decreases ONLY when a user correction removes a node value', () => {
    // Establish a node, then a user correction clears the wrong value → the node
    // becomes unknown → readiness falls. This is the sole permitted decrease.
    const withValue = readiness({ unique_value: 'Cheaper than rivals', field_confidence: band(['unique_value'], 'High') });
    const corrected = readiness({ unique_value: '', field_confidence: {} }); // user removed the wrong claim
    expect(corrected.score).toBeLessThan(withValue.score);
  });
});

describe('Phase B — readiness is KNOWLEDGE-VALUE based, not field/message COUNT', () => {
  test('same field COUNT, different knowledge VALUE → different readiness', () => {
    // Both profiles carry exactly ONE satisfied node, but of different value.
    const highValue = readiness({ name: 'Acme', field_confidence: band(['name'], 'High') }); // company, value 100
    const lowValue = readiness({
      report_settings: { company_facts: { team_size: '50' } } as CompanyProfile['report_settings'],
    }); // team, value 40
    expect(highValue.satisfiedCount).toBe(1);
    expect(lowValue.satisfiedCount).toBe(1);
    expect(highValue.score).toBeGreaterThan(lowValue.score); // count equal, value differs
  });

  test('adding a LOW-value field moves the score less than a HIGH-value field', () => {
    const empty = readiness().score;
    const afterLow = readiness({
      report_settings: { company_facts: { team_size: '50' } } as CompanyProfile['report_settings'],
    }).score; // team (40)
    const afterHigh = readiness({ name: 'Acme' }).score; // company (100)
    expect(afterLow - empty).toBeGreaterThan(0);
    expect(afterHigh - empty).toBeGreaterThan(afterLow - empty);
  });
});

describe('Phase B — enoughToProceed flips exactly at the core set', () => {
  const CORE = ['name', 'website_url', 'industry', 'products_services', 'target_audience', 'unique_value'];

  test('false until every core node is satisfied', () => {
    // Satisfy all core nodes except one → still not enough.
    const missingOne = base({
      name: 'Acme', website_url: 'acme.com', industry: 'Software',
      products_services: 'Analytics', target_audience: 'Retail',
      // unique_value intentionally absent
      field_confidence: band(CORE.filter((f) => f !== 'unique_value'), 'High'),
    });
    expect(profileKnowledgeReadiness(buildCompanyKnowledgeGraph(missingOne)).enoughToProceed).toBe(false);
  });

  test('true exactly once the final core node is satisfied', () => {
    const complete = base({
      name: 'Acme', website_url: 'acme.com', industry: 'Software',
      products_services: 'Analytics', target_audience: 'Retail', unique_value: 'Real-time',
      field_confidence: band(CORE, 'High'),
    });
    expect(profileKnowledgeReadiness(buildCompanyKnowledgeGraph(complete)).enoughToProceed).toBe(true);
  });

  test('satisfying only NON-core nodes never flips enoughToProceed true', () => {
    const nonCoreOnly = base({
      brand_voice: 'Confident', geography: 'US', content_themes: 'Retail',
      report_settings: { company_facts: { team_size: '50' } } as CompanyProfile['report_settings'],
      field_confidence: band(['brand_voice', 'geography', 'content_themes'], 'High'),
    });
    const r = profileKnowledgeReadiness(buildCompanyKnowledgeGraph(nonCoreOnly));
    expect(r.satisfiedCount).toBeGreaterThan(0); // knowledge WAS added
    expect(r.enoughToProceed).toBe(false); // but not the core → not enough
  });
});
