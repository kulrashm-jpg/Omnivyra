import {
  runBlogGeneration,
  type BlogGenerationRequest,
  type BlogGenerationResult,
} from '../blog/runBlogGeneration';
import type { ManagedContentType } from './contentTemplateRegistry';

export type ManagedGenerationRequest = BlogGenerationRequest;
export type ManagedGenerationResult = BlogGenerationResult;

export async function runManagedContentGeneration(
  input: ManagedGenerationRequest,
  contentType: Extract<ManagedContentType, 'blog' | 'article' | 'guide' | 'story' | 'whitepaper'>,
): Promise<ManagedGenerationResult> {
  return runBlogGeneration({
    ...input,
    contentType,
  });
}
