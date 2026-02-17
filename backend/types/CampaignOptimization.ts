/**
 * Stage 36 — Structured Autonomous Optimization Proposals.
 * Advisory only. No automatic mutation.
 */

export interface OptimizationProposal {
  campaignId: string;
  summary: string;

  proposedDurationWeeks?: number;
  proposedPostsPerWeek?: number;
  proposedContentMixAdjustment?: Record<string, number>;
  proposedStartDateShift?: string;

  reasoning: string[];
  confidenceScore: number; // 0–100
}
