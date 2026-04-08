import {
  improveContentDraft,
  type ImproveBlogDraftInput,
  type ImproveBlogDraftOutput,
} from '../content/contentImprovementEngine';

export type ImproveArticleDraftInput =
  Omit<ImproveBlogDraftInput, 'context'> & {
    context?: Omit<NonNullable<ImproveBlogDraftInput['context']>, 'contentType'> & {
      contentType?: 'article';
    };
  };

export type ImproveArticleDraftOutput = ImproveBlogDraftOutput;

export async function improveArticleDraft(
  input: ImproveArticleDraftInput,
): Promise<ImproveArticleDraftOutput> {
  return improveContentDraft({
    ...input,
    context: {
      ...input.context,
      contentType: 'article',
    },
  });
}

