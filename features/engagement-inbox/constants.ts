export const SIGNAL_STATUSES = ['new', 'reviewed', 'actioned', 'ignored'] as const;

export const SIGNAL_TYPES = ['comment', 'reply', 'mention', 'quote', 'discussion', 'buyer_intent_signal'];

// Must match the backend's PLATFORMS allow-list in /api/engagement/campaign-signals.
// 'x' is included so signals with platform='x' are reachable; the backend
// normalizes 'x' → 'twitter' on filter.
export const PLATFORMS = ['linkedin', 'twitter', 'x', 'discord', 'slack', 'reddit', 'github'];

export const TIME_RANGES = [
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
];
