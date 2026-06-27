import {
  fromExistingContent, fromVoiceTranscript, fromWriterDocument, fromAiContent, intakeToArchitectureBody,
} from '../../../lib/creator-templates/contentIntake';
import {
  createPackage, addIntakeSource, removeSource, mergePackage, packageToArchitectureBody,
  recordRevision, undo, restoreRevision, applyAiResult, describePackage,
  type ContentPackage,
} from '../../../lib/creator-templates/contentPackage';

const AT = '2026-06-26T00:00:00.000Z';
const at = (n: number) => `2026-06-26T00:00:0${n}.000Z`;

function build(): ContentPackage {
  let p = createPackage('pkg-1');
  p = addIntakeSource(p, fromVoiceTranscript('Voice idea about onboarding.'), { id: 's-voice', createdAt: at(1), type: 'voice' });
  p = addIntakeSource(p, fromWriterDocument({ id: 'blog-7', title: 'Activation Playbook', content: 'Writer body. 92% faster activation.', summary: 'A summary', keywords: ['activation'], campaign_objective: 'product_launch', target_audience: ['executives'] }), { id: 's-writer', createdAt: at(2), type: 'writer' });
  p = addIntakeSource(p, fromExistingContent('Manual notes: focus on ROI.'), { id: 's-notes', createdAt: at(3), type: 'notes' });
  return p;
}

describe('Content Package — multi-source deterministic merge', () => {
  it('a single source merges to itself', () => {
    const p = addIntakeSource(createPackage('p'), fromExistingContent('Hello world content.'), { id: 's1', createdAt: AT });
    expect(p.mergedDocument.body).toBe('Hello world content.');
    expect(p.provenance).toEqual(['existing']);
  });

  it('merges multiple sources by PRIORITY (notes → writer → voice), appending', () => {
    const p = build();
    // notes (priority 1) first, then writer (2), then voice (6).
    expect(p.provenance).toEqual(['notes', 'writer:blog-7', 'voice']);
    const body = p.mergedDocument.body;
    expect(body.indexOf('Manual notes')).toBeLessThan(body.indexOf('Writer body'));
    expect(body.indexOf('Writer body')).toBeLessThan(body.indexOf('Voice idea'));
    // scalar metadata resolves by highest priority that has it (writer here).
    expect(p.campaignGoal).toBe('product_launch');
    expect(p.audience).toBe('executives');
    expect(p.writerDocuments).toEqual(['blog-7']);
    expect(p.keywords).toContain('activation');
  });

  it('de-duplicates identical paragraphs; never overwrites', () => {
    let p = createPackage('p');
    p = addIntakeSource(p, fromExistingContent('Shared paragraph.'), { id: 'a', createdAt: at(1) });
    p = addIntakeSource(p, fromExistingContent('Shared paragraph.'), { id: 'b', createdAt: at(2) });
    expect(p.mergedDocument.body).toBe('Shared paragraph.'); // deduped, not doubled
  });

  it('Content Architecture consumes ONLY the merged document, deterministically', () => {
    const p1 = build(); const p2 = build();
    expect(packageToArchitectureBody(p1)).toBe(packageToArchitectureBody(p2)); // deterministic
    expect(packageToArchitectureBody(p1)).toBe(intakeToArchitectureBody(p1.mergedDocument));
    expect(packageToArchitectureBody(p1)).toContain('92% faster');
  });

  it('removing a source re-merges deterministically', () => {
    const p = removeSource(build(), 's-writer');
    expect(p.provenance).toEqual(['notes', 'voice']);
    expect(p.campaignGoal).toBeNull(); // writer was the only goal source
  });
});

describe('Content Package — history / undo / AI collaboration', () => {
  it('records revisions, undoes, and restores', () => {
    let p = build();
    const original = p.mergedDocument.body;
    p = applyAiResult(p, 'improve', 'AI-improved persuasive copy.', { id: 'ai-1', at: at(4) });
    expect(p.aiRevisions).toBe(1);
    expect(p.mergedDocument.body).toContain('AI-improved');
    expect(p.history.length).toBe(1);
    const undone = undo(p);
    expect(undone.mergedDocument.body).toBe(original); // back to pre-AI
    expect(restoreRevision(p, 0).mergedDocument.body).toBe(original);
  });

  it('AI ops update ONLY the package (added as an ai source, re-merged)', () => {
    const p = applyAiResult(build(), 'extract_statistics', '92% faster. 3x retention.', { id: 'ai-x', at: at(5) });
    expect(p.sources.some((s) => s.type === 'ai' && s.origin === 'ai:extract_statistics')).toBe(true);
    expect(p.mergedDocument.body).toContain('3x retention');
  });

  it('Writer + AI package summary is deterministic', () => {
    const p = applyAiResult(build(), 'rewrite', 'Rewritten.', { id: 'ai-2', at: at(6) });
    const d = describePackage(p);
    expect(d.sourceCount).toBe(4); // notes, writer, voice, ai
    expect(d.aiRevisions).toBe(1);
    expect(d.campaignGoal).toBe('product_launch');
    expect(d.wordCount).toBeGreaterThan(0);
  });

  it('the ContentIntakeDocument is reused as a source — backward compatible', () => {
    const intake = fromAiContent('Body', { description: 'Brief' });
    const p = addIntakeSource(createPackage('p'), intake, { id: 's', createdAt: AT });
    expect(p.sources[0]!.type).toBe('ai');
    expect(p.sources[0]!.body).toBe('Body');
  });
});
