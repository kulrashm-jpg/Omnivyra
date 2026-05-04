export type IntelligenceItemType = 'prompt' | 'gap' | 'expected_event';
export type ActionableItemType = 'prompt' | 'gap';
export type IntelligencePriority = 'high' | 'medium' | 'low';

export type PromptResponseRow = {
  id: string;
  unified_person_id: string | null;
  intelligence_gap_id: string;
  prompt_type: string;
  title: string;
  message: string;
  created_at: string;
};

export type GapResponseRow = {
  id: string;
  unified_person_id: string | null;
  expected_event_instance_id: string;
  gap_type: string;
  priority: IntelligencePriority;
  status?: string;
  detected_at: string;
  metadata: Record<string, unknown> | null;
};

export type ExpectedEventResponseRow = {
  id: string;
  unified_person_id: string | null;
  trigger_touchpoint_id: string;
  expected_event_type: string;
  due_at: string;
  status: string;
  created_at: string;
};

export type PendingInputItem = {
  type: IntelligenceItemType;
  id: string;
  title: string;
  description: string;
  priority: IntelligencePriority;
  unified_person_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};

export type DashboardGapItem = {
  id: string;
  gap_type: string;
  title: string;
  description: string;
  priority: IntelligencePriority;
  score: number;
  confidence: number | null;
  unified_person_id: string | null;
  detected_at: string;
  metadata: Record<string, unknown>;
};

export type ActionableIntelligenceItem = {
  id: string;
  type: ActionableItemType;
  title: string;
  description: string;
  priority: IntelligencePriority;
  confidence: number | null;
  score: number | null;
  unified_person_id: string | null;
  suggested_action: string;
};

const PRIORITY_RANK: Record<IntelligencePriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function safeNumber(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function humanize(value: string): string {
  return value
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function priorityForExpectedEvent(expectedEventType: string): IntelligencePriority {
  return expectedEventType.trim().toLowerCase() === 'revenue' ? 'high' : 'medium';
}

export function scoreFromMetadata(metadata: unknown): number {
  return safeNumber(normalizeMetadata(metadata).score) ?? 0;
}

export function confidenceFromMetadata(metadata: unknown): number | null {
  return safeNumber(normalizeMetadata(metadata).confidence);
}

export function gapTitle(gapType: string): string {
  if (gapType === 'missing_revenue') return 'Missing revenue data';
  if (gapType === 'missing_followup') return 'Missing follow-up';
  if (gapType === 'missing_conversion') return 'Missing conversion data';
  return humanize(gapType);
}

export function suggestedActionForGapType(gapType: string): string {
  if (gapType === 'missing_revenue') return 'Update revenue outcome';
  if (gapType === 'missing_followup') return 'Add follow-up status';
  if (gapType === 'missing_conversion') return 'Record conversion';
  return 'Update missing data';
}

export function gapDescription(gap: GapResponseRow): string {
  const metadata = normalizeMetadata(gap.metadata);
  const expectedEventType = String(metadata.expected_event_type ?? '').trim();
  if (expectedEventType) {
    return `Expected ${humanize(expectedEventType)} was not recorded.`;
  }
  return `${gapTitle(gap.gap_type)} needs attention.`;
}

export function sortPendingItems(left: PendingInputItem, right: PendingInputItem): number {
  const priorityDelta = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priorityDelta !== 0) return priorityDelta;

  const leftTime = Date.parse(left.created_at);
  const rightTime = Date.parse(right.created_at);
  return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
}

export function sortActionableItems(
  left: ActionableIntelligenceItem,
  right: ActionableIntelligenceItem
): number {
  const priorityDelta = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (priorityDelta !== 0) return priorityDelta;

  const scoreDelta = (right.score ?? 0) - (left.score ?? 0);
  if (scoreDelta !== 0) return scoreDelta;

  return (right.confidence ?? 0) - (left.confidence ?? 0);
}

export function mapPromptToPendingInput(
  prompt: PromptResponseRow,
  gapById: Map<string, GapResponseRow>
): PendingInputItem {
  const gap = gapById.get(prompt.intelligence_gap_id);
  const gapMetadata = normalizeMetadata(gap?.metadata);
  const gapType = gap?.gap_type ?? null;

  return {
    type: 'prompt',
    id: prompt.id,
    title: prompt.title,
    description: prompt.message,
    priority: gap?.priority ?? 'medium',
    unified_person_id: prompt.unified_person_id,
    created_at: prompt.created_at,
    metadata: {
      prompt_type: prompt.prompt_type,
      intelligence_gap_id: prompt.intelligence_gap_id,
      gap_type: gapType,
      gap_status: gap?.status ?? null,
      expected_event_instance_id: gap?.expected_event_instance_id ?? null,
      score: gap ? scoreFromMetadata(gapMetadata) : null,
      confidence: gap ? confidenceFromMetadata(gapMetadata) : null,
      suggested_action: gapType ? suggestedActionForGapType(gapType) : 'Update missing data',
    },
  };
}

export function mapGapToPendingInput(gap: GapResponseRow): PendingInputItem {
  return {
    type: 'gap',
    id: gap.id,
    title: gapTitle(gap.gap_type),
    description: gapDescription(gap),
    priority: gap.priority,
    unified_person_id: gap.unified_person_id,
    created_at: gap.detected_at,
    metadata: {
      ...normalizeMetadata(gap.metadata),
      gap_type: gap.gap_type,
      expected_event_instance_id: gap.expected_event_instance_id,
      score: scoreFromMetadata(gap.metadata),
      confidence: confidenceFromMetadata(gap.metadata),
      suggested_action: suggestedActionForGapType(gap.gap_type),
    },
  };
}

export function mapExpectedEventToPendingInput(event: ExpectedEventResponseRow): PendingInputItem {
  const eventName = humanize(event.expected_event_type);
  return {
    type: 'expected_event',
    id: event.id,
    title: `Expected ${eventName} not completed`,
    description: `Expected ${eventName} was not completed by its due time.`,
    priority: priorityForExpectedEvent(event.expected_event_type),
    unified_person_id: event.unified_person_id,
    created_at: event.created_at,
    metadata: {
      expected_event_type: event.expected_event_type,
      trigger_touchpoint_id: event.trigger_touchpoint_id,
      due_at: event.due_at,
      status: event.status,
    },
  };
}

export function mapGapToDashboardGap(gap: GapResponseRow): DashboardGapItem {
  return {
    id: gap.id,
    gap_type: gap.gap_type,
    title: gapTitle(gap.gap_type),
    description: gapDescription(gap),
    priority: gap.priority,
    score: scoreFromMetadata(gap.metadata),
    confidence: confidenceFromMetadata(gap.metadata),
    unified_person_id: gap.unified_person_id,
    detected_at: gap.detected_at,
    metadata: {
      ...normalizeMetadata(gap.metadata),
      gap_type: gap.gap_type,
      expected_event_instance_id: gap.expected_event_instance_id,
      suggested_action: suggestedActionForGapType(gap.gap_type),
    },
  };
}

export function mapPendingInputToActionableItem(
  item: PendingInputItem
): ActionableIntelligenceItem | null {
  if (item.type !== 'prompt' && item.type !== 'gap') {
    return null;
  }

  const metadata = normalizeMetadata(item.metadata);
  const gapType = String(metadata.gap_type ?? '').trim();

  return {
    id: item.id,
    type: item.type,
    title: item.title,
    description: item.description,
    priority: item.priority,
    confidence: confidenceFromMetadata(metadata),
    score: safeNumber(metadata.score),
    unified_person_id: item.unified_person_id,
    suggested_action:
      typeof metadata.suggested_action === 'string' && metadata.suggested_action.trim()
        ? metadata.suggested_action.trim()
        : suggestedActionForGapType(gapType),
  };
}
