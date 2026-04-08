import {
  improveContentDraft,
  type ImproveBlogDraftInput,
  type ImproveBlogDraftOutput,
} from '../content/contentImprovementEngine';

export type ImproveGuideDraftInput =
  Omit<ImproveBlogDraftInput, 'context'> & {
    context?: Omit<NonNullable<ImproveBlogDraftInput['context']>, 'contentType'> & {
      contentType?: 'guide';
    };
  };

export type ImproveGuideDraftOutput = ImproveBlogDraftOutput;

export async function improveGuideDraft(
  input: ImproveGuideDraftInput,
): Promise<ImproveGuideDraftOutput> {
  return improveContentDraft({
    ...input,
    context: {
      ...input.context,
      contentType: 'guide',
    },
  });
}

