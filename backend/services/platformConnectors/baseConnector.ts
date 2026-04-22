import type { CommunityAiAction } from '../communityAiActionExecutor';

export type ExecutionResult = {
  success: boolean;
  /** Best-effort platform-native identifier of the created resource
   *  (comment id, reply id, tweet id, upvote id). When absent, the UI falls
   *  back to a confirmation without an id reference. Never invented. */
  platform_id?: string | null;
  /** Raw platform response for audit / debugging. */
  platform_response?: object;
  error?: string;
};

export interface PlatformConnector {
  executeAction: (action: CommunityAiAction, authToken: string) => Promise<ExecutionResult>;
}
