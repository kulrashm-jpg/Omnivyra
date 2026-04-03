/**
 * Command Center Event Analytics
 * 
 * Lightweight event tracking for command center interactions.
 * Can be swapped for Segment, Mixpanel, etc. in production.
 */

export interface CommandCenterEvent {
  eventName: string;
  userId?: string;
  userRole?: string;
  companyId?: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

/**
 * Log command center viewed event
 * Fired once per session when user lands on command center
 */
export async function logCommandCenterViewed(
  userId: string,
  userRole: string,
  isFirstTime: boolean,
  setupPercentage: number,
  visibleCardsCount: number,
): Promise<void> {
  const event: CommandCenterEvent = {
    eventName: 'command_center_viewed',
    userId,
    userRole,
    metadata: {
      first_time: isFirstTime,
      setup_percentage: setupPercentage,
      visible_cards_count: visibleCardsCount,
      timestamp_iso: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };

  try {
    // Send to analytics endpoint (fire-and-forget, non-blocking)
    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }).catch(() => {
      // Silently fail — analytics are best-effort
    });
  } catch (err) {
    console.debug('[analytics] Failed to log command center view:', err);
  }
}

/**
 * Log card click event
 * Fired when user clicks on a command center card
 */
export async function logCardClicked(
  userId: string,
  cardId: string,
  cardState: string,
  userRole?: string,
  companyId?: string,
): Promise<void> {
  const event: CommandCenterEvent = {
    eventName: 'command_center_card_clicked',
    userId,
    userRole,
    companyId,
    metadata: {
      card_id: cardId,
      card_state: cardState,
      timestamp_iso: new Date().toISOString(),
    },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }).catch(() => {
      // Silently fail — analytics are best-effort
    });
  } catch (err) {
    console.debug('[analytics] Failed to log card click:', err);
  }
}

/**
 * Log "Don't show again" toggle
 */
export async function logCommandCenterDismissed(
  userId: string,
  dismissed: boolean,
): Promise<void> {
  const event: CommandCenterEvent = {
    eventName: 'command_center_dismissed',
    userId,
    metadata: {
      dismissed,
    },
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    }).catch(() => {
      // Silently fail
    });
  } catch (err) {
    console.debug('[analytics] Failed to log dismissal:', err);
  }
}

/**
 * Client-side analytics endpoint (optional)
 * If you want to track without backend, store events in localStorage
 * and ship them on next session
 */
export function logEventLocally(event: CommandCenterEvent): void {
  if (typeof window === 'undefined') return;

  try {
    const stored = JSON.parse(localStorage.getItem('cc_events') || '[]') as CommandCenterEvent[];
    stored.push(event);
    // Keep last 100 events
    localStorage.setItem('cc_events', JSON.stringify(stored.slice(-100)));
  } catch (err) {
    // Ignore storage errors
  }
}
