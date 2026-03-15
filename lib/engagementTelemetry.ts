/**
 * Client-side engagement telemetry.
 * Calls API; does not block UI.
 */

export interface EngagementTelemetryPayload {
  organization_id: string;
  thread_id?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
}

export function recordEngagementEvent(
  eventName: string,
  payload: EngagementTelemetryPayload
): void {
  void fetch('/api/engagement/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      event_name: eventName,
      ...payload,
    }),
  }).catch(() => {});
}
