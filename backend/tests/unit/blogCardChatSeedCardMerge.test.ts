/**
 * Suggestion → Chat → Deliverable: the refinement must not destroy the
 * recommendation it started from.
 *
 * "Discuss in Chat" ends when the model returns a card. That card — not the
 * seed — is what `AIBlogCardModal.onCardCreated` hands to
 * `ManagedIntelligencePage.acceptAiCard`, which writes it to the
 * `prefill_card` token that `ManagedSuggestionsPage.briefFromAcceptedCard`
 * turns into the generation brief. Anything the model dropped on the way out
 * of the conversation was therefore dropped from the deliverable.
 *
 * These tests pin the opposite: what the chat settled wins, what it left empty
 * falls back to the (already sanitized, already moderated) seed, and the
 * original brief/angle/objective survive in `reason` — the field
 * `buildAcceptedBriefFields` renders into `answers.strategy_perspective`.
 *
 * Real auth chain (routeAuthHarness); only identity, DB, moderation and the AI
 * gateway are faked.
 */
import { seed, invoke, CO_A, CO_B } from '../helpers/routeAuthHarness';
import {
  mergeChatSeedIntoCard,
  sanitizeChatSeed,
  toChatSeed,
  type ChatCardDraft,
} from '../../../lib/content/suggestionChatSeed';
import { briefFromAcceptedCard, buildAcceptedBriefFields } from '../../../components/content/ManagedSuggestionsPage';
import type { ContentSuggestion } from '../../../lib/content/contentSuggestionContract';

jest.mock('@/config', () => ({ config: { DEV_USER_ID: '', NODE_ENV: 'production' } }));
jest.mock('../../db/supabaseClient', () => require('../helpers/routeAuthHarness').supabaseModule());
jest.mock('../../db/writeOwner', () => require('../helpers/routeAuthHarness').writeOwnerModule());
jest.mock('../../services/supabaseAuthService', () => require('../helpers/routeAuthHarness').authModule());
jest.mock('../../security/IdentityResolver', () => require('../helpers/routeAuthHarness').identityModule());

jest.mock('../../chatGovernance', () => ({ validateAndModerateUserMessage: async () => ({ allowed: true }) }));

const mockRunCompletion = jest.fn(async (..._a: any[]) => ({ output: '{}' }));
jest.mock('../../services/aiGateway', () => ({ runCompletion: (...a: any[]) => mockRunCompletion(...a) }));

/* eslint-disable @typescript-eslint/no-var-requires */
const blogCardChat = require('../../../pages/api/ai/blog-card-chat').default;
/* eslint-enable @typescript-eslint/no-var-requires */

const SUGGESTION: ContentSuggestion = {
  topic: 'Why onboarding data decays within 90 days',
  angle: 'ANGLE-SENTINEL from our own implementation work',
  objective: 'OBJECTIVE-SENTINEL establish authority with RevOps buyers',
  audience: 'AUDIENCE-SENTINEL heads of revenue operations',
  brief: 'BRIEF-SENTINEL explain the mechanism, then the fix, then the next step.',
  reason: 'REASON-SENTINEL recurring questions in your threads',
  intent: 'conversion',
  priority: 'high',
  tone: 'TONE-SENTINEL direct',
  format_guidance: 'FORMAT-SENTINEL three sections',
  platform_guidance: 'PLATFORM-SENTINEL must not reach chat',
  context_used: {
    company_profile: true,
    engagement_signals: 2,
    user_input: false,
    campaign_context: false,
    content_history: false,
    knowledge_graph: false,
    coverage_analysis: false,
  },
};

const SEED = toChatSeed(SUGGESTION);

const body = (metadata: Record<string, unknown> = {}) => ({
  message: 'Can we make it more practical?',
  companyId: CO_A,
  contentType: 'article',
  conversation: [{ role: 'assistant', content: 'opener' }],
  metadata: { companyName: 'Company A', companyContext: 'B2B analytics', contentLabel: 'article', ...metadata },
});

const respondWithCard = (card: Record<string, unknown>) => {
  mockRunCompletion.mockImplementation(async () => ({ output: JSON.stringify({ done: true, card }) }));
};

const cardFrom = async (metadata: Record<string, unknown>) => {
  const res = await invoke(blogCardChat, { method: 'POST', as: 'A', body: body(metadata) });
  expect(res.status).toBe(200);
  return (res.body as { done: boolean; card: Record<string, unknown> }).card;
};

beforeEach(() => {
  seed();
  mockRunCompletion.mockReset();
  mockRunCompletion.mockImplementation(async () => ({ output: '{}' }));
});

describe('mergeChatSeedIntoCard', () => {
  it('is the identity function without a seed, so seedless callers are unchanged', () => {
    const card = { topic: 'T', intent: 'awareness', reason: 'R' };
    expect(mergeChatSeedIntoCard(card, null)).toBe(card);
    expect(mergeChatSeedIntoCard(card, undefined)).toBe(card);
  });

  it('keeps everything the chat actually settled — refinement wins over the seed', () => {
    const merged = mergeChatSeedIntoCard(
      {
        topic: 'REFINED topic for founders',
        intent: 'awareness',
        audience: 'REFINED audience',
        tone: 'REFINED tone',
        priority: 'low',
        reason: 'REFINED rationale',
        writingStyle: 'REFINED style',
        relatedTopics: ['a'],
      },
      SEED,
    );
    expect(merged.topic).toBe('REFINED topic for founders');
    expect(merged.intent).toBe('awareness');
    expect(merged.audience).toBe('REFINED audience');
    expect(merged.tone).toBe('REFINED tone');
    expect(merged.priority).toBe('low');
    expect(merged.writingStyle).toBe('REFINED style');
    expect(merged.reason).toContain('REFINED rationale');
  });

  it('fills only what the chat left empty or invalid', () => {
    const merged = mergeChatSeedIntoCard(
      { topic: '   ', intent: 'exfiltrate', audience: '', tone: undefined, priority: 'URGENT', reason: '' },
      SEED,
    );
    expect(merged.topic).toBe(SUGGESTION.topic);
    expect(merged.intent).toBe('conversion');
    expect(merged.audience).toBe(SUGGESTION.audience);
    expect(merged.tone).toBe(SUGGESTION.tone);
    expect(merged.priority).toBe('high');
  });

  it('does not duplicate the recommendation when the chat already restated it', () => {
    const merged = mergeChatSeedIntoCard({ topic: 'T', reason: `${SUGGESTION.brief} ${SUGGESTION.angle}` }, SEED);
    expect(String(merged.reason).match(/BRIEF-SENTINEL/g)).toHaveLength(1);
    expect(String(merged.reason)).not.toContain('Original recommendation:');
  });

  it('does not invent fields the seed has no value for', () => {
    // Annotated: inferring T from the literal would narrow the RESULT to
    // `{ topic: string }`, hiding the very fields this test is about.
    const emptyCard: ChatCardDraft = { topic: '' };
    const merged = mergeChatSeedIntoCard(emptyCard, sanitizeChatSeed({ topic: 'Only a topic here' })!);
    expect(merged.topic).toBe('Only a topic here');
    expect(merged.audience).toBeUndefined();
    expect(merged.tone).toBeUndefined();
    expect(merged.reason).toBeUndefined();
  });
});

describe('POST /api/ai/blog-card-chat — the confirmed card preserves the recommendation', () => {
  it('carries the original brief, angle and objective into the card reason', async () => {
    respondWithCard({
      topic: 'Sharpened: onboarding data decay in the first quarter',
      intent: 'conversion',
      reason: 'We agreed to lead with the 90-day mechanism.',
    });
    const card = await cardFrom({ seedSuggestion: SEED });

    expect(card.topic).toBe('Sharpened: onboarding data decay in the first quarter');
    expect(String(card.reason)).toContain('We agreed to lead with the 90-day mechanism.');
    expect(String(card.reason)).toContain('BRIEF-SENTINEL');
    expect(String(card.reason)).toContain('ANGLE-SENTINEL');
    expect(String(card.reason)).toContain('OBJECTIVE-SENTINEL');
  });

  it('restores audience, tone, intent and priority the model dropped', async () => {
    respondWithCard({ topic: 'Sharpened topic', reason: 'Refined rationale' });
    const card = await cardFrom({ seedSuggestion: SEED });

    expect(card.audience).toBe(SUGGESTION.audience);
    expect(card.tone).toBe(SUGGESTION.tone);
    expect(card.intent).toBe('conversion');
    expect(card.priority).toBe('high');
  });

  it('a seedless conversation returns the model card untouched', async () => {
    respondWithCard({ topic: 'Blank-chat topic', intent: 'awareness', reason: 'Blank-chat rationale' });
    const card = await cardFrom({});

    expect(card).toEqual({ topic: 'Blank-chat topic', intent: 'awareness', reason: 'Blank-chat rationale' });
  });

  it('the seed is still untrusted: unlisted fields and foreign ids never reach the card', async () => {
    respondWithCard({ topic: 'Sharpened topic', reason: 'Refined rationale' });
    const card = await cardFrom({
      seedSuggestion: {
        topic: 'Seed topic',
        brief: 'x'.repeat(5000),
        intent: 'exfiltrate',
        companyId: CO_B,
        secret: 'UNLISTED-FIELD-SENTINEL',
      },
    });

    const serialized = JSON.stringify(card);
    expect(serialized).not.toContain('UNLISTED-FIELD-SENTINEL');
    expect(serialized).not.toContain(CO_B);
    expect(card.intent).toBeUndefined();
    // The brief reaches `reason` only through the sanitizer's 800-char cap.
    expect(String(card.reason)).toContain('x'.repeat(800));
    expect(String(card.reason)).not.toContain('x'.repeat(801));
  });

  it('an unfinished conversation is unaffected', async () => {
    mockRunCompletion.mockImplementation(async () => ({
      output: JSON.stringify({ done: false, nextQuestion: 'Which section should we cut?' }),
    }));
    const res = await invoke(blogCardChat, { method: 'POST', as: 'A', body: body({ seedSuggestion: SEED }) });
    expect(res.status).toBe(200);
    expect((res.body as { done: boolean }).done).toBe(false);
    expect((res.body as { card?: unknown }).card).toBeUndefined();
  });
});

describe('the preserved context survives all the way to the generation request', () => {
  it('reaches answers.strategy_perspective and answers.audience via the accepted-card brief', async () => {
    respondWithCard({ topic: 'Sharpened topic', reason: 'Refined rationale', writingStyle: 'Plain and direct' });
    const card = await cardFrom({ seedSuggestion: SEED });

    // Exactly what ManagedIntelligencePage.acceptAiCard writes to the
    // `prefill_card` token and ManagedSuggestionsPage reads back.
    const brief = briefFromAcceptedCard(JSON.parse(JSON.stringify(card)));
    const fields = buildAcceptedBriefFields(brief);

    expect(fields.answers.audience).toBe(SUGGESTION.audience);
    expect(fields.answers.writing_style).toBe('Plain and direct');
    expect(fields.tone).toBe(SUGGESTION.tone);
    expect(fields.intent).toBe('conversion');
    expect(fields.answers.strategy_perspective).toContain('Refined rationale');
    expect(fields.answers.strategy_perspective).toContain('BRIEF-SENTINEL');
    expect(fields.answers.strategy_perspective).toContain('ANGLE-SENTINEL');
    expect(fields.answers.strategy_perspective).toContain('OBJECTIVE-SENTINEL');
  });
});
