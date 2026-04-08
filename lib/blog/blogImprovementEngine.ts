import {
  improveContentDraft,
  type ImproveBlogDraftInput,
  type ImproveBlogDraftOutput,
} from '../content/contentImprovementEngine';

export type ImproveBlogContentInput = ImproveBlogDraftInput;
export type ImproveBlogContentOutput = ImproveBlogDraftOutput;

export async function improveBlogContent(
  input: ImproveBlogContentInput,
): Promise<ImproveBlogContentOutput> {
  return improveContentDraft({
    ...input,
    context: {
      ...input.context,
      contentType: 'blog',
    },
  });
}

