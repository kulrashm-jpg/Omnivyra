/**
 * Strategic Mix R3-P1 — Content assist service contract.
 *
 * Locks: closed action vocabulary, validation caps, prompt shape (JSON
 * proposals contract), proposal parsing (fences, caps, count clamps), and
 * the honest-degradation rule: shorten/expand fall back deterministically,
 * every other verb degrades to an EMPTY proposal set — never a fake
 * improvement (SPEC-001 §4: AI output is always attributable).
 */

import {
  CONTENT_ASSIST_ACTIONS,
  buildContentAssistMessages,
  deterministicContentTransform,
  runCampaignContentAssist,
  validateContentAssistRequest,
  type ContentAssistRequest,
} from '../../services/campaign/campaignContentAssistService';

const request = (over: Partial<ContentAssistRequest> = {}): ContentAssistRequest => ({
  action: 'improve',
  content: 'First sentence. Second sentence! Third sentence?',
  ...over,
});

describe('validation', () => {
  test('accepts every catalogued action and nothing else', () => {
    for (const action of CONTENT_ASSIST_ACTIONS) {
      const v = validateContentAssistRequest({
        action,
        content: 'Body',
        platform: 'linkedin',
        audience: 'CTOs',
      });
      expect(v.ok).toBe(true);
    }
    expect(validateContentAssistRequest({ action: 'rewrite_everything', content: 'Body' }).ok).toBe(false);
    expect(validateContentAssistRequest({ content: 'Body' }).ok).toBe(false);
  });

  test('requires content; caps lengths; clamps alternatives count to 2–4', () => {
    expect(validateContentAssistRequest({ action: 'improve' }).ok).toBe(false);
    const long = validateContentAssistRequest({ action: 'improve', content: 'x'.repeat(9000) });
    expect(long.request?.content).toHaveLength(8000);
    expect(validateContentAssistRequest({ action: 'alternatives', content: 'Body', count: 9 }).request?.count).toBe(4);
    expect(validateContentAssistRequest({ action: 'alternatives', content: 'Body', count: 1 }).request?.count).toBe(2);
  });

  test('platform_adapt requires platform; audience_adapt requires audience', () => {
    expect(validateContentAssistRequest({ action: 'platform_adapt', content: 'Body' }).ok).toBe(false);
    expect(validateContentAssistRequest({ action: 'platform_adapt', content: 'Body', platform: 'x' }).ok).toBe(true);
    expect(validateContentAssistRequest({ action: 'audience_adapt', content: 'Body' }).ok).toBe(false);
    expect(validateContentAssistRequest({ action: 'audience_adapt', content: 'Body', audience: 'founders' }).ok).toBe(true);
  });
});

describe('prompt', () => {
  test('demands a JSON proposals object and embeds context + instruction', () => {
    const messages = buildContentAssistMessages(request({ platform: 'linkedin', audience: 'CTOs', instruction: 'Keep the stat' }));
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('"proposals"');
    expect(messages[1].content).toContain('Platform: linkedin');
    expect(messages[1].content).toContain('Target audience: CTOs');
    expect(messages[1].content).toContain('Keep the stat');
    expect(messages[1].content).toContain('First sentence.');
  });

  test('alternatives asks for N proposals', () => {
    const messages = buildContentAssistMessages(request({ action: 'alternatives', count: 4 }));
    expect(messages[0].content).toContain('4 strings');
  });
});

describe('deterministic fallback', () => {
  test('shorten keeps the leading half of sentences', () => {
    const [out] = deterministicContentTransform(request({ action: 'shorten' }));
    expect(out).toContain('First sentence.');
    expect(out).not.toContain('Third sentence');
  });

  test('expand appends a deterministic summary line', () => {
    const [out] = deterministicContentTransform(request({ action: 'expand' }));
    expect(out.startsWith('First sentence.')).toBe(true);
    expect(out).toContain('In short:');
  });

  test('non-computable verbs return NO proposals (honest degradation)', () => {
    for (const action of ['improve', 'more_technical', 'alternatives', 'improve_hook', 'improve_image_prompt'] as const) {
      expect(deterministicContentTransform(request({ action }))).toEqual([]);
    }
  });
});

describe('runner', () => {
  test('parses proposals, strips fences, clamps to requested count', async () => {
    const result = await runCampaignContentAssist({
      request: request({ action: 'alternatives', count: 2 }),
      llm: async () => '```json\n{"proposals": ["Alt A", "Alt B", "Alt C"]}\n```',
    });
    expect(result.usedFallback).toBe(false);
    expect(result.proposals).toEqual(['Alt A', 'Alt B']);
  });

  test('LLM failure falls back with a reason instead of throwing', async () => {
    const result = await runCampaignContentAssist({
      request: request({ action: 'shorten' }),
      llm: async () => { throw new Error('billing declined'); },
    });
    expect(result.usedFallback).toBe(true);
    expect(result.fallbackReason).toContain('billing declined');
    expect(result.proposals).toHaveLength(1);
  });

  test('empty/garbage LLM output degrades the same way', async () => {
    const result = await runCampaignContentAssist({
      request: request({ action: 'improve' }),
      llm: async () => '{"proposals": []}',
    });
    expect(result.usedFallback).toBe(true);
    expect(result.proposals).toEqual([]);
  });
});
