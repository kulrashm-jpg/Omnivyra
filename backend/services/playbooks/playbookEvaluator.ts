import type { EngagementPlaybook } from './playbookTypes';

type EventContext = {
  platform: string;
  content_type: string;
  intent_scores: Record<string, number>;
  sentiment: 'positive' | 'neutral' | 'negative';
  user_type: 'first_time_user' | 'influencer_user' | 'spam_user' | 'regular_user';
};

type PlaybookDecision = {
  allowed_actions: Array<'reply' | 'like' | 'follow' | 'share' | 'dm'>;
  requires_approval: boolean;
  execution_mode: 'api' | 'rpa' | 'manual';
  tone: EngagementPlaybook['tone'];
};

type EvaluationResult = {
  primary_playbook: EngagementPlaybook | null;
  secondary_playbook: EngagementPlaybook | null;
  primary_playbook_id: string | null;
  secondary_playbook_id: string | null;
  conflict_resolution_reason: string | null;
  decision: PlaybookDecision;
};

const normalizeValue = (value?: string | null) => (value || '').toString().trim().toLowerCase();

const inScope = (value: string, list: string[]) =>
  list.map((entry) => normalizeValue(entry)).includes(normalizeValue(value));

const selectPrimarySecondary = (intentScores: Record<string, number>) => {
  const entries = Object.entries(intentScores || {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return { primary: null, secondary: null };
  const [primaryIntent, primaryScore] = entries[0];
  const secondary = entries[1];
  if (primaryScore < 0.6) {
    return { primary: null, secondary: null };
  }
  if (secondary && Math.abs(primaryScore - secondary[1]) <= 0.1) {
    return { primary: primaryIntent, secondary: secondary[0] };
  }
  return { primary: primaryIntent, secondary: null };
};

const buildAllowedActions = (playbook: EngagementPlaybook | null) => {
  if (!playbook) return [];
  const rules = playbook.action_rules;
  const allowed: Array<'reply' | 'like' | 'follow' | 'share' | 'dm'> = [];
  if (rules.allow_reply) allowed.push('reply');
  if (rules.allow_like) allowed.push('like');
  if (rules.allow_follow) allowed.push('follow');
  if (rules.allow_share) allowed.push('share');
  if (rules.allow_dm) allowed.push('dm');
  return allowed;
};

const resolveExecutionMode = (playbook: EngagementPlaybook | null) => {
  if (!playbook) return 'manual';
  const modes = playbook.execution_modes;
  if (modes.manual_only) return 'manual';
  if (modes.api_allowed) return 'api';
  if (modes.rpa_allowed) return 'rpa';
  return 'manual';
};

const resolveApprovalRequirement = (playbook: EngagementPlaybook | null, context: EventContext) => {
  if (!playbook) return true;
  if (context.user_type === 'influencer_user') {
    return playbook.user_rules.influencer_user === 'require_approval';
  }
  if (context.user_type === 'spam_user') return true;
  if (context.sentiment === 'negative') {
    return playbook.user_rules.negative_sentiment === 'escalate';
  }
  if (context.user_type === 'first_time_user') {
    return playbook.user_rules.first_time_user !== 'must_reply';
  }
  return !playbook.automation_rules.auto_execute_low_risk;
};

const hasSafetyOverrides = (playbook: EngagementPlaybook | null) => {
  if (!playbook?.safety) return false;
  if (playbook.safety.block_urls) return true;
  if (playbook.safety.block_sensitive_topics) return true;
  if (Array.isArray(playbook.safety.prohibited_words) && playbook.safety.prohibited_words.length > 0) {
    return true;
  }
  return false;
};

const mergeDecision = (
  primary: PlaybookDecision,
  secondary: PlaybookDecision | null,
  conflictPolicy: EngagementPlaybook['conflict_policy'] | null,
  safetyOverride: boolean
): { decision: PlaybookDecision; reason: string | null } => {
  if (!secondary) return { decision: primary, reason: null };
  if (safetyOverride) {
    return { decision: primary, reason: 'safety_override' };
  }
  if (conflictPolicy?.primary_wins !== false) {
    return { decision: primary, reason: 'primary_wins' };
  }
  return {
    decision: {
      allowed_actions: Array.from(
        new Set([...(primary.allowed_actions || []), ...(secondary.allowed_actions || [])])
      ),
      requires_approval: primary.requires_approval || secondary.requires_approval,
      execution_mode: primary.execution_mode || secondary.execution_mode,
      tone: primary.tone || secondary.tone,
    },
    reason: 'merged_by_policy',
  };
};

export const evaluatePlaybookForEvent = (
  eventContext: EventContext,
  playbooks: EngagementPlaybook[]
): EvaluationResult => {
  const { primary, secondary } = selectPrimarySecondary(eventContext.intent_scores);
  const eligible = playbooks.filter((playbook) => {
    if (!playbook?.scope) return false;
    const platformMatch = inScope(eventContext.platform, playbook.scope.platforms || []);
    const contentMatch = inScope(eventContext.content_type, playbook.scope.content_types || []);
    const intentMatch = inScope(primary || '', playbook.scope.intents || []);
    return platformMatch && contentMatch && intentMatch;
  });

  const primaryPlaybook =
    eligible.find((playbook) => inScope(primary || '', playbook.scope.intents || [])) || null;
  const secondaryPlaybookCandidate =
    secondary && eligible.find((playbook) => inScope(secondary, playbook.scope.intents || [])) || null;
  const conflictPolicy = primaryPlaybook?.conflict_policy || null;
  const secondaryAllowed =
    secondaryPlaybookCandidate &&
    (conflictPolicy?.max_secondary_playbooks ?? 1) >= 1;
  const secondaryPlaybook = secondaryAllowed ? secondaryPlaybookCandidate : null;

  const primaryDecision: PlaybookDecision = {
    allowed_actions: buildAllowedActions(primaryPlaybook),
    requires_approval: resolveApprovalRequirement(primaryPlaybook, eventContext),
    execution_mode: resolveExecutionMode(primaryPlaybook),
    tone: primaryPlaybook?.tone || {
      style: 'professional',
      emoji_allowed: false,
      max_length: 280,
    },
  };

  const secondaryDecision: PlaybookDecision | null = secondaryPlaybook
    ? {
        allowed_actions: buildAllowedActions(secondaryPlaybook),
        requires_approval: resolveApprovalRequirement(secondaryPlaybook, eventContext),
        execution_mode: resolveExecutionMode(secondaryPlaybook),
        tone: secondaryPlaybook.tone,
      }
    : null;

  const safetyOverride = hasSafetyOverrides(primaryPlaybook) || hasSafetyOverrides(secondaryPlaybook);
  const merged = mergeDecision(primaryDecision, secondaryDecision, conflictPolicy, safetyOverride);

  return {
    primary_playbook: primaryPlaybook,
    secondary_playbook: secondaryPlaybook,
    primary_playbook_id: primaryPlaybook?.id || null,
    secondary_playbook_id: secondaryPlaybook?.id || null,
    conflict_resolution_reason: merged.reason,
    decision: merged.decision,
  };
};
