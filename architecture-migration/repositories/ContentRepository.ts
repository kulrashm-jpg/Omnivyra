import type { ContentGenerationResult } from '../contracts/ContentGenerationContracts';
import type { RepositoryWriteResult } from '../contracts/RepositoryContracts';

export interface ContentRepository {
  saveGeneratedContent(result: ContentGenerationResult): Promise<RepositoryWriteResult>;
}
