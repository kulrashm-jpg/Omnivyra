/**
 * Lightweight creator instruction builder for CREATOR_REQUIRED / CONDITIONAL_AI slots.
 * Pure formatting from existing intent + content_type; no AI generation.
 */

export type ExecutionMode = 'AI_AUTOMATED' | 'CREATOR_REQUIRED' | 'CONDITIONAL_AI';

export interface CreatorInstruction {
  title: string;
  targetAudience?: string;
  objective?: string;
  keyMessage?: string;
  expectedOutcome?: string;
  formatHint?: string;
  executionChecklist?: string[];
}

function formatHintFromContentType(contentType: string): string | undefined {
  const t = String(contentType ?? '').trim().toLowerCase();
  if (t.includes('video') && !t.includes('reel') && !t.includes('short')) {
    return 'Record a short video covering the topic clearly.';
  }
  if (t.includes('carousel') || t.includes('slides') || t.includes('slide')) {
    return 'Prepare slides using a consistent template.';
  }
  if (t.includes('reel') || t.includes('short')) {
    return 'Create a short vertical video.';
  }
  if (t.includes('audio') || t.includes('podcast')) {
    return 'Record audio (e.g. podcast or voiceover) covering the topic.';
  }
  return undefined;
}

/** Execution checklist by content_type; only for CREATOR_REQUIRED or CONDITIONAL_AI. */
function executionChecklistFromContentType(
  content_type: string,
  execution_mode?: ExecutionMode | string | null
): string[] | undefined {
  if (
    execution_mode !== 'CREATOR_REQUIRED' &&
    execution_mode !== 'CONDITIONAL_AI'
  ) {
    return undefined;
  }
  const t = String(content_type ?? '').trim().toLowerCase();
  if (t.includes('video') && !t.includes('reel') && !t.includes('short')) {
    return [
      'Recommended duration: 30–60 seconds',
      'Orientation: Vertical (9:16) unless platform requires otherwise',
      'Structure: Hook → Insight → CTA',
    ];
  }
  if (t.includes('reel') || t.includes('short')) {
    return [
      'Hook within first 3 seconds',
      'Fast pacing and clear captions',
      'End with strong CTA',
    ];
  }
  if (t.includes('carousel') || t.includes('slides') || t.includes('slide') || t.includes('slideware')) {
    return [
      'Suggested slides: 5–7',
      'One idea per slide',
      'Final slide should contain CTA',
    ];
  }
  if (t.includes('audio') || t.includes('podcast')) {
    return [
      'Clear introduction and topic framing',
      'Maintain consistent audio quality',
      'End with summary or CTA',
    ];
  }
  return undefined;
}

export function buildCreatorInstruction(
  topic: string,
  intent: Record<string, unknown> | null | undefined,
  content_type: string,
  execution_mode?: ExecutionMode | string | null
): CreatorInstruction {
  const title = String(topic ?? '').trim() || 'Untitled';
  const obj = intent && typeof intent === 'object' ? intent : {};
  const targetAudience =
    typeof obj.target_audience === 'string' && obj.target_audience.trim()
      ? obj.target_audience.trim()
      : undefined;
  const objective =
    typeof obj.objective === 'string' && obj.objective.trim()
      ? obj.objective.trim()
      : undefined;
  const keyMessage =
    typeof obj.brief_summary === 'string' && obj.brief_summary.trim()
      ? obj.brief_summary.trim()
      : undefined;
  const expectedOutcome =
    typeof obj.outcome_promise === 'string' && obj.outcome_promise.trim()
      ? obj.outcome_promise.trim()
      : undefined;
  const formatHint = formatHintFromContentType(content_type);
  const executionChecklist = executionChecklistFromContentType(
    content_type,
    execution_mode
  );

  return {
    title,
    ...(targetAudience ? { targetAudience } : {}),
    ...(objective ? { objective } : {}),
    ...(keyMessage ? { keyMessage } : {}),
    ...(expectedOutcome ? { expectedOutcome } : {}),
    ...(formatHint ? { formatHint } : {}),
    ...(executionChecklist?.length ? { executionChecklist } : {}),
  };
}
