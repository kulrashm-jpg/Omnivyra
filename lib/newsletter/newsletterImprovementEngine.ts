import {
  improveContentDraft,
  type ImproveContentDraftInput,
  type ImproveContentDraftOutput,
} from '../content/contentImprovementEngine';

export type ImproveNewsletterDraftInput =
  Omit<ImproveContentDraftInput, 'context'> & {
    context?: Omit<NonNullable<ImproveContentDraftInput['context']>, 'contentType'> & {
      contentType?: 'newsletter';
    };
  };

export type ImproveNewsletterDraftOutput = ImproveContentDraftOutput;

export async function improveNewsletterDraft(
  input: ImproveNewsletterDraftInput,
): Promise<ImproveNewsletterDraftOutput> {
  return improveContentDraft({
    ...input,
    context: {
      ...input.context,
      contentType: 'newsletter',
    },
  });
}
