import { generateContent, type GenerateParams } from '../engine/generator';
import { formatGeneratedContent, type GeneratedContent } from '../engine/formatter';
import { sanitizeBlocks } from '../engine/sanitizer';
import { validateContentOrThrow } from './validateContent';

export type { GeneratedContent };

export async function generateContentPipeline(params: GenerateParams) {
  const aiOutput = await generateContent(params);
  const formatted = formatGeneratedContent({
    type: params.type,
    aiOutput,
    template: params.template,
  });
  const validated = validateContentOrThrow({
    type: params.type,
    blocks: formatted.blocks,
    state: 'draft',
  });

  const output: GeneratedContent = {
    blocks: sanitizeBlocks(validated.blocks),
    meta: formatted.meta,
  };

  if (!Array.isArray(output.blocks) || output.blocks.length === 0) {
    throw new Error('Invalid generation output: missing blocks.');
  }

  return output;
}

export const runContentPipeline = generateContentPipeline;
