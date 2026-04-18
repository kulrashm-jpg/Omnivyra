export type ThreadContinuationMode =
  | 'waiting_for_engagement'
  | 'engagement_driven'
  | 'manual_followup_due';

export type ThreadContinuationSummary = {
  mode: ThreadContinuationMode;
  label: string;
  description: string;
  deadlineLabel: string | null;
  canUseEngagement: boolean;
  shouldUseManual: boolean;
};

export type ThreadPublishStateSummary = {
  label: string;
  tone: 'slate' | 'blue' | 'green';
  description: string;
};

export type ThreadFollowUpOption = {
  value: 'deeper-breakdown' | 'objection-answer' | 'proof-sequence' | 'lesson-followup';
  label: string;
  description: string;
};

export type ThreadContinuationDraftInput = {
  topic: string;
  intentLabel: string;
  companyName: string;
  followUpDescription: string;
  contextNote?: string | null;
};

export const THREAD_FOLLOW_UP_OPTIONS: readonly ThreadFollowUpOption[] = [
  {
    value: 'deeper-breakdown',
    label: 'Go deeper on the same idea',
    description: 'Use the next thread to unpack one part of the original idea in more detail.',
  },
  {
    value: 'objection-answer',
    label: 'Answer the likely objection',
    description: 'Use the next thread to address resistance, confusion, or the question readers are likely to have.',
  },
  {
    value: 'proof-sequence',
    label: 'Support it with proof',
    description: 'Use the next thread to add examples, reasoning, or clearer evidence behind the original point.',
  },
  {
    value: 'lesson-followup',
    label: 'Turn it into lessons',
    description: 'Use the next thread to extract practical lessons, mistakes, or operating takeaways.',
  },
] as const;

function formatDeadline(value: Date): string {
  return value.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function deriveThreadContinuationSummary(input: {
  startedAt?: string | null;
  interactionDetected?: boolean;
}): ThreadContinuationSummary {
  const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
  const deadline = new Date(startedAt.getTime() + 2 * 24 * 60 * 60 * 1000);
  const now = new Date();

  if (input.interactionDetected) {
    return {
      mode: 'engagement_driven',
      label: 'Engagement-driven continuation',
      description: 'A real interaction exists, so the next thread step should be shaped by engagement rather than a blind manual follow-up.',
      deadlineLabel: null,
      canUseEngagement: true,
      shouldUseManual: false,
    };
  }

  if (now >= deadline) {
    return {
      mode: 'manual_followup_due',
      label: 'Manual follow-up is due',
      description: 'The 2-day observation window passed without meaningful interaction. Continue the thread manually so momentum does not stall.',
      deadlineLabel: formatDeadline(deadline),
      canUseEngagement: false,
      shouldUseManual: true,
    };
  }

  return {
    mode: 'waiting_for_engagement',
    label: 'Waiting for engagement',
    description: 'Give the thread a short observation window. If replies or interaction arrive, engagement-driven continuation should take over.',
    deadlineLabel: formatDeadline(deadline),
    canUseEngagement: false,
    shouldUseManual: false,
  };
}

export function deriveThreadPublishState(input: {
  scheduledPostId?: string | null;
  scheduledStatus?: string | null;
  platformPostId?: string | null;
  engagementLinked?: boolean;
}): ThreadPublishStateSummary {
  if (input.engagementLinked) {
    return {
      label: 'Engagement linked',
      tone: 'green',
      description: 'A live engagement thread is now attached to this published thread, so continuation can follow the actual conversation.',
    };
  }

  if (input.platformPostId) {
    return {
      label: 'Published and waiting',
      tone: 'blue',
      description: 'The thread has a real platform post id and is now waiting to see whether engagement should take over.',
    };
  }

  if (input.scheduledPostId || input.scheduledStatus === 'scheduled') {
    return {
      label: 'Scheduled',
      tone: 'slate',
      description: 'The thread is linked to a scheduled post, but it has not produced a publish identity yet.',
    };
  }

  return {
    label: 'Not linked yet',
    tone: 'slate',
    description: 'Schedule or publish the thread once so continuation can attach to the exact published thread later.',
  };
}

export function buildThreadContinuationDraft(input: ThreadContinuationDraftInput): string {
  const note = String(input.contextNote || '').trim() || input.followUpDescription;
  return [
    `Following up on the ${input.intentLabel.toLowerCase()} thread about ${input.topic}.`,
    note,
    `This next step should stay consistent with ${input.companyName} and keep the conversation moving naturally.`,
  ].join(' ');
}
