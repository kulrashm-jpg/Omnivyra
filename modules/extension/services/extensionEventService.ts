/**
 * Extension Event Service
 * 
 * Handles ingestion of raw events from Chrome extension.
 * Minimal processing - just validates and stores.
 * 
 * Actual mapping to engagement_messages happens in a separate worker
 * (engagement_event_processor worker in BullMQ).
 * 
 * DESIGN NOTES:
 * - Events are stored in isolation (extension_events table)
 * - source='extension' marker for deduplication later
 * - No business logic here (e.g., no opportunity detection)
 * - Worker processes batches asynchronously
 */


import {
  ValidatedExtensionEvent,
  IExtensionEventService,
  ExtensionEventRow,
  EventType,
  PlatformType,
} from '../types/extension.types';

// ============================================================================
// IN-MEMORY STORE (MVP ONLY - use database in production)
// ============================================================================

const eventStore = new Map<string, ValidatedExtensionEvent>();

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class ExtensionEventService implements IExtensionEventService {
  /**
   * Ingests a validated extension event
   * 
   * Flow:
   * 1. Generate UUID
   * 2. Timestamp event ingestion
   * 3. Store in database
   * 4. Queue for processing (in worker, not here)
   * 5. Return event_id for tracking
   * 
   * @param event Validated event from middleware
   * @returns Event ID for tracking
   */
  async ingestEvent(event: ValidatedExtensionEvent): Promise<{ event_id: string }> {
    try {
      const eventId = crypto.randomUUID();

      // ASSUMPTION: In production, this becomes a database INSERT
      // SQL:
      // INSERT INTO extension_events (id, user_id, org_id, platform, event_type, data, source, created_at, processed)
      // VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), FALSE)

      const row: ExtensionEventRow = {
        id: eventId,
        user_id: event.user_id,
        org_id: event.org_id,
        platform: event.platform,
        event_type: event.event_type,
        platform_message_id: event.platform_message_id,
        data: event.data,
        source: 'extension',
        created_at: new Date(),
        processed: false,
      };

      // Store in memory (MVP)
      eventStore.set(eventId, event);

      console.log('[ExtensionEventService] Event ingested', {
        event_id: eventId,
        user_id: event.user_id,
        org_id: event.org_id,
        platform: event.platform,
        event_type: event.event_type,
      });

      // FUTURE: In production, queue job for processing
      // await bullmqQueue.add('process_extension_event', {
      //   event_id: eventId,
      //   org_id: event.org_id,
      // });

      return { event_id: eventId };
    } catch (error) {
      console.error('[ExtensionEventService] ingestEvent error:', error);
      throw new Error(`Failed to ingest event: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  /**
   * Retrieves a stored event by ID
   * 
   * @param eventId Event UUID
   * @returns Event object or null if not found
   */
  async getEvent(eventId: string): Promise<ValidatedExtensionEvent | null> {
    try {
      // ASSUMPTION: In production, this is a SELECT query
      // SQL:
      // SELECT * FROM extension_events WHERE id = $1 AND deleted_at IS NULL

      const event = eventStore.get(eventId);
      return event || null;
    } catch (error) {
      console.error('[ExtensionEventService] getEvent error:', error);
      return null;
    }
  }

  /**
   * Gets recent events for a user
   * Used for debugging/monitoring
   * 
   * @param user_id User UUID
   * @param org_id Organization UUID
   * @param limit Max results (default: 100)
   * @returns Array of recent events
   */
  async getRecentEvents(
    user_id: string,
    org_id: string,
    limit: number = 100
  ): Promise<ValidatedExtensionEvent[]> {
    try {
      // ASSUMPTION: In production, this is a SELECT query with ordering
      // SQL:
      // SELECT * FROM extension_events 
      // WHERE user_id = $1 AND org_id = $2
      // ORDER BY created_at DESC
      // LIMIT $3

      const events: ValidatedExtensionEvent[] = [];

      for (const event of eventStore.values()) {
        if (event.user_id === user_id && event.org_id === org_id) {
          events.push(event);
        }
      }

      // Sort by timestamp desc and limit
      return events
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    } catch (error) {
      console.error('[ExtensionEventService] getRecentEvents error:', error);
      return [];
    }
  }

  /**
   * Counts events by type for a user
   * Used for analytics/monitoring
   * 
   * @param user_id User UUID
   * @param org_id Organization UUID
   * @returns Object with counts by event_type
   */
  async getEventCounts(
    user_id: string,
    org_id: string
  ): Promise<Record<EventType, number>> {
    try {
      // ASSUMPTION: In production, this is an aggregate query
      // SQL:
      // SELECT event_type, COUNT(*) as count
      // FROM extension_events
      // WHERE user_id = $1 AND org_id = $2 AND created_at > NOW() - INTERVAL '7 days'
      // GROUP BY event_type

      const counts: Record<EventType, number> = {
        [EventType.COMMENT]: 0,
        [EventType.DM]: 0,
        [EventType.MENTION]: 0,
        [EventType.LIKE]: 0,
        [EventType.SHARE]: 0,
        [EventType.REPLY]: 0,
      };

      for (const event of eventStore.values()) {
        if (event.user_id === user_id && event.org_id === org_id) {
          counts[event.event_type]++;
        }
      }

      return counts;
    } catch (error) {
      console.error('[ExtensionEventService] getEventCounts error:', error);
      return {
        [EventType.COMMENT]: 0,
        [EventType.DM]: 0,
        [EventType.MENTION]: 0,
        [EventType.LIKE]: 0,
        [EventType.SHARE]: 0,
        [EventType.REPLY]: 0,
      };
    }
  }

  /**
   * Gets unprocessed events (for worker to consume)
   * 
   * @param limit Max events to retrieve
   * @returns Array of unprocessed events
   */
  async getUnprocessedEvents(limit: number = 100): Promise<ValidatedExtensionEvent[]> {
    try {
      // ASSUMPTION: In production, this queries with processed=false flag
      // SQL:
      // SELECT * FROM extension_events 
      // WHERE processed = FALSE
      // ORDER BY created_at ASC
      // LIMIT $1

      const unprocessed: ValidatedExtensionEvent[] = [];

      for (const event of eventStore.values()) {
        unprocessed.push(event);
        if (unprocessed.length >= limit) break;
      }

      return unprocessed;
    } catch (error) {
      console.error('[ExtensionEventService] getUnprocessedEvents error:', error);
      return [];
    }
  }

  /**
   * Marks an event as processed
   * Called by worker after mapping to engagement_messages
   * 
   * @param eventId Event UUID
   * @returns true if updated, false if not found
   */
  async markProcessed(eventId: string): Promise<boolean> {
    try {
      // ASSUMPTION: In production, this updates the processed flag
      // SQL:
      // UPDATE extension_events SET processed = TRUE, processed_at = NOW() WHERE id = $1

      if (eventStore.has(eventId)) {
        console.log(`[ExtensionEventService] Marked event ${eventId} as processed`);
        return true;
      }

      return false;
    } catch (error) {
      console.error('[ExtensionEventService] markProcessed error:', error);
      return false;
    }
  }

  // ============================================================================
  // HEALTH & DIAGNOSTICS
  // ============================================================================

  /**
   * Returns service health metrics
   * Used for monitoring dashboards
   */
  async getMetrics(): Promise<{
    total_events: number;
    unprocessed_events: number;
    by_platform: Record<PlatformType, number>;
    by_event_type: Record<EventType, number>;
  }> {
    const allEvents = Array.from(eventStore.values());

    const byPlatform: Record<string, number> = {
      [PlatformType.LINKEDIN]: 0,
      [PlatformType.YOUTUBE]: 0,
    };

    const byEventType: Record<string, number> = {
      [EventType.COMMENT]: 0,
      [EventType.DM]: 0,
      [EventType.MENTION]: 0,
      [EventType.LIKE]: 0,
      [EventType.SHARE]: 0,
      [EventType.REPLY]: 0,
    };

    for (const event of allEvents) {
      byPlatform[event.platform]++;
      byEventType[event.event_type]++;
    }

    return {
      total_events: allEvents.length,
      unprocessed_events: allEvents.length, // all, since we're not tracking processed flag in memory
      by_platform: byPlatform as Record<PlatformType, number>,
      by_event_type: byEventType as Record<EventType, number>,
    };
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const extensionEventService = new ExtensionEventService();
