import type { RepositoryWriteResult } from '../contracts/RepositoryContracts';

export interface CommunityActionRepository {
  updateActionState(command: {
    actionId: string;
    organizationId: string;
    state: string;
    metadata?: Record<string, unknown>;
  }): Promise<RepositoryWriteResult>;
}
