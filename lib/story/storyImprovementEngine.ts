import {
  improveContentDraft,
  type ImproveBlogDraftInput,
  type ImproveBlogDraftOutput,
} from '../content/contentImprovementEngine';

export type ImproveStoryDraftInput =
  Omit<ImproveBlogDraftInput, 'context'> & {
    context?: Omit<NonNullable<ImproveBlogDraftInput['context']>, 'contentType'> & {
      contentType?: 'story';
    };
  };

export type ImproveStoryDraftOutput = ImproveBlogDraftOutput;

export async function improveStoryDraft(
  input: ImproveStoryDraftInput,
): Promise<ImproveStoryDraftOutput> {
  return improveContentDraft({
    ...input,
    context: {
      ...input.context,
      contentType: 'story',
    },
  });
}

