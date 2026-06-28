import {
  freshSyncState, markManual, editorLeadValue, deriveTopicFromEditor,
  planBriefEditorSync, type BriefEditorSyncState,
} from '../../../lib/content/creatorBriefEditorSync';
import type { CreatorTemplate } from '../../../lib/creator-templates';
import type { TemplateFieldValues } from '../../../lib/creator-templates/values';

const slideTpl = { formDefinition: { fields: [], slides: { fields: [{ key: 'title' }, { key: 'body' }] } } } as unknown as CreatorTemplate;
const flatTpl = { formDefinition: { fields: [{ key: 'headline' }] } } as unknown as CreatorTemplate;
const vals = (v: Partial<TemplateFieldValues>): TemplateFieldValues => ({ fields: {}, ...v });

describe('creatorBriefEditorSync — canonical state machine', () => {
  it('fresh state is never_synced on both endpoints', () => {
    expect(freshSyncState()).toEqual({ topic: 'never_synced', lead: 'never_synced' });
  });

  it('Editor → Brief: empty topic auto-fills from the lead slide title; marks topic auto_synced', () => {
    const plan = planBriefEditorSync({ template: slideTpl, topic: '', values: vals({ slides: [{ title: 'Growth playbook', body: '' }] }), state: freshSyncState(), hasTopicField: true });
    expect(plan.topicWrite).toBe('Growth playbook');
    expect(plan.nextState.topic).toBe('auto_synced');
    expect(plan.editorWrite).toBeUndefined();
  });

  it('respects an intentional CLEAR: manually_modified topic is never auto-refilled', () => {
    const state: BriefEditorSyncState = { topic: 'manually_modified', lead: 'never_synced' };
    const plan = planBriefEditorSync({ template: slideTpl, topic: '', values: vals({ slides: [{ title: 'X', body: '' }] }), state, hasTopicField: true });
    expect(plan.topicWrite).toBeUndefined();
    expect(plan.nextState).toBe(state);
  });

  it('Brief → Editor: topic seeds an empty lead slide title; marks lead auto_synced', () => {
    const plan = planBriefEditorSync({ template: slideTpl, topic: 'My topic', values: vals({ slides: [{ title: '', body: '' }] }), state: freshSyncState(), hasTopicField: true });
    expect(plan.editorWrite?.slides?.[0].title).toBe('My topic');
    expect(plan.nextState.lead).toBe('auto_synced');
    expect(plan.topicWrite).toBeUndefined();
  });

  it('respects a cleared lead: manually_modified lead is never re-seeded', () => {
    const state: BriefEditorSyncState = { topic: 'never_synced', lead: 'manually_modified' };
    const plan = planBriefEditorSync({ template: slideTpl, topic: 'My topic', values: vals({ slides: [{ title: '', body: '' }] }), state, hasTopicField: true });
    expect(plan.editorWrite).toBeUndefined();
    expect(plan.nextState).toBe(state);
  });

  it('empty-only: a filled lead is never overwritten', () => {
    const plan = planBriefEditorSync({ template: slideTpl, topic: 'My topic', values: vals({ slides: [{ title: 'Authored', body: '' }] }), state: freshSyncState(), hasTopicField: true });
    expect(plan.editorWrite).toBeUndefined();
    expect(plan.topicWrite).toBeUndefined();
  });

  it('no topic brief field → no sync at all', () => {
    const plan = planBriefEditorSync({ template: slideTpl, topic: '', values: vals({ slides: [{ title: 'X', body: '' }] }), state: freshSyncState(), hasTopicField: false });
    expect(plan.topicWrite).toBeUndefined();
    expect(plan.editorWrite).toBeUndefined();
  });

  it('derive source order title → body → section → flat, capped at 120 chars', () => {
    expect(deriveTopicFromEditor(slideTpl, vals({ slides: [{ title: '', body: 'from body' }] }))).toBe('from body');
    expect(deriveTopicFromEditor(flatTpl, vals({ fields: { headline: 'flat headline' } }))).toBe('flat headline');
    const long = 'a'.repeat(200);
    expect(deriveTopicFromEditor(slideTpl, vals({ slides: [{ title: long, body: '' }] })).length).toBe(120);
  });

  it('editorLeadValue reads slide title (slide templates) or flat headline (flat templates)', () => {
    expect(editorLeadValue(slideTpl, vals({ slides: [{ title: ' Lead ', body: '' }] }))).toBe('Lead');
    expect(editorLeadValue(flatTpl, vals({ fields: { headline: 'H' } }))).toBe('H');
  });

  it('markManual is idempotent and endpoint-scoped', () => {
    const s = markManual(freshSyncState(), 'topic');
    expect(s.topic).toBe('manually_modified');
    expect(s.lead).toBe('never_synced');
    expect(markManual(s, 'topic')).toBe(s); // same ref when already manual
  });

  it('converges in two passes: editor→brief then brief→editor, then stops', () => {
    let state = freshSyncState();
    let topic = '';
    let v = vals({ slides: [{ title: '', body: 'Seed copy' }] });
    const p1 = planBriefEditorSync({ template: slideTpl, topic, values: v, state, hasTopicField: true });
    topic = p1.topicWrite ?? topic; state = p1.nextState;            // topic now 'Seed copy'
    const p2 = planBriefEditorSync({ template: slideTpl, topic, values: v, state, hasTopicField: true });
    v = p2.editorWrite ?? v; state = p2.nextState;                   // slide title seeded
    const p3 = planBriefEditorSync({ template: slideTpl, topic, values: v, state, hasTopicField: true });
    expect(p3.topicWrite).toBeUndefined();
    expect(p3.editorWrite).toBeUndefined();                          // converged
  });
});
