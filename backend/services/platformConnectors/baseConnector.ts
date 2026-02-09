import type { CommunityAiAction } from '../communityAiActionExecutor';

export type ExecutionResult = {
  success: boolean;
  platform_response?: object;
  error?: string;
};

export interface PlatformConnector {
  executeAction: (action: CommunityAiAction, authToken: string) => Promise<ExecutionResult>;
}
