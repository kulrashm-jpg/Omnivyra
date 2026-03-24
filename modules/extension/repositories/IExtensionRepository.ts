/**
 * Extension Repository Interface
 * 
 * Abstract storage layer so implementation can swap between:
 * - In-memory (MVP)
 * - PostgreSQL (production)
 * 
 * This ensures services don't depend on storage implementation.
 * 
 * @author Engineering
 * @date 2025-Q2
 */

import {
  ExtensionEventRow,
  ExtensionCommandRow,
  CommandStatus,
} from '../types/extension.types';

/**
 * Repository pattern for extension module.
 * Enables pluggable storage backends.
 */
export interface IExtensionRepository {
  // ============================================================================
  // EVENTS (ingest raw data from extension)
  // ============================================================================

  /**
   * Create new event from extension.
   * 
   * @param event Raw event data
   * @returns Created event with ID and timestamp
   */
  createEvent(event: Omit<ExtensionEventRow, 'id' | 'created_at'>): Promise<ExtensionEventRow>;

  /**
   * Find unprocessed events for a user.
   * 
   * @param userId User who triggered events
   * @param limit Max results to fetch
   * @returns Array of unprocessed events
   */
  getUnprocessedEvents(userId: string, limit?: number): Promise<ExtensionEventRow[]>;

  /**
   * Mark event as processed.
   * 
   * @param eventId Event to process
   */
  markEventProcessed(eventId: string): Promise<void>;

  /**
   * Find event by platform_message_id (for deduplication).
   * 
   * @param platformMessageId Platform's unique ID
   * @param orgId Organization context
   * @returns Event if exists, null otherwise
   */
  findEventByPlatformMessageId(
    platformMessageId: string,
    orgId: string
  ): Promise<ExtensionEventRow | null>;

  // ============================================================================
  // COMMANDS (queue work for extension to execute)
  // ============================================================================

  /**
   * Create new command for extension to execute.
   * 
   * @param command Command details
   * @returns Created command with ID
   */
  createCommand(command: Omit<ExtensionCommandRow, 'id' | 'created_at'>): Promise<ExtensionCommandRow>;

  /**
   * Get pending commands for user (ordered by priority).
   * 
   * @param userId User to fetch commands for
   * @param limit Max results
   * @returns Array of pending commands, sorted by priority
   */
  getPendingCommands(userId: string, limit?: number): Promise<ExtensionCommandRow[]>;

  /**
   * Update command status.
   * 
   * @param commandId Command to update
   * @param status New status
   */
  updateCommandStatus(commandId: string, status: CommandStatus): Promise<void>;

  /**
   * Mark command as executing (to prevent duplicate execution on retry).
   * 
   * @param commandId Command starting execution
   */
  markCommandExecuting(commandId: string): Promise<void>;

  /**
   * Report command execution result.
   * 
   * @param commandId Command that executed
   * @param status Final status (success/failed)
   * @param result Execution result details
   */
  reportCommandResult(
    commandId: string,
    status: CommandStatus,
    result?: Record<string, unknown>
  ): Promise<void>;

  /**
   * Find command by ID.
   * 
   * @param commandId Command to fetch
   * @returns Command details or null
   */
  getCommand(commandId: string): Promise<ExtensionCommandRow | null>;

  /**
   * Delete expired commands (helps manage memory).
   * 
   * @param cutoffDate Delete commands with expires_at before this time
   * @returns Number of deleted commands
   */
  deleteExpiredCommands(cutoffDate: Date): Promise<number>;

  // ============================================================================
  // SESSION & AUTH
  // ============================================================================

  /**
   * Store extension session token mapping.
   * 
   * Used to validate token without calling auth service repeatedly.
   * 
   * @param sessionToken Token value
   * @param userId Owner of token
   * @param orgId Organization context
   * @param expiresAt When token expires
   */
  storeSessionToken(
    sessionToken: string,
    userId: string,
    orgId: string,
    expiresAt: Date
  ): Promise<void>;

  /**
   * Validate session token.
   * 
   * @param token Token to validate
   * @returns { valid, userId, orgId } or { valid: false }
   */
  validateSessionToken(token: string): Promise<{
    valid: boolean;
    userId?: string;
    orgId?: string;
  }>;

  /**
   * Invalidate token (logout).
   * 
   * @param token Token to invalidate
   */
  invalidateSessionToken(token: string): Promise<void>;

  // ============================================================================
  // UTILITY
  // ============================================================================

  /**
   * Health check / connection test.
   * 
   * @returns true if repository is healthy
   */
  isHealthy(): Promise<boolean>;

  /**
   * Get storage stats (for monitoring).
   * 
   * @returns Stats like event count, command count, memory usage
   */
  getStats(): Promise<{
    event_count: number;
    command_count: number;
    pending_commands: number;
    session_tokens: number;
    memory_mb?: number;
  }>;
}
