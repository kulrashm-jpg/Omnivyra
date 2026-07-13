import type { BlogGenerationRequest, BlogGenerationResult } from '../blog/runBlogGeneration';
import type { ManagedContentType } from './contentTemplateRegistry';
import { runUnifiedLongFormGeneration } from './unifiedLongFormEngine';
// PMF-003 — reversible platform-runtime wiring (default legacy → unchanged).
import { shouldRunPlatform } from '../../backend/services/longFormCapability/longFormMigrationFlag';
import { runLongFormCapability } from '../../backend/services/longFormCapability/longFormPlatformRuntime';

export type ManagedGenerationRequest = BlogGenerationRequest;
export type ManagedGenerationResult = BlogGenerationResult;

export async function runManagedContentGeneration(
  input: ManagedGenerationRequest,
  contentType: Extract<ManagedContentType, 'blog' | 'article' | 'guide' | 'story' | 'whitepaper'>,
): Promise<ManagedGenerationResult> {
  // The exact engine request (single source — used by both legacy and platform paths).
  const engineRequest = {
    ...input,
    contentType,
    formatType: typeof input.formatType === 'string' ? input.formatType : undefined,
    templateBlocks: input.template_blocks,
    targetWordCount: input.answers?.target_word_count
      ? Number.parseInt(String(input.answers.target_word_count), 10) || undefined
      : input.target_words,
  };

  // PMF-003 — platform path (flag-gated). The engine performs the inference inside
  // the AIC pipeline; the exact engine result is served (parity), with a safety net
  // to the engine directly. Default 'legacy' leaves behavior byte-identical.
  if (shouldRunPlatform()) {
    return runLongFormCapability({ engineContentType: contentType, engineRequest, companyId: input.company_id }) as Promise<ManagedGenerationResult>;
  }

  return runUnifiedLongFormGeneration(engineRequest);
}
