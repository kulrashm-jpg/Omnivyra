export function getDisplayTopic(params: {
  recommendationContext?: { topic_from_card?: string | null } | null;
  lastCollectedPlanningContextFromApi?: Record<string, unknown> | null;
  prefilledPlanning?: Record<string, unknown> | null;
  collectedPlanningContext?: Record<string, unknown> | null;
  campaignData?: { name?: string | null } | null;
}) {
  const fromCard = params.recommendationContext?.topic_from_card;
  if (typeof fromCard === 'string' && fromCard.trim()) return fromCard.trim();
  const ctx = params.lastCollectedPlanningContextFromApi ?? params.prefilledPlanning ?? params.collectedPlanningContext;
  const keyMessages = (ctx as { key_messages?: string | string[] | null } | null)?.key_messages;
  if (typeof keyMessages === 'string' && keyMessages.trim()) {
    return keyMessages.trim().split(/\n/)[0]?.slice(0, 80) ?? '';
  }
  if (Array.isArray(keyMessages) && keyMessages.length > 0) {
    const first = typeof keyMessages[0] === 'string' ? keyMessages[0].trim() : '';
    return first ? first.slice(0, 80) : '';
  }
  return params.campaignData?.name || 'Campaign';
}
