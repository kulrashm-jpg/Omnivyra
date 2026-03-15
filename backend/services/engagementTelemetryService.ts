/**
 * Engagement telemetry service.
 * Records interaction events; does not block UI.
 * Use from API routes only (server-side).
 */

import { supabase } from '../db/supabaseClient';

export interface EngagementTelemetryPayload {
  organization_id: string;
  thread_id?: string;
  user_id?: string;
  metadata?: Record<string, unknown>;
}

export async function recordEngagementEvent(
  eventName: string,
  payload: EngagementTelemetryPayload
): Promise<void> {
  try {
    await supabase.from('engagement_telemetry_events').insert({
      organization_id: payload.organization_id,
      thread_id: payload.thread_id ?? null,
      user_id: payload.user_id ?? null,
      event_name: eventName,
      metadata: payload.metadata ?? {},
    });
  } catch (err) {
    console.warn('[engagementTelemetry] record failed:', (err as Error)?.message);
  }
}
