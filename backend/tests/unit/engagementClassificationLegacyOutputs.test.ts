/**
 * SC-7 draft — the three classifiers' existing outputs are unchanged.
 *
 * The canonical code is ADDITIVE: classifyThread gains `canonical_code` beside its
 * four existing fields (which the worker persists, and only those); analyzeMessage
 * persists exactly the columns it did before; the response policy engine's rule
 * lookup still keys on the legacy intent.
 */

type Row = Record<string, unknown>;
const tableData: Record<string, unknown> = {};
const upserts: Array<{ table: string; row: Row }> = [];
const eqCalls: Array<{ table: string; col: string; val: unknown }> = [];

function builder(table: string): any {
  const b: any = {};
  for (const m of ['select', 'eq', 'in', 'not', 'order', 'limit', 'or']) {
    b[m] = (...args: unknown[]) => {
      if (m === 'eq') eqCalls.push({ table, col: String(args[0]), val: args[1] });
      return b;
    };
  }
  const asRows = (): unknown[] => {
    const d = tableData[table];
    return d === undefined ? [] : Array.isArray(d) ? d : [d];
  };
  b.maybeSingle = async () => ({ data: asRows()[0] ?? null, error: null });
  b.upsert = async (row: Row) => {
    upserts.push({ table, row });
    return { error: null };
  };
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve({ data: asRows(), error: null }).then(resolve, reject);
  return b;
}

jest.mock('../../db/supabaseClient', () => ({ supabase: { from: (t: string) => builder(t) } }));
jest.mock('../../db/writeOwner', () => ({ ownedDbTable: (t: string) => builder(t) }));
jest.mock('../../services/conversationMemoryService', () => ({ getThreadMemory: jest.fn(async () => '') }));
jest.mock('../../services/aiGateway', () => ({ runCompletionWithOperation: jest.fn() }));
jest.mock('../../services/omnivyraClientV1', () => ({
  isOmnivyraEnabled: () => false,
  evaluateCommunityAiEngagement: jest.fn(),
}));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({ getCanonicalProfile: jest.fn() }));
jest.mock('../../services/leadDetectionService', () => ({ processMessageForLeads: jest.fn(async () => ({ detected: false })) }));

import { runCompletionWithOperation } from '../../services/aiGateway';
import { canonicalCodeForTriageCategory, classifyThread } from '../../services/conversationTriageService';
import {
  analyzeMessage,
  canonicalCodeForIntelligenceIntent,
  ruleBasedAnalysis,
} from '../../services/engagementConversationIntelligenceService';
import { canonicalCodeForPolicyIntent, resolveResponsePolicy } from '../../services/responsePolicyEngine';
import { checkResponseSafety } from '../../services/responseSafetyGuard';

const ORG = '00000000-0000-0000-0000-0000000000aa';
const THREAD = '00000000-0000-0000-0000-0000000000bb';

beforeEach(() => {
  for (const k of Object.keys(tableData)) delete tableData[k];
  upserts.length = 0;
  eqCalls.length = 0;
  (runCompletionWithOperation as jest.Mock).mockReset();
});

describe('conversationTriageService.classifyThread', () => {
  beforeEach(() => {
    tableData.engagement_threads = { id: THREAD, organization_id: ORG };
    tableData.engagement_messages = [{ content: 'Which tool would you recommend?', platform_created_at: '2026-11-01' }];
  });

  it('returns the same four fields with the same values, plus canonical_code', async () => {
    (runCompletionWithOperation as jest.Mock).mockResolvedValue({
      output: JSON.stringify({
        classification_category: 'recommendation_request',
        classification_confidence: 0.8,
        sentiment: 'Positive',
        triage_priority: 8,
      }),
    });
    const r = await classifyThread(THREAD, ORG);
    expect(r).toEqual({
      classification_category: 'recommendation_request',
      classification_confidence: 0.8,
      sentiment: 'positive',
      triage_priority: 8,
      canonical_code: 'enquiry',
    });
  });

  it('an invalid model category still falls back to general_comment (now also canonical ambiguous)', async () => {
    (runCompletionWithOperation as jest.Mock).mockResolvedValue({
      output: JSON.stringify({ classification_category: 'unsubscribe_request', triage_priority: 99 }),
    });
    const r = await classifyThread(THREAD, ORG);
    expect(r).toMatchObject({ classification_category: 'general_comment', triage_priority: 10, canonical_code: 'ambiguous' });
  });

  it('a model failure still returns null', async () => {
    (runCompletionWithOperation as jest.Mock).mockRejectedValue(new Error('boom'));
    expect(await classifyThread(THREAD, ORG)).toBeNull();
  });

  it('canonicalCodeForTriageCategory', () => {
    expect(canonicalCodeForTriageCategory('question_request')).toBe('information_request');
  });
});

describe('engagementConversationIntelligenceService', () => {
  it.each([
    ['I am interested, can we schedule a demo?', null, { intent: 'lead', lead_signal: true, question_detected: true, sentiment: 'neutral' }],
    ['How does it work?', 0.5, { intent: 'question', lead_signal: false, question_detected: true, sentiment: 'positive' }],
    ['Disappointed, it is not working', null, { intent: 'complaint', lead_signal: false, question_detected: false }],
    ['nice', -0.9, { intent: 'complaint', sentiment: 'negative' }],
    ['nice', null, { intent: 'general', sentiment: 'neutral', confidence_score: 0.7, influencer_signal: false }],
  ])('ruleBasedAnalysis(%p, %p) is unchanged', (content, score, expected) => {
    expect(ruleBasedAnalysis(content, score)).toMatchObject(expected);
  });

  it('analyzeMessage persists exactly the columns it did before (no canonical column written)', async () => {
    tableData.engagement_messages = {
      id: 'm1', thread_id: THREAD, content: 'What is the pricing?', author_id: null, platform: 'linkedin', sentiment_score: null,
    };
    tableData.engagement_threads = { id: THREAD, organization_id: ORG };
    await analyzeMessage('m1', ORG);
    const msg = upserts.find((u) => u.table === 'engagement_message_intelligence');
    expect(msg).toBeDefined();
    expect(Object.keys(msg!.row).sort()).toEqual(
      ['confidence_score', 'created_at', 'influencer_signal', 'intent', 'lead_signal', 'message_id', 'question_detected', 'sentiment'].sort(),
    );
    expect(msg!.row.intent).toBe('lead');
  });

  it('canonicalCodeForIntelligenceIntent', () => {
    expect(canonicalCodeForIntelligenceIntent('lead')).toBe('positive_interest');
    expect(canonicalCodeForIntelligenceIntent('complaint')).toBe('support_request');
    expect(canonicalCodeForIntelligenceIntent(null)).toBe('ambiguous');
  });
});

describe('responsePolicyEngine', () => {
  it('rule lookup still keys on the legacy intent_type (normalised exactly as before)', async () => {
    await resolveResponsePolicy({ message_id: 'm', organization_id: ORG, platform: 'LinkedIn', intent: ' Price_Inquiry ' });
    expect(eqCalls).toContainEqual({ table: 'response_rules', col: 'intent_type', val: 'price_inquiry' });
    eqCalls.length = 0;
    await resolveResponsePolicy({ message_id: 'm', organization_id: ORG, platform: 'x', intent: null });
    expect(eqCalls).toContainEqual({ table: 'response_rules', col: 'intent_type', val: 'general_discussion' });
    eqCalls.length = 0;
    await resolveResponsePolicy({ message_id: 'm', organization_id: ORG, platform: 'x', intent: 'lead' });
    expect(eqCalls).toContainEqual({ table: 'response_rules', col: 'intent_type', val: 'lead' });
  });

  it('canonicalCodeForPolicyIntent', () => {
    expect(canonicalCodeForPolicyIntent('price_inquiry')).toBe('pricing');
    expect(canonicalCodeForPolicyIntent(null)).toBe('ambiguous');
    expect(canonicalCodeForPolicyIntent('spam')).toBe('spam_suspicious');
  });

  it('the safety guard (consumer of the same intents) is untouched', () => {
    expect(checkResponseSafety({ intent: 'complaint' })).toMatchObject({ allowed: false, requires_human_review: true });
    expect(checkResponseSafety({ intent: 'lead_interest', sentiment: 'neutral' })).toEqual({ allowed: true, requires_human_review: false });
  });
});
