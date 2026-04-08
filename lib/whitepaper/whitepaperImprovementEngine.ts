import {
  improveContentDraft,
  type ImproveBlogDraftInput,
  type ImproveBlogDraftOutput,
} from '../content/contentImprovementEngine';

export type ImproveWhitepaperDraftInput =
  Omit<ImproveBlogDraftInput, 'context'> & {
    context?: Omit<NonNullable<ImproveBlogDraftInput['context']>, 'contentType'> & {
      contentType?: 'whitepaper';
    };
  };

export type ImproveWhitepaperDraftOutput = ImproveBlogDraftOutput;

export async function improveWhitepaperDraft(
  input: ImproveWhitepaperDraftInput,
): Promise<ImproveWhitepaperDraftOutput> {
  return improveContentDraft({
    ...input,
    context: {
      ...input.context,
      contentType: 'whitepaper',
    },
  });
}

