/**
 * CONVERSATION-INTELLIGENCE-001 Phase D — the loop-closed integration proof.
 *
 * End-to-end proof of Phase C's guarantee: a user answer, once extracted and
 * persisted, makes the just-satisfied node's question INELIGIBLE / no longer
 * selected by the orchestrator on the next turn.
 *
 *   extract (real prompt-map + real zod validation, mocked LLM)
 *     → persist (real seam → saveProfile, mocked to merge `input ?? existing`)
 *       → rebuild the REAL knowledge graph from the persisted profile
 *         → the REAL orchestrator no longer re-asks the satisfied node.
 *
 * Only the two I/O seams are mocked (the non-deterministic LLM completion + the
 * DB write). The mapper, the graph, and the orchestrator all run for real, so the
 * loop asserted here is genuine.
 */

jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(),
}));
jest.mock('../../services/companyProfileServiceRest1Rest2Pulse', () => ({
  saveProfile: jest.fn(),
}));

import { runCompletionWithOperation } from '../../services/aiGateway';
import { saveProfile } from '../../services/companyProfileServiceRest1Rest2Pulse';
import { extractAndPersistProfileKnowledge } from '../../services/companyProfile/chatKnowledgeExtraction';
import {
  orchestrateProfileConversation,
  isQuestionEligibleForOrchestration,
} from '../../services/companyProfile/profileConversationOrchestrator';
import type { CompanyProfile } from '../../services/companyProfile/types';

const F = (value: unknown) => ({ value, source: 'inferred', confidence: 'High' as const });

const AUDIENCE_Q = 'Who is your target audience — the customers you serve?';

// Higher-value core already satisfied so the highest-value REMAINING gap is
// target_audience (value 90) — the node this test drives to satisfaction.
const startingProfile: CompanyProfile = {
  company_id: 'acme',
  name: 'Acme',
  website_url: 'acme.com',
  industry: 'Software',
  products_services: 'Retail analytics dashboards',
  field_confidence: { name: 'High', website_url: 'High', industry: 'High', products_services: 'High' },
} as CompanyProfile;

beforeEach(() => {
  jest.clearAllMocks();
  // Faithful in-memory persistence: merge the extracted fields over existing
  // (mirrors saveProfile's `input ?? existing` contract) and return the row.
  (saveProfile as jest.Mock).mockImplementation(async (input) => ({ ...startingProfile, ...input }));
});

describe('Phase D loop-closed — answer → save → graph → orchestrator never re-asks', () => {
  test('the target_audience node becomes satisfied and is no longer selected/eligible', async () => {
    // 1. BEFORE: the orchestrator would ask target_audience next, and the question
    //    is eligible (the node is a genuine gap).
    const before = orchestrateProfileConversation(startingProfile, []);
    expect(before.nextQuestion?.nodeId).toBe('target_audience');
    expect(isQuestionEligibleForOrchestration(before, AUDIENCE_Q)).toBe(true);

    // 2. The user answers the target_audience question; the answer also reveals a
    //    second field (goals) — one message, many fields.
    (runCompletionWithOperation as jest.Mock).mockResolvedValue({
      output: JSON.stringify({
        target_audience: F('Retail operations leaders at mid-market chains'),
        goals: F('Expand into enterprise retail'),
      }),
    });

    const { savedProfile, persisted } = await extractAndPersistProfileKnowledge({
      companyId: 'acme',
      message: 'We serve retail ops leaders at mid-market chains; goal is to expand into enterprise.',
      questionAsked: AUDIENCE_Q,
      profile: startingProfile,
    });

    expect(persisted).toBe(true);
    // persisted through the ONE write seam
    expect(saveProfile as jest.Mock).toHaveBeenCalledTimes(1);
    expect(savedProfile?.target_audience).toBe('Retail operations leaders at mid-market chains');

    // 3. AFTER: rebuild the graph from the PERSISTED profile — the loop is closed.
    const after = orchestrateProfileConversation(savedProfile as CompanyProfile, []);
    // the just-satisfied node is no longer selected …
    expect(after.nextQuestion?.nodeId).not.toBe('target_audience');
    // … and every phrasing of it is now ineligible (never re-asked)
    expect(isQuestionEligibleForOrchestration(after, AUDIENCE_Q)).toBe(false);
    expect(isQuestionEligibleForOrchestration(after, 'Who do you sell to?')).toBe(false);
    // the second field the same answer revealed is satisfied too (nothing discarded)
    expect(after.graph.byId['goals'].satisfied).toBe(true);
    // readiness advanced by knowledge, not by question count
    expect(after.readiness.satisfiedCount).toBeGreaterThan(before.readiness.satisfiedCount);
  });
});
