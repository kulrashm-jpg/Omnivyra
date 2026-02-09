import type { EngagementPlaybook } from './playbookTypes';

type ValidationAction = {
  action_type?: string | null;
  text?: string | null;
  execution_mode?: 'api' | 'rpa' | 'manual' | string | null;
  risk_level?: 'low' | 'medium' | 'high' | string | null;
  intent_classification?: { primary_intent?: string | null } | null;
};

type HistoryMetrics = {
  replies_last_hour?: number | null;
  follows_today?: number | null;
  actions_today?: number | null;
  networkActionsToday?: number | null;
};

type PlaybookValidationInput = Pick<
  EngagementPlaybook,
  | 'tone'
  | 'safety'
  | 'action_rules'
  | 'limits'
  | 'automation_rules'
  | 'automation_levels'
  | 'execution_modes'
>;

type NetworkEligibilityValidation = {
  valid: boolean;
  error?: string;
};

export const validateNetworkEligibilityConfig = (
  playbook?: Pick<EngagementPlaybook, 'network_eligibility'> | null
): NetworkEligibilityValidation => {
  const config = playbook?.network_eligibility;
  if (!config || config.enabled !== true) {
    return { valid: true };
  }
  if (!Array.isArray(config.allowed_classifications) || config.allowed_classifications.length === 0) {
    return { valid: false, error: 'network_eligibility.allowed_classifications is required' };
  }
  if (typeof config.max_new_users_per_day !== 'number' || config.max_new_users_per_day <= 0) {
    return { valid: false, error: 'network_eligibility.max_new_users_per_day must be > 0' };
  }
  if (Array.isArray(config.excluded_classifications) && config.excluded_classifications.length > 0) {
    const overlap = config.allowed_classifications.some((value) =>
      config.excluded_classifications?.includes(value as 'spam_risk')
    );
    if (overlap) {
      return { valid: false, error: 'network_eligibility has overlapping classifications' };
    }
  }
  return { valid: true };
};

const SENSITIVE_TOPICS = [
  'politics',
  'religion',
  'violence',
  'drugs',
  'terrorism',
  'self-harm',
  'hate',
  'sex',
];

const containsEmoji = (value: string) => /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(value);

const containsUrl = (value: string) => /https?:\/\//i.test(value) || /\bwww\./i.test(value);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const containsWord = (value: string, word: string) => {
  const trimmed = word.trim();
  if (!trimmed) return false;
  const pattern = new RegExp(`\\b${escapeRegExp(trimmed.toLowerCase())}\\b`, 'i');
  return pattern.test(value.toLowerCase());
};

const findFirstMatch = (value: string, words: string[]) =>
  words.find((word) => containsWord(value, word));

const actionRuleAllows = (actionType: string, rules: EngagementPlaybook['action_rules']) => {
  switch (actionType) {
    case 'reply':
      return rules.allow_reply;
    case 'like':
      return rules.allow_like;
    case 'follow':
      return rules.allow_follow;
    case 'share':
      return rules.allow_share;
    case 'dm':
      return rules.allow_dm;
    default:
      return false;
  }
};

export const validateActionAgainstPlaybook = (
  action: ValidationAction,
  playbook?: PlaybookValidationInput | null,
  historyMetrics?: HistoryMetrics | null
) => {
  if (!playbook) {
    return { allowed: true, requires_approval: false };
  }

  const text = (action.text || '').toString();
  const actionType = (action.action_type || '').toString().toLowerCase();

  if (playbook.safety?.block_urls && containsUrl(text)) {
    return { allowed: false, requires_approval: false, reason: 'URLs are blocked by the playbook.' };
  }

  if (playbook.safety?.block_sensitive_topics && text) {
    const match = findFirstMatch(text, SENSITIVE_TOPICS);
    if (match) {
      return {
        allowed: false,
        requires_approval: false,
        reason: `Sensitive topic detected: "${match}".`,
      };
    }
  }

  if (playbook.safety?.prohibited_words?.length) {
    const match = findFirstMatch(text, playbook.safety.prohibited_words);
    if (match) {
      return {
        allowed: false,
        requires_approval: false,
        reason: `Contains prohibited word: "${match}".`,
      };
    }
  }

  if (playbook.tone?.max_length && text.length > playbook.tone.max_length) {
    return {
      allowed: false,
      requires_approval: false,
      reason: `Reply exceeds max length of ${playbook.tone.max_length} characters.`,
    };
  }

  if (playbook.tone?.emoji_allowed === false && containsEmoji(text)) {
    return { allowed: false, requires_approval: false, reason: 'Emojis are not allowed.' };
  }

  if (playbook.action_rules && actionType) {
    if (!actionRuleAllows(actionType, playbook.action_rules)) {
      return {
        allowed: false,
        requires_approval: false,
        reason: `Action type "${actionType}" is not allowed by this playbook.`,
      };
    }
  }

  const executionMode = (action.execution_mode || 'manual').toString().toLowerCase();
  const applyNetworkLimits =
    action.intent_classification?.primary_intent === 'network_expansion' &&
    executionMode !== 'manual';

  if (applyNetworkLimits) {
    const limits = playbook.limits?.network_expansion;
    const networkActionsToday = historyMetrics?.networkActionsToday ?? 0;

    if (
      limits?.max_actions_per_day != null &&
      networkActionsToday >= limits.max_actions_per_day
    ) {
      return { allowed: false, requires_approval: false, reason: 'NETWORK_DAILY_LIMIT_EXCEEDED' };
    }

    if (limits?.allowed_hours?.length) {
      const hour = new Date().getUTCHours();
      if (!limits.allowed_hours.includes(hour)) {
        return { allowed: false, requires_approval: false, reason: 'OUTSIDE_ALLOWED_HOURS' };
      }
    }
  }

  if (playbook.limits && historyMetrics) {
    if (
      typeof playbook.limits.max_replies_per_hour === 'number' &&
      typeof historyMetrics.replies_last_hour === 'number' &&
      historyMetrics.replies_last_hour >= playbook.limits.max_replies_per_hour
    ) {
      return {
        allowed: false,
        requires_approval: false,
        reason: 'Playbook limit exceeded',
      };
    }
    if (
      typeof playbook.limits.max_follows_per_day === 'number' &&
      typeof historyMetrics.follows_today === 'number' &&
      historyMetrics.follows_today >= playbook.limits.max_follows_per_day
    ) {
      return {
        allowed: false,
        requires_approval: false,
        reason: 'Playbook limit exceeded',
      };
    }
    if (
      typeof playbook.limits.max_actions_per_day === 'number' &&
      typeof historyMetrics.actions_today === 'number' &&
      historyMetrics.actions_today >= playbook.limits.max_actions_per_day
    ) {
      return {
        allowed: false,
        requires_approval: false,
        reason: 'Playbook limit exceeded',
      };
    }
  }

  if (playbook.execution_modes && action.execution_mode) {
    const mode = action.execution_mode.toString().toLowerCase();
    if (playbook.execution_modes.manual_only && mode !== 'manual') {
      return {
        allowed: false,
        requires_approval: false,
        reason: 'Execution mode not permitted by playbook.',
      };
    }
    if (mode === 'api' && !playbook.execution_modes.api_allowed) {
      return {
        allowed: false,
        requires_approval: false,
        reason: 'API execution is not permitted by playbook.',
      };
    }
    if (mode === 'rpa' && !playbook.execution_modes.rpa_allowed) {
      return {
        allowed: false,
        requires_approval: false,
        reason: 'RPA execution is not permitted by playbook.',
      };
    }
  }

  let requiresApproval = false;
  if (playbook.automation_rules) {
    const risk = (action.risk_level || '').toString().toLowerCase();
    if (risk === 'high' && playbook.automation_rules.block_high_risk) {
      return {
        allowed: false,
        requires_approval: false,
        reason: 'High-risk actions are blocked by this playbook.',
      };
    }
    if (risk === 'medium' && playbook.automation_rules.require_human_approval_medium_risk) {
      requiresApproval = true;
    }
    if (risk === 'low' && !playbook.automation_rules.auto_execute_low_risk) {
      requiresApproval = true;
    }
  }

  if (
    action.intent_classification?.primary_intent === 'network_expansion' &&
    executionMode !== 'manual'
  ) {
    const level = playbook.automation_levels?.network_expansion ?? 'observe';

    if (level === 'observe') {
      return { allowed: false, requires_approval: false, reason: 'AUTOMATION_LEVEL_OBSERVE' };
    }

    if (level === 'assist' && actionType !== 'like') {
      return {
        allowed: false,
        requires_approval: false,
        reason: 'AUTOMATION_LEVEL_ASSIST_LIMIT',
      };
    }

    if (level === 'automate' && !['like', 'follow'].includes(actionType)) {
      return {
        allowed: false,
        requires_approval: false,
        reason: 'AUTOMATION_LEVEL_AUTOMATE_LIMIT',
      };
    }
  }

  return { allowed: true, requires_approval: requiresApproval };
};

export type { HistoryMetrics, PlaybookValidationInput, ValidationAction };
