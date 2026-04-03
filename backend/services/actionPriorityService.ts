type EffortLevel = 'low' | 'medium' | 'high';

export type PriorityType = 'quick_win' | 'high_impact' | 'strategic';

const PRIORITY_RANK: Record<PriorityType, number> = {
  quick_win: 0,
  high_impact: 1,
  strategic: 2,
};

export function classifyPriorityType(params: {
  impactScore?: number | null;
  effortLevel?: EffortLevel | null;
}): PriorityType {
  const impact = Number(params.impactScore ?? 0);
  const effort = params.effortLevel ?? 'medium';

  if (effort === 'low' && impact >= 45) return 'quick_win';
  if (impact >= 70 || (impact >= 60 && effort !== 'high')) return 'high_impact';
  return 'strategic';
}

export function describePriorityType(priorityType: PriorityType): string {
  switch (priorityType) {
    case 'quick_win':
      return 'Do this first because it combines meaningful upside with lower effort.';
    case 'high_impact':
      return 'Prioritize this because it has the strongest near-term commercial leverage.';
    case 'strategic':
      return 'Plan this as a foundational move that unlocks bigger gains over time.';
    default:
      return 'Prioritize this based on your current execution capacity.';
  }
}

export function comparePriorityType(
  left: { priorityType?: PriorityType | null; impactScore?: number | null },
  right: { priorityType?: PriorityType | null; impactScore?: number | null },
): number {
  const leftRank = PRIORITY_RANK[left.priorityType ?? 'strategic'];
  const rightRank = PRIORITY_RANK[right.priorityType ?? 'strategic'];
  if (leftRank !== rightRank) return leftRank - rightRank;
  return Number(right.impactScore ?? 0) - Number(left.impactScore ?? 0);
}

export function buildExpectedUpside(params: {
  priorityType?: PriorityType | null;
  impactScore?: number | null;
  actionType?: string | null;
  expectedOutcome?: string | null;
}): string {
  const priorityType = params.priorityType ?? 'strategic';
  const impactScore = Number(params.impactScore ?? 0);
  const actionType = String(params.actionType ?? '').toLowerCase();
  const expectedOutcome = String(params.expectedOutcome ?? '').trim();

  if (expectedOutcome) {
    if (priorityType === 'quick_win') {
      return `Near-term upside: ${expectedOutcome.charAt(0).toLowerCase()}${expectedOutcome.slice(1)}`;
    }
    if (priorityType === 'high_impact') {
      return `Commercial upside: ${expectedOutcome.charAt(0).toLowerCase()}${expectedOutcome.slice(1)}`;
    }
    return `Strategic upside: ${expectedOutcome.charAt(0).toLowerCase()}${expectedOutcome.slice(1)}`;
  }

  if (/(conversion|cta|lead|pricing|contact|demo|signup)/.test(actionType)) {
    return impactScore >= 70
      ? 'Expected upside: higher conversion from high-intent visitors and stronger pipeline efficiency.'
      : 'Expected upside: less funnel friction and better lead progression.';
  }

  if (/(content|seo|authority|aeo|geo)/.test(actionType)) {
    return impactScore >= 70
      ? 'Expected upside: more qualified discovery, stronger trust, and better demand capture.'
      : 'Expected upside: stronger discoverability and a more credible path to conversion.';
  }

  return priorityType === 'quick_win'
    ? 'Expected upside: a practical near-term gain with relatively low execution cost.'
    : priorityType === 'high_impact'
      ? 'Expected upside: meaningful improvement in traffic, conversion, or revenue potential.'
      : 'Expected upside: a stronger foundation for larger gains in future cycles.';
}
