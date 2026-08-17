/**
 * P1.6 — Suggest with AI.
 *
 * Covers the suggestion contract, the service's signal handling, the accept
 * mapping into the EXISTING generation input, and the guarantees that make this
 * a recommendation engine rather than another chatbot.
 *
 * Fixtures deliberately contain NO content history, knowledge-graph or coverage
 * data — those signals do not exist in production yet, and inventing fixtures
 * for them would imply a capability the service does not have.
 */

jest.mock('../../services/aiGateway', () => ({
  runCompletionWithOperation: jest.fn(),
}));
jest.mock('../../services/context/canonicalContentContextResolver', () => ({
  resolveCompanyGroundingGuard: jest.fn(),
}));
jest.mock('../../services/context/canonicalProfileAdapter', () => ({
  getCanonicalProfile: jest.fn(),
}));
jest.mock('../../services/contentOpportunityService', () => ({
  generateContentOpportunities: jest.fn(),
}));

import { runCompletionWithOperation } from '../../services/aiGateway';
import { resolveCompanyGroundingGuard } from '../../services/context/canonicalContentContextResolver';
import { getCanonicalProfile } from '../../services/context/canonicalProfileAdapter';
import { generateContentOpportunities } from '../../services/contentOpportunityService';
import { generateContentSuggestion } from '../../services/content/contentSuggestionService';
import {
  isActionableSuggestion,
  toGenerationInput,
  type ContentSuggestion,
} from '../../../lib/content/contentSuggestionContract';

const mockAi = runCompletionWithOperation as jest.MockedFunction<typeof runCompletionWithOperation>;
const mockGrounding = resolveCompanyGroundingGuard as jest.MockedFunction<typeof resolveCompanyGroundingGuard>;
const mockProfile = getCanonicalProfile as jest.MockedFunction<typeof getCanonicalProfile>;
const mockOpportunities = generateContentOpportunities as jest.MockedFunction<typeof generateContentOpportunities>;

const COMPANY_A = 'company-a';
const COMPANY_B = 'company-b';

const PROFILE_A = {
  industry: 'B2B SaaS',
  target_audience: 'Heads of marketing at 50-500 person companies',
  products_services: 'Content operations platform',
  goals: 'Own the content-operations category',
};

const OPPORTUNITY_A = {
  topic: 'content attribution',
  opportunity_type: 'explainer' as const,
  suggested_title: 'Content Attribution: Common Issues and Solutions',
  signal_summary: { questions: 6, problems: 4, comparisons: 1, feature_requests: 0 },
  confidence_score: 0.72,
};

/** A well-formed, actionable model reply. */
const MODEL_REPLY = JSON.stringify({
  topic: 'Why content attribution keeps breaking at scale',
  angle: 'Argue from your own instrumentation rather than surveying the category.',
  objective: 'authority',
  audience: 'Heads of marketing at mid-market B2B companies',
  brief:
    'Write a post for heads of marketing explaining why attribution breaks once content volume rises. ' +
    'Open with the failure mode, show the mechanism, and close with one concrete fix.',
  reason: 'Your engagement threads show repeated questions about attribution.',
  intent: 'authority',
  priority: 'high',
  tone: 'Direct and specific',
  format_guidance: 'Lead with the claim, then three supporting beats.',
  platform_guidance: 'Reads well on LinkedIn.',
});

function aiOk(output: string) {
  return { output, metadata: {} } as unknown as Awaited<ReturnType<typeof runCompletionWithOperation>>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGrounding.mockResolvedValue({ brand: 'Acme', allowedNames: ['Acme'], directive: 'GROUNDING' });
  mockProfile.mockResolvedValue(PROFILE_A as never);
  mockOpportunities.mockResolvedValue([OPPORTUNITY_A]);
  mockAi.mockResolvedValue(aiOk(MODEL_REPLY));
});

/* ── 2 / 5. Request carries the right company + content context ──────────── */

describe('suggestion request context', () => {
  it('passes the company and the content type into the suggestion engine', async () => {
    await generateContentSuggestion({
      companyId: COMPANY_A,
      contentType: 'post',
      formatLabel: 'Authority Post',
    });

    expect(mockProfile).toHaveBeenCalledWith(COMPANY_A, expect.any(Object));
    expect(mockOpportunities).toHaveBeenCalledWith(COMPANY_A, expect.any(Number));

    const call = mockAi.mock.calls[0][0];
    expect(call.companyId).toBe(COMPANY_A);
    const prompt = call.messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('post');
    expect(prompt).toContain('Authority Post');
  });

  it('passes company profile context to the model', async () => {
    await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    const prompt = mockAi.mock.calls[0][0].messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('B2B SaaS');
    expect(prompt).toContain('Heads of marketing at 50-500 person companies');
  });

  it('uses engagement/opportunity signals when they are available', async () => {
    await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    const prompt = mockAi.mock.calls[0][0].messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('content attribution');
    expect(prompt).toContain('0.72');
  });

  it('reuses an already-mapped AI operation key so billing behaviour is unchanged', async () => {
    await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });
    // creatorFieldAssist is the existing "Suggest with AI" operation, already
    // mapped to the content_rewrite action key. A new key would emit
    // unknown_action_key anomalies.
    expect(mockAi.mock.calls[0][0].operation).toBe('creatorFieldAssist');
  });
});

/* ── 3 / 4. Structured, actionable, never a clarifying question ──────────── */

describe('suggestion output', () => {
  it('returns structured actionable data, not prose', async () => {
    const suggestion = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    expect(suggestion.topic).toBe('Why content attribution keeps breaking at scale');
    expect(suggestion.brief.length).toBeGreaterThan(40);
    expect(suggestion.objective).toBeTruthy();
    expect(suggestion.audience).toBeTruthy();
    expect(suggestion.reason).toBeTruthy();
    expect(['awareness', 'authority', 'conversion', 'retention']).toContain(suggestion.intent);
    expect(['high', 'medium', 'low']).toContain(suggestion.priority);
  });

  it('never surfaces a clarifying question, even when the model returns one', async () => {
    mockAi.mockResolvedValue(
      aiOk(JSON.stringify({ topic: 'What would you like to write about?', brief: 'Tell me more.' })),
    );

    const suggestion = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    expect(suggestion.topic.endsWith('?')).toBe(false);
    expect(suggestion.topic).not.toMatch(/what would you like/i);
    expect(suggestion.brief.length).toBeGreaterThan(40);
  });

  it('rejects thin or interrogative candidates at the contract level', () => {
    expect(isActionableSuggestion(null)).toBe(false);
    expect(isActionableSuggestion({ topic: 'What should I write about?', brief: 'x'.repeat(60) })).toBe(false);
    expect(isActionableSuggestion({ topic: 'Short', brief: 'x'.repeat(60) })).toBe(false);
    expect(isActionableSuggestion({ topic: 'A perfectly good topic', brief: 'too short' })).toBe(false);
    expect(isActionableSuggestion({ topic: 'A perfectly good topic', brief: 'x'.repeat(60) })).toBe(true);
  });

  it('produces a suggestion from context even when the user has provided nothing', async () => {
    const suggestion = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    expect(suggestion.context_used.user_input).toBe(false);
    expect(suggestion.topic.length).toBeGreaterThan(8);
    expect(suggestion.brief.length).toBeGreaterThan(40);
  });
});

/* ── 7. Missing signals degrade, never break ─────────────────────────────── */

describe('missing signals', () => {
  it('still returns an actionable suggestion with no profile and no engagement signals', async () => {
    mockProfile.mockResolvedValue(null as never);
    mockOpportunities.mockResolvedValue([]);
    mockAi.mockRejectedValue(new Error('gateway unavailable'));

    const suggestion = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    expect(isActionableSuggestion(suggestion)).toBe(true);
    expect(suggestion.context_used.company_profile).toBe(false);
    expect(suggestion.context_used.engagement_signals).toBe(0);
  });

  it('survives an opportunity-engine failure', async () => {
    mockOpportunities.mockRejectedValue(new Error('engagement tables unavailable'));

    const suggestion = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    expect(isActionableSuggestion(suggestion)).toBe(true);
    expect(suggestion.context_used.engagement_signals).toBe(0);
  });

  it('never claims history, knowledge-graph or coverage signals it does not have', async () => {
    const suggestion = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    // content_memory is empty in production and there is no generation-time
    // graph or coverage reader — the contract must report that honestly.
    expect(suggestion.context_used.content_history).toBe(false);
    expect(suggestion.context_used.knowledge_graph).toBe(false);
    expect(suggestion.context_used.coverage_analysis).toBe(false);
  });

  it('falls back when the model returns unparseable output', async () => {
    mockAi.mockResolvedValue(aiOk('not json at all'));

    const suggestion = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });
    expect(isActionableSuggestion(suggestion)).toBe(true);
  });

  it('requires a company id', async () => {
    await expect(
      generateContentSuggestion({ companyId: '', contentType: 'post' }),
    ).rejects.toThrow(/companyId/i);
  });
});

/* ── 8. Accept populates the EXISTING generation input ───────────────────── */

describe('accept', () => {
  it('maps a suggestion onto the existing RecommendationCard generation input', async () => {
    const suggestion = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });
    const input = toGenerationInput(suggestion);

    // Exactly the shape generatePostFromIdea / the template prefill consume.
    expect(Object.keys(input).sort()).toEqual(['intent', 'priority', 'reason', 'tone', 'topic']);
    expect(input.topic).toBe(suggestion.topic);
    expect(input.intent).toBe(suggestion.intent);
    expect(input.priority).toBe(suggestion.priority);
  });

  it('carries the actionable brief into the generation input, not just the rationale', async () => {
    const suggestion = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });
    expect(toGenerationInput(suggestion).reason).toContain(suggestion.brief);
  });

  it('drops platform guidance so the master draft stays platform-neutral', async () => {
    const suggestion = await generateContentSuggestion({
      companyId: COMPANY_A,
      contentType: 'post',
      platform: 'linkedin',
    });
    expect(suggestion.platform_guidance).toBeTruthy();

    const input = toGenerationInput(suggestion);
    expect(JSON.stringify(input)).not.toContain(suggestion.platform_guidance);
    expect(input).not.toHaveProperty('platform');
    expect(input).not.toHaveProperty('platform_guidance');
  });
});

/* ── 9 / 10. Revise refines the suggestion; it does not generate content ─── */

describe('revise', () => {
  it('does not produce final content — it returns another suggestion', async () => {
    const first = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    mockAi.mockResolvedValue(
      aiOk(JSON.stringify({
        ...JSON.parse(MODEL_REPLY),
        topic: 'Attribution is a founder problem before it is a marketing problem',
        brief: 'Write a post for founders explaining why attribution debt starts at the top. '
          + 'Open with the org-design cause, then the measurable symptom, then the fix.',
      })),
    );

    const revised = await generateContentSuggestion({
      companyId: COMPANY_A,
      contentType: 'post',
      revisionInstruction: 'focus on founders',
      previousSuggestion: first,
      revisionIndex: 1,
    });

    // Still a brief, not an article: the generation endpoint was never touched.
    expect(isActionableSuggestion(revised)).toBe(true);
    expect(revised.brief.length).toBeLessThan(1000);
    expect(revised).toHaveProperty('context_used');
  });

  it('produces an updated suggestion and records the revision', async () => {
    const first = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });

    mockAi.mockResolvedValue(
      aiOk(JSON.stringify({
        ...JSON.parse(MODEL_REPLY),
        topic: 'Attribution is a founder problem before it is a marketing problem',
      })),
    );

    const revised = await generateContentSuggestion({
      companyId: COMPANY_A,
      contentType: 'post',
      revisionInstruction: 'focus on founders',
      previousSuggestion: first,
      revisionIndex: 1,
    });

    expect(revised.topic).not.toBe(first.topic);
    expect(revised.revision).toEqual({ instruction: 'focus on founders', revision_index: 1 });
  });

  it('sends the refinement and the previous suggestion to the model', async () => {
    const first = await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });
    mockAi.mockClear();

    await generateContentSuggestion({
      companyId: COMPANY_A,
      contentType: 'post',
      revisionInstruction: 'make it more provocative',
      previousSuggestion: first,
      revisionIndex: 1,
    });

    const prompt = mockAi.mock.calls[0][0].messages.map((m) => m.content).join('\n');
    expect(prompt).toContain('make it more provocative');
    expect(prompt).toContain(first.topic);
  });
});

/* ── 12. Tenant isolation ────────────────────────────────────────────────── */

describe('tenant isolation', () => {
  it('reads every signal under the requested company only', async () => {
    await generateContentSuggestion({ companyId: COMPANY_B, contentType: 'post' });

    expect(mockProfile).toHaveBeenCalledTimes(1);
    expect(mockProfile.mock.calls[0][0]).toBe(COMPANY_B);
    expect(mockOpportunities).toHaveBeenCalledTimes(1);
    expect(mockOpportunities.mock.calls[0][0]).toBe(COMPANY_B);
    expect(mockGrounding.mock.calls[0][0]).toBe(COMPANY_B);
    expect(mockAi.mock.calls[0][0].companyId).toBe(COMPANY_B);

    // No other tenant is reachable from a single-company request.
    const everyCompanyIdTouched = [
      ...mockProfile.mock.calls.map((c) => c[0]),
      ...mockOpportunities.mock.calls.map((c) => c[0]),
      ...mockGrounding.mock.calls.map((c) => c[0]),
    ];
    expect(new Set(everyCompanyIdTouched)).toEqual(new Set([COMPANY_B]));
  });

  it('does not leak one company\'s signals into another company\'s prompt', async () => {
    await generateContentSuggestion({ companyId: COMPANY_A, contentType: 'post' });
    const promptA = mockAi.mock.calls[0][0].messages.map((m) => m.content).join('\n');
    expect(promptA).toContain('content attribution');

    jest.clearAllMocks();
    mockGrounding.mockResolvedValue({ brand: 'Other', allowedNames: ['Other'], directive: 'GROUNDING' });
    mockProfile.mockResolvedValue({ industry: 'Logistics' } as never);
    mockOpportunities.mockResolvedValue([]);
    mockAi.mockResolvedValue(aiOk(MODEL_REPLY));

    await generateContentSuggestion({ companyId: COMPANY_B, contentType: 'post' });
    const promptB = mockAi.mock.calls[0][0].messages.map((m) => m.content).join('\n');
    expect(promptB).toContain('Logistics');
    expect(promptB).not.toContain('content attribution');
    expect(promptB).not.toContain('B2B SaaS');
  });
});

/* ── 1 / 11. Wiring: available in the flow, and generation is unchanged ──── */

describe('wiring', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../../', p), 'utf8');

  it('Suggest with AI is mounted in the AI-assisted content entry flow', () => {
    const page = read('components/content/ManagedIntelligencePage.tsx');
    expect(page).toContain('SuggestWithAIPanel');
    expect(page).toContain('onAccept={acceptSuggestion}');
  });

  it('accept routes through the SAME generation path as the existing AI card', () => {
    const page = read('components/content/ManagedIntelligencePage.tsx');
    // One accept implementation, shared by the chat modal and the panel.
    expect(page).toContain('onCardCreated={acceptAiCard}');
    expect(page).toMatch(/const acceptSuggestion[\s\S]{0,200}acceptAiCard\(toGenerationInput\(suggestion\)\)/);
  });

  it('the panel never calls a generation endpoint — Revise cannot produce content', () => {
    const panel = read('components/content/SuggestWithAIPanel.tsx');
    expect(panel).toContain('/api/content/suggest');
    expect(panel).not.toMatch(/\/api\/posts\/generate|\/api\/ai\/generate-content|\/api\/content\/generate/);
  });

  it('leaves the existing generation flow unchanged when Suggest with AI is unused', () => {
    const page = read('components/content/ManagedIntelligencePage.tsx');
    // The pre-existing entry points and the post generation call are intact.
    expect(page).toContain('Create with AI Chat');
    expect(page).toContain('Write Your Own Topic');
    expect(page).toContain("fetch('/api/posts/generate'");
    // The panel is additive: it renders only alongside the existing surface.
    expect(page).toContain('<SuggestWithAIPanel');
  });

  it('does not touch F1, the knowledge graph, billing, or delegation flags', () => {
    // Comments legitimately NAME these systems to explain what is deliberately
    // not used; the assertion is about code, so strip comments first.
    const codeOnly = (src: string) =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n');

    const service = codeOnly(read('backend/services/content/contentSuggestionService.ts'));
    const route = codeOnly(read('pages/api/content/suggest.ts'));

    for (const src of [service, route]) {
      // Dependencies are what matter. `knowledge_graph` legitimately appears as
      // a context_used FIELD NAME (reported false) — that is the honesty
      // contract, not a graph read. So assert on imports.
      const imports = src.match(/^\s*import[\s\S]*?from\s+'[^']+';/gm)?.join('\n') ?? '';
      expect(imports).not.toMatch(/contentMemoryService|content\/runtime|generationRuntime/);
      expect(imports).not.toMatch(/knowledgeGraph/);
      expect(imports).not.toMatch(/featureRegistry|phase2/i);

      // And no delegation flag or graph/memory write anywhere in the code.
      expect(src).not.toMatch(/RUNTIME_DELEGATION_ENABLED/);
      expect(src).not.toMatch(/CONTENT_MEMORY_WRITE_ENABLED/);
      expect(src).not.toMatch(/\.from\(\s*'content_memory'/);
    }

    // The suggestion contract declares the graph/history signals it does NOT
    // yet have; that declaration must stay false-only, never a live read.
    expect(service).toContain('content_history: false');
    expect(service).toContain('knowledge_graph: false');
  });
});
