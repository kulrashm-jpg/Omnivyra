/**
 * PR 2 — content-driven template filling: the ONE content source.
 *
 * Both entry points (a Writer launch and the Unified Workspace brief) resolve
 * into one CreatorBrief; the Writer wins when both exist; the user's edits to
 * the main message / viewer action override what the brief seeded.
 */
import {
  creatorBriefAssistContext,
  creatorBriefToEditorAnswers,
  deriveMainMessage,
  effectiveCreatorBrief,
  fitMainMessage,
  resolveCreatorBrief,
  resolveCreatorBriefFromWorkspace,
  resolveCreatorBriefFromWriter,
  sanitizeCreatorBrief,
  type CreatorBrief,
} from '../../../lib/creator-content/creatorBrief';
import type { WriterCreatorSourcePayload } from '../../../lib/content/writerCreatorAssetLaunch';

const workspace = {
  goalId: null,
  freeText: 'Teams publish a week of content in one afternoon. Busy founders get their evenings back. Start free today.',
  audience: 'Busy SaaS founders',
  tone: 'Confident and friendly',
  cta: 'Start free',
  offer: 'Omnivyra Scheduler',
};

const writer = {
  id: 'w1', sourceType: 'post', sourceId: 'p1',
  title: 'Your content calendar, done by lunch',
  body: 'Most teams lose Mondays to planning.\nOmnivyra plans the week for you in 20 minutes.',
  audience: 'Marketing leads', tone: 'Bold',
  compositionIntent: { assetType: 'supporting_image', attachmentMode: 'embedded_copy' },
  createdAt: 'T',
} as unknown as WriterCreatorSourcePayload;

describe('brief resolution — workspace', () => {
  it('maps the conversational brief: first sentence is the main message, the whole text is the body', () => {
    const b = resolveCreatorBriefFromWorkspace(workspace)!;
    expect(b.source).toBe('workspace');
    expect(b.mainMessage).toBe('Teams publish a week of content in one afternoon.');
    expect(b.body).toBe(workspace.freeText);
    // Tone and offer are no longer dropped.
    expect(b.tone).toBe('Confident and friendly');
    expect(b.offer).toBe('Omnivyra Scheduler');
    expect(b.cta).toBe('Start free');
    expect(b.audience).toBe('Busy SaaS founders');
  });

  it('falls back to the offer when there is no free text', () => {
    const b = resolveCreatorBriefFromWorkspace({ goalId: null, offer: 'Spring sale' })!;
    expect(b.mainMessage).toBe('Spring sale');
  });

  it('an empty brief resolves to nothing (no content → legacy behaviour)', () => {
    expect(resolveCreatorBriefFromWorkspace({ goalId: null })).toBeNull();
    expect(resolveCreatorBriefFromWorkspace(null)).toBeNull();
  });
});

describe('brief resolution — writer', () => {
  it('the post title is the main message; the post body is the body', () => {
    const b = resolveCreatorBriefFromWriter(writer)!;
    expect(b.source).toBe('writer');
    expect(b.mainMessage).toBe('Your content calendar, done by lunch');
    expect(b.body).toContain('Omnivyra plans the week for you in 20 minutes.');
    expect(b.audience).toBe('Marketing leads');
    expect(b.tone).toBe('Bold');
  });

  it('untitled post → first sentence of the body', () => {
    const b = resolveCreatorBriefFromWriter({ ...writer, title: '' } as WriterCreatorSourcePayload)!;
    expect(b.mainMessage).toBe('Most teams lose Mondays to planning.');
  });

  it('CRITICAL: an explicit Writer launch wins over a workspace brief', () => {
    expect(resolveCreatorBrief({ writerSource: writer, workspaceBrief: workspace })!.source).toBe('writer');
    expect(resolveCreatorBrief({ writerSource: null, workspaceBrief: workspace })!.source).toBe('workspace');
    expect(resolveCreatorBrief({})).toBeNull();
  });
});

describe('sanitize + effective brief', () => {
  it('caps every field and accepts snake_case', () => {
    const b = sanitizeCreatorBrief({ main_message: 'x'.repeat(900), body: 'y'.repeat(9000), source: 'writer', tone: 't'.repeat(500) })!;
    expect(b.mainMessage).toHaveLength(300);
    expect(b.body).toHaveLength(6000);
    expect(b.tone).toHaveLength(120);
    expect(b.source).toBe('writer');
  });

  it('rejects junk and briefs without content', () => {
    expect(sanitizeCreatorBrief(null)).toBeNull();
    expect(sanitizeCreatorBrief('str')).toBeNull();
    expect(sanitizeCreatorBrief([])).toBeNull();
    expect(sanitizeCreatorBrief({ audience: 'only audience' })).toBeNull();
  });

  it('an EDITED main-message answer overrides the seeded one; an unedited answer does not', () => {
    const b = resolveCreatorBriefFromWorkspace(workspace)!;
    const answers = { keyMessage: 'My own words', cta: 'Book a demo' };
    expect(effectiveCreatorBrief(b, answers, new Set())!.mainMessage).toBe(b.mainMessage);
    const eff = effectiveCreatorBrief(b, answers, new Set(['keyMessage', 'cta']))!;
    expect(eff.mainMessage).toBe('My own words');
    expect(eff.cta).toBe('Book a demo');
  });
});

describe('fitting the main message into a field', () => {
  it('verbatim when it fits (trailing period dropped)', () => {
    expect(fitMainMessage('Ship faster.', 80)).toEqual({ value: 'Ship faster', exact: true });
  });
  it('first clause, then word boundary — never mid-word — and flagged inexact', () => {
    const r = fitMainMessage('Teams publish a week of content, and get their evenings back for good', 40);
    expect(r.exact).toBe(false);
    expect(r.value).toBe('Teams publish a week of content');
    const w = fitMainMessage('Supercalifragilistic expialidocious wonderful', 30);
    expect(w.value.length).toBeLessThanOrEqual(30);
    expect(w.value.endsWith(' ')).toBe(false);
  });
  it('deriveMainMessage ignores URLs', () => {
    expect(deriveMainMessage('https://x.y/z Launch day is here! More soon.')).toBe('Launch day is here!');
  });
});

describe('the brief travels whole to field assist', () => {
  it('carries main message, body, audience, tone, cta, offer, objective', () => {
    const ctx = creatorBriefAssistContext(resolveCreatorBriefFromWorkspace(workspace));
    expect(ctx).toMatchObject({
      main_message: 'Teams publish a week of content in one afternoon.',
      source_content: workspace.freeText,
      audience: 'Busy SaaS founders',
      tone: 'Confident and friendly',
      cta: 'Start free',
      offer: 'Omnivyra Scheduler',
    });
    expect(creatorBriefAssistContext(null)).toEqual({});
  });

  it('a restored brief seeds only the form fields this asset has', () => {
    const b = { mainMessage: 'M', body: 'B', audience: 'A', tone: '', cta: 'C', offer: '', objective: '', source: 'workspace' } as CreatorBrief;
    expect(creatorBriefToEditorAnswers(b, new Set(['topic', 'keyMessage', 'audience']))).toEqual({ topic: 'M', keyMessage: 'M', audience: 'A' });
  });
});
