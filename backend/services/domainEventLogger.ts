/**
 * domainEventLogger.ts
 *
 * Fire-and-forget writer for domain_events. Use logDomainEvent() to record
 * any verification, canonical, or resolution event. Failures are SWALLOWED —
 * the logger MUST NOT propagate exceptions back to the calling business flow.
 *
 * Schema (per migration domain_events_table):
 *   id            UUID PK
 *   event_type    TEXT NOT NULL
 *   company_id    UUID NULL    — null for pre-company events (signup canonical reject, etc.)
 *   final_domain  TEXT NULL
 *   user_id       UUID NULL
 *   metadata      JSONB NULL
 *   created_at    TIMESTAMPTZ DEFAULT now()
 *
 * Conventions:
 *   - event_type SCREAMING_SNAKE_CASE
 *   - metadata is small (single-row JSON, no nested objects > 1 level if avoidable)
 */

import { supabase } from '../db/supabaseClient';
import { logger } from './logger';

export type DomainEventType =
  | 'DOMAIN_VERIFICATION_SUCCESS'
  | 'DOMAIN_VERIFICATION_FAILED'
  | 'DOMAIN_NOT_CANONICAL'
  | 'DOMAIN_FORWARDING_BLOCKED'
  | 'DOMAIN_ALREADY_REGISTERED'
  | 'DOMAIN_RESOLUTION_FAILED'
  | 'DOMAIN_RESOLUTION_BLOCKED'
  | 'DOMAIN_UNVERIFIED_USAGE';

export interface LogDomainEventInput {
  event_type: DomainEventType;
  company_id?: string | null;
  final_domain?: string | null;
  user_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Insert a row into domain_events. Never throws.
 * Returns true on success, false on any failure path.
 */
export async function logDomainEvent(input: LogDomainEventInput): Promise<boolean> {
  try {
    const { error } = await supabase.from('domain_events').insert({
      event_type:   input.event_type,
      company_id:   input.company_id   ?? null,
      final_domain: input.final_domain ?? null,
      user_id:      input.user_id      ?? null,
      metadata:     input.metadata     ?? null,
    });
    if (error) {
      logger.warn('domain_event_log_failed', {
        event_type: input.event_type,
        message:    error.message,
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('domain_event_log_threw', {
      event_type: input.event_type,
      message:    err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
