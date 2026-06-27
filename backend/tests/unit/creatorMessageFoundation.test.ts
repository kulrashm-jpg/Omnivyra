import {
  buildMessageDocument, buildPackageFromMessage, messageToIntake, updateMessage,
  summarizeMessage, listMessages, resolveMessage, searchMessages, type MessageDocument,
} from '../../../lib/creator-templates/messageFoundation';
import { extractMessageDocument } from '../../../lib/creator-templates/messageExtraction';
import { generateMessageDocument } from '../../../lib/creator-templates/messageGeneration';
import { extractIntelligence } from '../../../lib/creator-templates/contentIntelligence';
import { packageIntelligence, packageCommunicationStrategy, packageAudienceJourney } from '../../../lib/creator-templates/contentPackage';

const AT = '2026-06-26T00:00:00.000Z';
const CONTENT = [
  'The Activation Playbook',
  'Teams struggle with slow manual onboarding that wastes time.',
  'Our solution automates onboarding so you can ship 92% faster.',
  '"It changed everything." — Jane Doe, CEO.',
  'Get started free today. See https://acme.com/docs',
].join('\n');

const SHAPE = ['id', 'title', 'summary', 'mainMessage', 'supportingMessages', 'supportingEvidence', 'statistics', 'quotes', 'stories', 'examples', 'benefits', 'painPoints', 'solutions', 'objections', 'ctas', 'references', 'keywords', 'tone', 'objective', 'audience', 'platform', 'metadata', 'source', 'provenance'].sort();
const sameShape = (m: MessageDocument) => expect(Object.keys(m).sort()).toEqual(SHAPE);

describe('Message Foundation — extraction (Writer-first)', () => {
  it('extracts a canonical MessageDocument reusing Content Intelligence', () => {
    const m = extractMessageDocument({ content: CONTENT, source: 'writer', id: 'm1', writerDocumentId: 'blog-7' });
    sameShape(m);
    expect(m.mainMessage).toBe('The Activation Playbook');
    expect(m.statistics.some((s) => s.includes('92%'))).toBe(true);
    expect(m.painPoints.length).toBeGreaterThan(0);
    expect(m.solutions.length).toBeGreaterThan(0);
    expect(m.quotes.some((q) => /changed everything/.test(q))).toBe(true);
    expect(m.ctas.length).toBeGreaterThan(0);
    expect(m.references.some((r) => r.startsWith('http'))).toBe(true);
    expect((m.metadata as any).writerDocumentId).toBe('blog-7');
    // No duplicate extraction — statistics equal Content Intelligence's output.
    expect(m.statistics).toEqual(Array.from(new Set(extractIntelligence(CONTENT).statistics.map((s) => s.text))));
  });

  it('website / pdf / docx / campaign / asset extraction all use ONE path', () => {
    for (const src of ['website', 'pdf', 'docx', 'campaign', 'asset'] as const) {
      const m = extractMessageDocument({ content: CONTENT, source: src });
      sameShape(m);
      expect(m.source).toBe(src);
      expect(m.statistics.some((s) => s.includes('92%'))).toBe(true);
    }
  });
});

describe('Message Foundation — generation (Creator-first)', () => {
  it('AI / voice / notes text structures into the identical MessageDocument shape', () => {
    const ai = generateMessageDocument(CONTENT, { description: 'Launch', audience: 'executives', platform: 'linkedin', campaignObjective: 'product_launch' });
    sameShape(ai);
    expect(ai.source).toBe('generation');
    expect(ai.audience).toBe('executives');
    expect(ai.objective).toBe('product_launch');
    expect(ai.statistics.some((s) => s.includes('92%'))).toBe(true);
    const voice = generateMessageDocument(CONTENT, {});
    sameShape(voice);
    expect(voice.painPoints.length).toBeGreaterThan(0);
  });
});

describe('Message Foundation — unified builder + convergence', () => {
  it('the unified builder routes to extraction OR generation transparently', () => {
    const fromContent = buildMessageDocument({ content: CONTENT, source: 'writer', id: 'u1' });
    const fromGenerated = buildMessageDocument({ generatedText: CONTENT, brief: { id: 'u2' } });
    expect(fromContent.source).toBe('writer');
    expect(fromGenerated.source).toBe('generation');
    sameShape(fromContent); sameShape(fromGenerated);
  });

  it('MessageDocument → Package → identical downstream (no bypass)', () => {
    const m = extractMessageDocument({ content: CONTENT, source: 'writer', id: 'mp' });
    const p1 = buildPackageFromMessage(m, { createdAt: AT });
    const p2 = buildPackageFromMessage(m, { createdAt: AT });
    expect(JSON.stringify(p1)).toBe(JSON.stringify(p2));                // same message → identical package
    // The full downstream pipeline runs off the message-built package.
    const intel = packageIntelligence(p1);
    expect(intel.statistics.some((s) => s.text.includes('92%'))).toBe(true);
    expect(intel.painPoints.length).toBeGreaterThan(0);
    expect(intel.solutions.length).toBeGreaterThan(0);
    expect(packageCommunicationStrategy(p1).selectedStrategy.id).toBeTruthy();
    expect(packageAudienceJourney(p1).selectedJourney.id).toBeTruthy();
  });

  it('Writer-first and Creator-first converge to the same downstream contract', () => {
    // Same id so the only difference is the entry point (extraction vs generation).
    const writer = buildPackageFromMessage(buildMessageDocument({ content: CONTENT, source: 'writer', id: 'x' }), { createdAt: AT });
    const creator = buildPackageFromMessage(buildMessageDocument({ generatedText: CONTENT, brief: { id: 'x' } }), { createdAt: AT });
    // Identical body → identical extracted knowledge (by text) + identical strategy.
    const stats = (p: typeof writer) => packageIntelligence(p).statistics.map((s) => s.text);
    expect(JSON.stringify(stats(writer))).toBe(JSON.stringify(stats(creator)));
    expect(packageCommunicationStrategy(writer).selectedStrategy.id).toBe(packageCommunicationStrategy(creator).selectedStrategy.id);
  });

  it('AI collaboration updates ONLY the message; package rebuilds', () => {
    const m = extractMessageDocument({ content: CONTENT, source: 'writer', id: 'ai' });
    const edited = updateMessage(m, { mainMessage: 'Activation in 5 minutes' });
    expect(edited.mainMessage).toBe('Activation in 5 minutes');
    expect(m.mainMessage).toBe('The Activation Playbook'); // original untouched
    const rebuilt = buildPackageFromMessage(edited, { createdAt: AT });
    expect(rebuilt.mergedDocument.body).toContain('Activation in 5 minutes');
  });

  it('is deterministic + provides search/summary', () => {
    const m = extractMessageDocument({ content: CONTENT, source: 'writer', id: 's' });
    expect(JSON.stringify(extractMessageDocument({ content: CONTENT, source: 'writer', id: 's' }))).toBe(JSON.stringify(m));
    const sum = summarizeMessage(m);
    expect(sum.mainMessage).toBe('The Activation Playbook');
    expect(sum.statistics.length).toBeGreaterThan(0);
    expect(sum.confidence).toBeGreaterThan(0);
    const list = [m, extractMessageDocument({ content: 'Other', source: 'notes', id: 'o' })];
    expect(resolveMessage(list, 's')?.id).toBe('s');
    expect(searchMessages(list, 'activation').length).toBe(1);
    expect(listMessages(list).length).toBe(2);
  });
});
