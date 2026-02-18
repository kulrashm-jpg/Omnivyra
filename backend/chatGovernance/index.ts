/**
 * Chat Governance — global and domain-specific layers.
 *
 * Layer 1 (Global): Abuse, gibberish, length — applies to all chat.
 * Layer 2 (Domain): Q&A state, next question, answer completeness — per context.
 */

export { validateUserMessage, validateAndModerateUserMessage } from './GlobalChatPolicy';
export type { GlobalPolicyResult } from './types';

export { computeCampaignPlanningQAState } from './CampaignPlanningQAState';
export type { GatherItem } from './CampaignPlanningQAState';

export type { ChatMessage, QAState } from './types';
