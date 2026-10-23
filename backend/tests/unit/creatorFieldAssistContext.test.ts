import {
  advanceCreatorFieldAssistContext,
  type CreatorFieldAssistContext,
} from '../../../lib/creator-content/creatorFieldAssistContext';

function context(overrides: Partial<CreatorFieldAssistContext> = {}): CreatorFieldAssistContext {
  return {
    workflowType: 'carousel',
    companyId: 'company-a',
    activeTemplateId: 'template-a',
    routedTemplateId: 'template-a',
    answers: {},
    templateValues: {},
    writerSource: null,
    ...overrides,
  };
}

describe('creator field-assist context versioning', () => {
  it('keeps the revision for the same active context', () => {
    const initial = { revision: 0, context: context() };
    expect(advanceCreatorFieldAssistContext(initial, initial.context)).toBe(initial);
  });

  it.each([
    ['format', { workflowType: 'infographic' }],
    ['company', { companyId: 'company-b' }],
    ['active template', { activeTemplateId: 'template-b' }],
    ['routed template', { routedTemplateId: 'template-b' }],
    ['answers', { answers: {} }],
    ['template values', { templateValues: {} }],
    ['writer source', { writerSource: {} }],
  ])('invalidates an in-flight response when %s changes', (_label, changes) => {
    const initial = { revision: 3, context: context() };
    const next = advanceCreatorFieldAssistContext(initial, context(changes));
    expect(next.revision).toBe(4);
  });
});
