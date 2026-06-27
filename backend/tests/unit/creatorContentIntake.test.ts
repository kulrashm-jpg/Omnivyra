import {
  fromExistingContent, fromAiContent, fromVoiceTranscript, fromWriterDocument,
  intakeToArchitectureBody, intakeSourceLabel, describeIntake,
  type ContentIntakeDocument, type ContentSource,
} from '../../../lib/creator-templates/contentIntake';

const SHAPE_KEYS = ['source', 'title', 'body', 'summary', 'metadata', 'campaignGoal', 'audience', 'platform', 'tone', 'keywords', 'references', 'writerDocumentId'].sort();
const sameShape = (d: ContentIntakeDocument) => expect(Object.keys(d).sort()).toEqual(SHAPE_KEYS);

const CONTENT = 'How we cut onboarding time. 92% faster activation. "It just works." — a customer.';

describe('Content Intake — every source maps into ONE canonical document', () => {
  it('all four sources produce the identical document shape', () => {
    sameShape(fromExistingContent(CONTENT));
    sameShape(fromAiContent(CONTENT, { description: 'announce launch' }));
    sameShape(fromVoiceTranscript(CONTENT));
    sameShape(fromWriterDocument({ id: 'w1', title: 'X', body: CONTENT }));
  });

  it('tags the source but routes identical content to an IDENTICAL architecture input', () => {
    const a = fromExistingContent(CONTENT);
    const b = fromVoiceTranscript(CONTENT);
    expect(a.source).toBe('existing');
    expect(b.source).toBe('voice');
    // Same underlying content → byte-identical Content Architecture input.
    expect(intakeToArchitectureBody(a)).toBe(intakeToArchitectureBody(b));
    expect(intakeToArchitectureBody(a)).toContain('92% faster');
  });

  it('changing source changes ONLY provenance, not the processing input', () => {
    const sources: ContentSource[] = ['existing', 'voice'];
    const bodies = sources.map((s) => (s === 'existing' ? fromExistingContent(CONTENT) : fromVoiceTranscript(CONTENT)));
    expect(new Set(bodies.map(intakeToArchitectureBody)).size).toBe(1); // one identical input
    expect(new Set(bodies.map((d) => d.source)).size).toBe(2);          // distinct provenance
  });

  it('Writer documents preserve ALL metadata (no information loss)', () => {
    const doc = fromWriterDocument({
      id: 'blog-7', title: 'The Activation Playbook', content: CONTENT, summary: 'A short summary',
      keywords: ['activation', 'onboarding'], target_audience: ['executives'], campaign_objective: 'product_launch',
      tone: 'authoritative', seo: { metaTitle: 'Activation' }, references: ['https://a'], citations: ['https://b'],
    });
    expect(doc.writerDocumentId).toBe('blog-7');
    expect(doc.title).toBe('The Activation Playbook');
    expect(doc.summary).toBe('A short summary');
    expect(doc.keywords).toEqual(['activation', 'onboarding']);
    expect(doc.audience).toBe('executives');
    expect(doc.campaignGoal).toBe('product_launch');
    expect(doc.tone).toBe('authoritative');
    expect(doc.references).toEqual(['https://a', 'https://b']);
    expect((doc.metadata as any).seo).toEqual({ metaTitle: 'Activation' });
    // Title + summary fold into the architecture input (continuity into the engine).
    const arch = intakeToArchitectureBody(doc);
    expect(arch).toContain('The Activation Playbook');
    expect(arch).toContain('A short summary');
    expect(arch).toContain('activation, onboarding');
  });

  it('AI content carries the brief metadata', () => {
    const doc = fromAiContent('Generated body', { description: 'Launch our new API', audience: 'developers', platform: 'linkedin', campaignObjective: 'product_launch', keywords: 'api, launch', tone: 'bold', referenceUrl: 'https://docs' });
    expect(doc.source).toBe('ai');
    expect(doc.audience).toBe('developers');
    expect(doc.platform).toBe('linkedin');
    expect(doc.campaignGoal).toBe('product_launch');
    expect(doc.keywords).toEqual(['api', 'launch']);
    expect(doc.references).toEqual(['https://docs']);
  });

  it('is deterministic + provides editor summary metadata', () => {
    const d = fromExistingContent(CONTENT, { campaignGoal: 'awareness' });
    expect(intakeToArchitectureBody(d)).toBe(intakeToArchitectureBody(fromExistingContent(CONTENT, { campaignGoal: 'awareness' })));
    const desc = describeIntake(d);
    expect(desc.source).toBe('Existing Content');
    expect(desc.wordCount).toBeGreaterThan(0);
    expect(desc.hasMetadata).toBe(true);
    expect(intakeSourceLabel('writer')).toBe('Writer Library');
  });
});
