/**
 * Company Knowledge Graph — the canonical profile conversation engine.
 * Covers Phase 9: repeated answers, equivalent wording, corrections, partial
 * answers, website-derived info, persisted profile, no-duplicate-questions,
 * no-infinite-loops, completion, confidence transitions, knowledge readiness.
 */
import {
  buildCompanyKnowledgeGraph,
  selectNextProfileQuestion,
  resolveQuestionNode,
  isQuestionEligible,
  profileKnowledgeReadiness,
  buildKnowledgeGrounding,
  KNOWLEDGE_NODES,
} from '../../services/companyProfile/companyKnowledgeGraph';
import type { CompanyProfile } from '../../services/companyProfile/types';

const base = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  company_id: 'c1',
  ...over,
});

const highConf = (fields: string[]): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [f, 'High']));

describe('CompanyKnowledgeGraph — build + state', () => {
  test('empty profile → all nodes unknown, nothing satisfied', () => {
    const g = buildCompanyKnowledgeGraph(base());
    expect(g.nodes.every((n) => n.state === 'unknown' && !n.satisfied)).toBe(true);
  });

  test('a populated High-confidence field is satisfied and observed', () => {
    const g = buildCompanyKnowledgeGraph(base({ products_services: 'Retail analytics dashboards', field_confidence: highConf(['products_services']) }));
    expect(g.byId.products_services.satisfied).toBe(true);
    expect(g.byId.products_services.state).toBe('observed');
    expect(g.byId.products_services.confidence).toBe('high');
  });

  test('a user-locked field is CONFIRMED (user source)', () => {
    const g = buildCompanyKnowledgeGraph(base({ target_audience: 'Retail chains', user_locked_fields: ['target_audience'], field_confidence: { target_audience: 'Low' } }));
    expect(g.byId.target_audience.state).toBe('confirmed');
    expect(g.byId.target_audience.source).toBe('user');
    expect(g.byId.target_audience.satisfied).toBe(true); // locked value counts
  });

  test('list columns and report_settings.team_size resolve', () => {
    const g = buildCompanyKnowledgeGraph(base({
      products_services_list: ['A', 'B'], field_confidence: { products_services: 'Medium' },
      report_settings: { company_facts: { team_size: '50-100' } } as CompanyProfile['report_settings'],
    }));
    expect(g.byId.products_services.resolvedValue).toBe('A, B');
    expect(g.byId.team.resolvedValue).toBe('50-100');
  });
});

describe('Question governance — highest-value, never repeats', () => {
  test('selects the highest-value unknown', () => {
    const g = buildCompanyKnowledgeGraph(base());
    const q = selectNextProfileQuestion(g);
    expect(q?.nodeId).toBe('company'); // value 100 is highest
  });

  test('never re-asks a satisfied node (repeated answers)', () => {
    const g = buildCompanyKnowledgeGraph(base({
      name: 'Acme', website_url: 'acme.com', industry: 'Software', products_services: 'Analytics',
      field_confidence: highConf(['name', 'website_url', 'industry', 'products_services']),
    }));
    // Ask repeatedly; a satisfied node must never be returned.
    for (let i = 0; i < 20; i++) {
      const q = selectNextProfileQuestion(g);
      if (!q) break;
      expect(['company', 'website', 'industry', 'products_services']).not.toContain(q.nodeId);
    }
  });

  test('no infinite loop: once all nodes satisfied, selection returns null', () => {
    const allFields = ['name', 'website_url', 'industry', 'products_services', 'target_audience',
      'ideal_customer_profile', 'unique_value', 'brand_positioning', 'brand_voice', 'geography',
      'competitors', 'pricing_model', 'goals', 'content_themes', 'linkedin_url', 'team_size',
      'core_problem_statement', 'desired_transformation'];
    const g = buildCompanyKnowledgeGraph(base({
      name: 'Acme', website_url: 'acme.com', industry: 'Software', products_services: 'Analytics',
      target_audience: 'Retail', ideal_customer_profile: 'Mid-market retail', unique_value: 'Real-time',
      brand_positioning: 'Leader', brand_voice: 'Confident', geography: 'US', competitors: 'X',
      pricing_model: 'SaaS', goals: 'Grow', content_themes: 'Retail', linkedin_url: 'x',
      core_problem_statement: 'Blind spots', desired_transformation: 'Clarity',
      report_settings: { company_facts: { team_size: '50' } } as CompanyProfile['report_settings'],
      field_confidence: highConf(allFields),
    }));
    expect(selectNextProfileQuestion(g)).toBeNull();
  });

  test('session-asked nodes are de-prioritized so the conversation advances', () => {
    const g = buildCompanyKnowledgeGraph(base());
    const q = selectNextProfileQuestion(g, { sessionAsked: ['company'] });
    expect(q?.nodeId).not.toBe('company'); // advance past the just-asked gap
    expect(q?.nodeId).toBe('website'); // next highest
  });
});

describe('Semantic deduplication — equivalent wording', () => {
  test('different phrasings resolve to the same node', () => {
    expect(resolveQuestionNode('What do you sell?')).toBe('products_services');
    expect(resolveQuestionNode('What products do you offer?')).toBe('products_services');
    expect(resolveQuestionNode('What does your company do?')).toBe('products_services');
    expect(resolveQuestionNode('What services do you provide?')).toBe('products_services');
  });

  test('once a node is satisfied, every equivalent question is ineligible', () => {
    const g = buildCompanyKnowledgeGraph(base({ products_services: 'Analytics', field_confidence: highConf(['products_services']) }));
    expect(isQuestionEligible(g, 'What do you sell?')).toBe(false);
    expect(isQuestionEligible(g, 'What services do you provide?')).toBe(false);
    expect(isQuestionEligible(g, 'What does your company do?')).toBe(false);
  });

  test('an unsatisfied node keeps its questions eligible', () => {
    const g = buildCompanyKnowledgeGraph(base());
    expect(isQuestionEligible(g, 'Who are your customers?')).toBe(true);
  });

  test('unrecognized questions are not blocked', () => {
    const g = buildCompanyKnowledgeGraph(base());
    expect(isQuestionEligible(g, 'Tell me a joke')).toBe(true);
  });
});

describe('Confidence transitions + corrections', () => {
  test('Low-confidence value is inferred; High is observed; locked is confirmed', () => {
    const low = buildCompanyKnowledgeGraph(base({ unique_value: 'Fast', field_confidence: { unique_value: 'Low' } }));
    expect(low.byId.unique_value.state).toBe('inferred');
    const high = buildCompanyKnowledgeGraph(base({ unique_value: 'Fast', field_confidence: { unique_value: 'High' } }));
    expect(high.byId.unique_value.state).toBe('observed');
    const locked = buildCompanyKnowledgeGraph(base({ unique_value: 'Fast', user_locked_fields: ['unique_value'], field_confidence: { unique_value: 'Low' } }));
    expect(locked.byId.unique_value.state).toBe('confirmed');
  });
});

describe('Readiness — knowledge completeness, not question count', () => {
  test('one answer can satisfy a node and raise readiness by that node value', () => {
    const before = profileKnowledgeReadiness(buildCompanyKnowledgeGraph(base()));
    const after = profileKnowledgeReadiness(buildCompanyKnowledgeGraph(base({ name: 'Acme', field_confidence: highConf(['name']) })));
    expect(after.score).toBeGreaterThan(before.score);
    expect(after.satisfiedCount).toBe(before.satisfiedCount + 1);
  });

  test('enoughToProceed flips true once the core nodes are satisfied (stop interviewing)', () => {
    const core = ['name', 'website_url', 'industry', 'products_services', 'target_audience', 'unique_value'];
    const g = buildCompanyKnowledgeGraph(base({
      name: 'Acme', website_url: 'acme.com', industry: 'Software', products_services: 'Analytics',
      target_audience: 'Retail', unique_value: 'Real-time', field_confidence: highConf(core),
    }));
    const r = profileKnowledgeReadiness(g);
    expect(r.enoughToProceed).toBe(true);
    expect(r.remainingGaps).not.toContain('products_services');
  });

  test('remaining gaps are ordered highest-value first', () => {
    const r = profileKnowledgeReadiness(buildCompanyKnowledgeGraph(base()));
    expect(r.remainingGaps[0]).toBe('company'); // value 100
  });
});

describe('Grounding block — the single what-is-known + what-to-ask-next source', () => {
  test('lists known nodes and returns the next gap', () => {
    const g = buildCompanyKnowledgeGraph(base({ name: 'Acme', products_services: 'Analytics', field_confidence: highConf(['name', 'products_services']) }));
    const ground = buildKnowledgeGrounding(g);
    expect(ground.known).toContain('Company name: Acme');
    expect(ground.known).toContain('Products & services: Analytics');
    expect(ground.nextQuestion).not.toBeNull();
    // never proposes a satisfied node
    expect(['company', 'products_services']).not.toContain(ground.nextQuestion?.nodeId);
  });
});

describe('Registry integrity', () => {
  test('node ids are unique and every node has a question + equivalents', () => {
    const ids = KNOWLEDGE_NODES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(KNOWLEDGE_NODES.every((n) => n.question && n.equivalents.length > 0)).toBe(true);
  });
});
