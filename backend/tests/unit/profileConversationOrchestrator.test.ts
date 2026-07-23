/**
 * CONVERSATION-INTELLIGENCE-001 Phase C — Profile Conversation Orchestrator.
 *
 * Proves the DoD conversation invariants over the canonical knowledge graph:
 *   - never re-ask known info (a satisfied node is ineligible + never selected)
 *   - semantic dedup (equivalent phrasings resolve to one node; both ineligible)
 *   - advancement (each turn selects a NEW unknown or reports enoughToProceed)
 *   - no infinite loop (with sessionAsked accumulating, it advances/completes)
 *   - resume-from-profile (partial profile ⇒ resumes at next unknown)
 *
 * The orchestrator delegates all logic to companyKnowledgeGraph; these tests
 * assert the COORDINATION contract, not the graph internals (covered in
 * companyKnowledgeGraph.test.ts).
 */
import {
  orchestrateProfileConversation,
  isQuestionEligibleForOrchestration,
  deriveSessionAsked,
} from '../../services/companyProfile/profileConversationOrchestrator';
import { KNOWLEDGE_NODES } from '../../services/companyProfile/companyKnowledgeGraph';
import type { CompanyProfile } from '../../services/companyProfile/types';

const base = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  company_id: 'c1',
  ...over,
});

const highConf = (fields: string[]): Record<string, string> =>
  Object.fromEntries(fields.map((f) => [f, 'High']));

describe('Orchestrator — delegation + basic shape', () => {
  test('empty profile → asks the highest-value unknown, not enough to proceed', () => {
    const d = orchestrateProfileConversation(base(), []);
    expect(d.nextQuestion?.nodeId).toBe('company'); // value 100
    expect(d.enoughToProceed).toBe(false);
    expect(d.complete).toBe(false);
    expect(d.readiness.satisfiedCount).toBe(0);
  });

  test('exposes canonical grounding + readiness (delegated)', () => {
    const d = orchestrateProfileConversation(
      base({ name: 'Acme', field_confidence: highConf(['name']) }),
      [],
    );
    expect(d.grounding.known).toContain('Company name: Acme');
    expect(d.readiness.satisfiedCount).toBe(1);
  });
});

describe('DoD: never re-ask known info', () => {
  test('a node satisfied in the profile is ineligible and never selected', () => {
    const d = orchestrateProfileConversation(
      base({ products_services: 'Analytics', field_confidence: highConf(['products_services']) }),
      [],
    );
    // never selected
    expect(d.nextQuestion?.nodeId).not.toBe('products_services');
    // and ineligible in any phrasing
    expect(isQuestionEligibleForOrchestration(d, 'What do you sell?')).toBe(false);
    expect(isQuestionEligibleForOrchestration(d, 'What does your company do?')).toBe(false);
  });
});

describe('DoD: semantic dedup — equivalent phrasings collapse to one node', () => {
  test('two equivalent phrasings are BOTH permanently ineligible once satisfied', () => {
    // products_services has multiple distinct, non-colliding phrasings in the graph.
    const d = orchestrateProfileConversation(
      base({ products_services: 'Analytics', field_confidence: highConf(['products_services']) }),
      [],
    );
    expect(isQuestionEligibleForOrchestration(d, 'What do you sell?')).toBe(false);
    expect(isQuestionEligibleForOrchestration(d, 'What services do you provide?')).toBe(false);
    expect(isQuestionEligibleForOrchestration(d, 'What does your company do?')).toBe(false);
  });

  test('an unsatisfied node keeps equivalent phrasings eligible', () => {
    const d = orchestrateProfileConversation(base(), []);
    expect(isQuestionEligibleForOrchestration(d, 'What do you sell?')).toBe(true);
    expect(isQuestionEligibleForOrchestration(d, 'What services do you provide?')).toBe(true);
  });
});

describe('DoD: advancement — never returns an already-satisfied question', () => {
  test('deriveSessionAsked resolves interviewer questions to node ids (delegated)', () => {
    const asked = deriveSessionAsked([
      { role: 'assistant', content: 'What is your company called?' },
      { role: 'user', content: 'Acme' }, // an answer — not counted
      { role: 'assistant', content: 'What is your website address?' },
    ]);
    expect(asked).toEqual(['company', 'website']);
  });

  test('a session-asked-but-unanswered node is de-prioritised so it advances', () => {
    const conversation = [{ role: 'assistant', content: 'What is your company called?' }];
    const d = orchestrateProfileConversation(base(), conversation);
    expect(d.sessionAsked).toContain('company');
    expect(d.nextQuestion?.nodeId).not.toBe('company');
    expect(d.nextQuestion?.nodeId).toBe('website'); // next highest
  });
});

// Simulate Phase-D persistence: mark a node satisfied on the profile exactly the
// way buildCompanyKnowledgeGraph resolves it (column value + High confidence band).
// This is a fixture that mirrors how the real profile persists an answer; it is
// NOT orchestrator logic (the orchestrator never writes the profile).
const NODE_COLUMN: Record<string, string> = {
  company: 'name', website: 'website_url', industry: 'industry',
  products_services: 'products_services', target_audience: 'target_audience',
  ideal_customer_profile: 'ideal_customer_profile', unique_value: 'unique_value',
  brand_positioning: 'brand_positioning', brand_voice: 'brand_voice', geography: 'geography',
  competitors: 'competitors', business_model: 'pricing_model', goals: 'goals',
  content_themes: 'content_themes', social: 'linkedin_url', core_problem: 'core_problem_statement',
  desired_transformation: 'desired_transformation',
};
const NODE_CONF_KEY: Record<string, string> = {
  company: 'name', business_model: 'pricing_model', social: 'linkedin_url', team: 'team_size',
};
function satisfyNode(p: CompanyProfile, nodeId: string): CompanyProfile {
  const next = { ...(p as Record<string, unknown>) } as CompanyProfile;
  const fc = { ...(next.field_confidence ?? {}) } as Record<string, string>;
  if (nodeId === 'team') {
    const rs = { ...(next.report_settings ?? {}) } as Record<string, unknown>;
    rs.company_facts = { ...((rs.company_facts as object) ?? {}), team_size: '50-100' };
    next.report_settings = rs as CompanyProfile['report_settings'];
    fc.team_size = 'High';
  } else {
    (next as Record<string, unknown>)[NODE_COLUMN[nodeId]] = `value-${nodeId}`;
    fc[NODE_CONF_KEY[nodeId] ?? NODE_COLUMN[nodeId]] = 'High';
  }
  next.field_confidence = fc;
  return next;
}

describe('DoD: no infinite loop — advances then completes, never re-asks', () => {
  test('progressive population (resume-from-profile) terminates without re-asking any node', () => {
    let profile = base();
    const conversation: Array<{ role: string; content: string }> = [];
    const asked: string[] = [];
    let guard = 0;
    while (guard++ < 40) {
      const d = orchestrateProfileConversation(profile, conversation);
      if (!d.nextQuestion) break; // completed — no eligible unknown remains
      // never re-ask a node already asked in this conversation
      expect(asked).not.toContain(d.nextQuestion.nodeId);
      asked.push(d.nextQuestion.nodeId);
      conversation.push({ role: 'assistant', content: d.nextQuestion.question });
      // Phase-D persists the answer → the node becomes satisfied for the next turn.
      profile = satisfyNode(profile, d.nextQuestion.nodeId);
    }
    // Terminated by COMPLETION (every node satisfied), not by the guard.
    expect(guard).toBeLessThan(40);
    expect(asked[0]).toBe('company'); // walked the highest-value core first
    expect(asked.length).toBe(KNOWLEDGE_NODES.length); // every node asked exactly once
    // Final state: nothing left to ask.
    expect(orchestrateProfileConversation(profile, conversation).complete).toBe(true);
  });

  test('static profile: sessionAsked de-prioritises asked gaps so it advances turn-to-turn', () => {
    // With no persistence, an asked-but-unanswered gap is not re-pressed on the
    // very next turn (the reported bug) — it advances to the next unknown.
    const first = orchestrateProfileConversation(base(), []);
    const q1 = first.nextQuestion!;
    const second = orchestrateProfileConversation(base(), [
      { role: 'assistant', content: q1.question },
    ]);
    expect(second.nextQuestion?.nodeId).not.toBe(q1.nodeId);
  });
});

describe('DoD: resume-from-profile — partial profile resumes at the next unknown', () => {
  test('a partially-populated profile does NOT restart from the first question', () => {
    // Simulate a prior session: identity + offering already captured & persisted.
    const partial = base({
      name: 'Acme',
      website_url: 'acme.com',
      industry: 'Software',
      products_services: 'Analytics',
      field_confidence: highConf(['name', 'website_url', 'industry', 'products_services']),
    });
    const d = orchestrateProfileConversation(partial, []); // fresh session, no conversation
    // does NOT ask company/website/industry/products again
    expect(['company', 'website', 'industry', 'products_services']).not.toContain(d.nextQuestion?.nodeId);
    // resumes at the highest-value remaining unknown — target_audience (value 90)
    expect(d.nextQuestion?.nodeId).toBe('target_audience');
    expect(d.readiness.satisfiedCount).toBe(4);
  });

  test('enoughToProceed flips true once the core is satisfied (stop interviewing)', () => {
    const core = ['name', 'website_url', 'industry', 'products_services', 'target_audience', 'unique_value'];
    const d = orchestrateProfileConversation(
      base({
        name: 'Acme', website_url: 'acme.com', industry: 'Software', products_services: 'Analytics',
        target_audience: 'Retail', unique_value: 'Real-time', field_confidence: highConf(core),
      }),
      [],
    );
    expect(d.enoughToProceed).toBe(true);
    // still not "complete" — optional lower-value gaps remain, but the core is done
    expect(d.complete).toBe(false);
  });

  test('fully-populated profile reports complete (no next question)', () => {
    const allFields = ['name', 'website_url', 'industry', 'products_services', 'target_audience',
      'ideal_customer_profile', 'unique_value', 'brand_positioning', 'brand_voice', 'geography',
      'competitors', 'pricing_model', 'goals', 'content_themes', 'linkedin_url', 'team_size',
      'core_problem_statement', 'desired_transformation'];
    const d = orchestrateProfileConversation(
      base({
        name: 'Acme', website_url: 'acme.com', industry: 'Software', products_services: 'Analytics',
        target_audience: 'Retail', ideal_customer_profile: 'Mid-market retail', unique_value: 'Real-time',
        brand_positioning: 'Leader', brand_voice: 'Confident', geography: 'US', competitors: 'X',
        pricing_model: 'SaaS', goals: 'Grow', content_themes: 'Retail', linkedin_url: 'x',
        core_problem_statement: 'Blind spots', desired_transformation: 'Clarity',
        report_settings: { company_facts: { team_size: '50' } } as CompanyProfile['report_settings'],
        field_confidence: highConf(allFields),
      }),
      [],
    );
    expect(d.complete).toBe(true);
    expect(d.nextQuestion).toBeNull();
    expect(d.enoughToProceed).toBe(true);
  });
});
