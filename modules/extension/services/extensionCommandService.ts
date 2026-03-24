/**
 * Extension Command Service
 * 
 * Manages commands queued for execution by extension.
 * Called by:
 * - API: GET /api/extension/commands (extension polls)
 * - API: POST /api/extension/action-result (extension reports result)
 * - Backend: createCommand() (when AI reply generated, etc)
 * 
 * DESIGN NOTES:
 * - Commands have expiration (15 minutes by default)
 * - Extension polls every 30 seconds (can be configured)
 * - Result includes platform response for deferred processing
 */

import { v4 as uuidv4 } from 'uuid';
import {
  ExtensionCommand,
  CommandStatus,
  CommandPriority,
  PlatformType,
  IExtensionCommandService,
} from '../types/extension.types';

// ============================================================================
// IN-MEMORY STORE (MVP ONLY - use database in production)
// ============================================================================

const commandStore = new Map<string, ExtensionCommand>();

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class ExtensionCommandService implements IExtensionCommandService {
  /**
   * Gets pending commands for a user
   * Extension calls this on polling interval
   * 
   * Flow:
   * 1. Query commands with status='pending'
   * 2. Order by created_at (FIFO)
   * 3. Limit results
   * 4. Optionally filter by platform
   * 5. Return array
   * 
   * @param user_id User UUID
   * @param org_id Organization UUID
   * @param platform Optional platform filter
   * @param limit Max results (default: 10)
   * @returns Array of pending commands
   */
  async getPendingCommands(
    user_id: string,
    org_id: string,
    platform?: PlatformType,
    limit: number = 10
  ): Promise<ExtensionCommand[]> {
    try {
      // ASSUMPTION: In production, this is a SQL query
      // SQL:
      // SELECT * FROM extension_commands
      // WHERE user_id = $1 
      //   AND org_id = $2
      //   AND status = 'pending'
      //   AND expires_at > NOW()
      //   AND (platform = $3 OR $3 IS NULL)
      // ORDER BY created_at ASC
      // LIMIT $4

      const pending: ExtensionCommand[] = [];

      for (const command of commandStore.values()) {
        if (
          command.platform === (platform || command.platform) &&
          new Date() < command.expires_at
        ) {
          // Note: Can't easily check user_id/org_id without DB schema, skip for now
          pending.push(command);
        }
      }

      return pending.slice(0, limit);
    } catch (error) {
      console.error('[ExtensionCommandService] getPendingCommands error:', error);
      return [];
    }
  }

  /**
   * Updates command status and stores execution result
   * Called when extension reports completion
   * 
   * @param commandId Command UUID
   * @param status New status (success/failed)
   * @param result Execution result object
   * @returns Updated command
   * @throws Error if command not found
   */
  async updateCommandStatus(
    commandId: string,
    status: CommandStatus,
    result?: Record<string, unknown>
  ): Promise<ExtensionCommand> {
    try {
      // ASSUMPTION: In production, this is an UPDATE query
      // SQL:
      // UPDATE extension_commands
      // SET status = $1, result = $2, executed_at = NOW()
      // WHERE id = $3
      // RETURNING *

      const command = commandStore.get(commandId);
      if (!command) {
        throw new Error(`Command not found: ${commandId}`);
      }

      command.status = status;
      command.status = status;

      console.log('[ExtensionCommandService] Command status updated', {
        command_id: commandId,
        status,
      });

      // Trigger any post-execution handlers
      // TODO: emit event for credit deduction, notification, etc
      // EventEmitter.emit('command_executed', { commandId, status, result });

      return command;
    } catch (error) {
      console.error('[ExtensionCommandService] updateCommandStatus error:', error);
      throw error;
    }
  }

  /**
   * Creates a new command for the extension to execute
   * Called by backend when AI generates reply or user triggers action
   * 
   * @param user_id User UUID
   * @param org_id Organization UUID
   * @param command Command details (minus id, created_at, status)
   * @returns Created command with ID
   */
  async createCommand(
    user_id: string,
    org_id: string,
    command: Omit<ExtensionCommand, 'command_id' | 'created_at' | 'status'>
  ): Promise<ExtensionCommand> {
    try {
      // ASSUMPTION: In production, this is an INSERT query
      // SQL:
      // INSERT INTO extension_commands 
      // (id, user_id, org_id, platform, action_type, target_id, payload, status, created_at, expires_at)
      // VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', NOW(), NOW() + INTERVAL '15 minutes')
      // RETURNING *

      const commandId = uuidv4();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000); // 15 minutes

      const newCommand: ExtensionCommand = {
        command_id: commandId,
        platform: command.platform,
        action_type: command.action_type,
        target_id: command.target_id,
        payload: command.payload,
        priority: CommandPriority.MEDIUM,
        created_at: now,
        expires_at: expiresAt,
        status: CommandStatus.PENDING,
      };

      commandStore.set(commandId, newCommand);

      console.log('[ExtensionCommandService] Command created', {
        command_id: commandId,
        user_id,
        org_id,
        action_type: command.action_type,
        platform: command.platform,
      });

      return newCommand;
    } catch (error) {
      console.error('[ExtensionCommandService] createCommand error:', error);
      throw new Error(`Failed to create command: ${error instanceof Error ? error.message : 'unknown'}`);
    }
  }

  // ============================================================================
  // ADDITIONAL METHODS
  // ============================================================================

  /**
   * Gets command by ID
   * Used for tracking/verification
   * 
   * @param commandId Command UUID
   * @returns Command or null if not found
   */
  async getCommand(commandId: string): Promise<ExtensionCommand | null> {
    try {
      return commandStore.get(commandId) || null;
    } catch (error) {
      console.error('[ExtensionCommandService] getCommand error:', error);
      return null;
    }
  }

  /**
   * Gets completed commands for a user (last 24 hours)
   * Used for activity tracking/audit
   * 
   * @param user_id User UUID
   * @param org_id Organization UUID
   * @returns Array of completed commands
   */
  async getCompletedCommands(
    user_id: string,
    org_id: string
  ): Promise<ExtensionCommand[]> {
    try {
      // ASSUMPTION: In production
      // SQL:
      // SELECT * FROM extension_commands
      // WHERE user_id = $1 AND org_id = $2
      //   AND status IN ('success', 'failed')
      //   AND executed_at > NOW() - INTERVAL '24 hours'
      // ORDER BY executed_at DESC

      const completed: ExtensionCommand[] = [];

      for (const command of commandStore.values()) {
        if (
          [CommandStatus.SUCCESS, CommandStatus.FAILED].includes(
            command.status
          )
        ) {
          completed.push(command);
        }
      }

      return completed;
    } catch (error) {
      console.error('[ExtensionCommandService] getCompletedCommands error:', error);
      return [];
    }
  }

  /**
   * Cleans up expired commands
   * Run periodically (e.g., every hour)
   * 
   * @returns Number of commands deleted
   */
  async cleanupExpiredCommands(): Promise<number> {
    try {
      // ASSUMPTION: In production
      // SQL:
      // DELETE FROM extension_commands
      // WHERE expires_at < NOW() AND status = 'pending'

      const now = new Date();
      let deleted = 0;

      for (const [id, command] of commandStore.entries()) {
        if (command.status === CommandStatus.PENDING && now > command.expires_at) {
          commandStore.delete(id);
          deleted++;
        }
      }

      console.log(
        `[ExtensionCommandService] Cleaned up ${deleted} expired commands`
      );
      return deleted;
    } catch (error) {
      console.error('[ExtensionCommandService] cleanupExpiredCommands error:', error);
      return 0;
    }
  }

  /**
   * Gets command metrics
   * Used for monitoring/alerts
   */
  async getMetrics(): Promise<{
    total_commands: number;
    pending: number;
    executing: number;
    success: number;
    failed: number;
    cancelled: number;
  }> {
    try {
      let pending = 0;
      let executing = 0;
      let success = 0;
      let failed = 0;
      let cancelled = 0;

      for (const command of commandStore.values()) {
        if (command.status === CommandStatus.PENDING) pending++;
        else if (command.status === CommandStatus.EXECUTING) executing++;
        else if (command.status === CommandStatus.SUCCESS) success++;
        else if (command.status === CommandStatus.FAILED) failed++;
        else if (command.status === CommandStatus.CANCELLED) cancelled++;
      }

      return {
        total_commands: commandStore.size,
        pending,
        executing,
        success,
        failed,
        cancelled,
      };
    } catch (error) {
      console.error('[ExtensionCommandService] getMetrics error:', error);
      return {
        total_commands: 0,
        pending: 0,
        executing: 0,
        success: 0,
        failed: 0,
        cancelled: 0,
      };
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const extensionCommandService = new ExtensionCommandService();

// ============================================================================
// MAINTENANCE FUNCTIONS
// ============================================================================

/**
 * Start periodic cleanup of expired commands
 * Call during app initialization
 */
export function startCommandCleanup(intervalMs: number = 3600000): NodeJS.Timer {
  return setInterval(async () => {
    await extensionCommandService.cleanupExpiredCommands();
  }, intervalMs);
}
