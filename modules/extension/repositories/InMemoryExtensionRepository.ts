/**
 * In-Memory Extension Repository
 * 
 * MVP implementation using Maps for fast lookups.
 * 
 * Production: Swap to PostgreSQL implementation without changing services.
 * 
 * @author Engineering
 * @date 2025-Q2
 */

import { v4 as uuid } from 'uuid';
import {
  ExtensionEventRow,
  ExtensionCommandRow,
  CommandStatus,
  CommandPriority,
} from '../types/extension.types';
import { IExtensionRepository } from './IExtensionRepository';

export class InMemoryExtensionRepository implements IExtensionRepository {
  // ============================================================================
  // IN-MEMORY STORAGE
  // ============================================================================

  // Events: eventId -> event
  private events = new Map<string, ExtensionEventRow>();
  private eventsByPlatformMessageId = new Map<string, ExtensionEventRow>();

  // Commands: commandId -> command
  private commands = new Map<string, ExtensionCommandRow>();
  private commandsByUserId = new Map<string, ExtensionCommandRow[]>();

  // Sessions: token -> { userId, orgId, expiresAt }
  private sessions = new Map<
    string,
    { userId: string; orgId: string; expiresAt: Date }
  >();

  // ============================================================================
  // EVENTS
  // ============================================================================

  async createEvent(
    event: Omit<ExtensionEventRow, 'id' | 'created_at'>
  ): Promise<ExtensionEventRow> {
    const id = uuid();
    const row: ExtensionEventRow = {
      id,
      ...event,
      created_at: new Date(),
    };

    this.events.set(id, row);
    this.eventsByPlatformMessageId.set(
      `${event.org_id}:${event.platform_message_id}`,
      row
    );

    return row;
  }

  async getUnprocessedEvents(
    userId: string,
    limit = 100
  ): Promise<ExtensionEventRow[]> {
    const unprocessed = Array.from(this.events.values())
      .filter((e) => e.user_id === userId && !e.processed)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .slice(0, limit);

    return unprocessed;
  }

  async markEventProcessed(eventId: string): Promise<void> {
    const event = this.events.get(eventId);
    if (event) {
      event.processed = true;
      event.processed_at = new Date();
      this.events.set(eventId, event);
    }
  }

  async findEventByPlatformMessageId(
    platformMessageId: string,
    orgId: string
  ): Promise<ExtensionEventRow | null> {
    const key = `${orgId}:${platformMessageId}`;
    return this.eventsByPlatformMessageId.get(key) ?? null;
  }

  // ============================================================================
  // COMMANDS
  // ============================================================================

  async createCommand(
    command: Omit<ExtensionCommandRow, 'id' | 'created_at'>
  ): Promise<ExtensionCommandRow> {
    const id = uuid();
    const row: ExtensionCommandRow = {
      id,
      ...command,
      created_at: new Date(),
    };

    this.commands.set(id, row);

    // Index by user for quick retrieval
    const userCommands = this.commandsByUserId.get(command.user_id) ?? [];
    userCommands.push(row);
    this.commandsByUserId.set(command.user_id, userCommands);

    return row;
  }

  async getPendingCommands(
    userId: string,
    limit = 50
  ): Promise<ExtensionCommandRow[]> {
    const userCommands = this.commandsByUserId.get(userId) ?? [];

    const pending = userCommands
      .filter((c) => c.status === CommandStatus.PENDING)
      .sort((a, b) => {
        // Priority order: HIGH > MEDIUM > LOW
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] ?? 0;
        const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] ?? 0;
        if (bPriority !== aPriority) return bPriority - aPriority;
        // Then by creation time (older first)
        return a.created_at.getTime() - b.created_at.getTime();
      })
      .slice(0, limit);

    return pending;
  }

  async updateCommandStatus(commandId: string, status: CommandStatus): Promise<void> {
    const cmd = this.commands.get(commandId);
    if (cmd) {
      cmd.status = status;
      this.commands.set(commandId, cmd);
    }
  }

  async markCommandExecuting(commandId: string): Promise<void> {
    await this.updateCommandStatus(commandId, CommandStatus.EXECUTING);
  }

  async reportCommandResult(
    commandId: string,
    status: CommandStatus,
    result?: Record<string, unknown>
  ): Promise<void> {
    const cmd = this.commands.get(commandId);
    if (cmd) {
      cmd.status = status;
      cmd.result = result;
      cmd.executed_at = new Date();
      this.commands.set(commandId, cmd);
    }
  }

  async getCommand(commandId: string): Promise<ExtensionCommandRow | null> {
    return this.commands.get(commandId) ?? null;
  }

  async deleteExpiredCommands(cutoffDate: Date): Promise<number> {
    let deleted = 0;

    for (const [id, cmd] of this.commands.entries()) {
      if (cmd.expires_at < cutoffDate) {
        this.commands.delete(id);

        // Also remove from user index
        const userCommands = this.commandsByUserId.get(cmd.user_id);
        if (userCommands) {
          const filtered = userCommands.filter((c) => c.id !== id);
          this.commandsByUserId.set(cmd.user_id, filtered);
        }

        deleted++;
      }
    }

    return deleted;
  }

  // ============================================================================
  // SESSIONS
  // ============================================================================

  async storeSessionToken(
    sessionToken: string,
    userId: string,
    orgId: string,
    expiresAt: Date
  ): Promise<void> {
    this.sessions.set(sessionToken, { userId, orgId, expiresAt });
  }

  async validateSessionToken(
    token: string
  ): Promise<{ valid: boolean; userId?: string; orgId?: string }> {
    const session = this.sessions.get(token);

    if (!session) {
      return { valid: false };
    }

    if (session.expiresAt < new Date()) {
      this.sessions.delete(token);
      return { valid: false };
    }

    return {
      valid: true,
      userId: session.userId,
      orgId: session.orgId,
    };
  }

  async invalidateSessionToken(token: string): Promise<void> {
    this.sessions.delete(token);
  }

  // ============================================================================
  // UTILITY
  // ============================================================================

  async isHealthy(): Promise<boolean> {
    return true; // In-memory store is always healthy
  }

  async getStats(): Promise<{
    event_count: number;
    command_count: number;
    pending_commands: number;
    session_tokens: number;
    memory_mb?: number;
  }> {
    const pending_commands = Array.from(this.commands.values()).filter(
      (c) => c.status === CommandStatus.PENDING
    ).length;

    return {
      event_count: this.events.size,
      command_count: this.commands.size,
      pending_commands,
      session_tokens: this.sessions.size,
      // Rough estimate in MB (actual depends on data size)
      memory_mb: Math.round(
        (this.events.size * 0.5 + 
         this.commands.size * 0.3 + 
         this.sessions.size * 0.1) / 1024
      ),
    };
  }
}

/**
 * Factory: Create repository instance
 * 
 * In future, can add env var to switch implementations:
 * ```
 * const repo = createExtensionRepository();
 * // ENV=postgres -> PostgreSQL repo
 * // ENV=memory -> InMemory repo
 * ```
 */
export function createExtensionRepository(): IExtensionRepository {
  // MVP: Always in-memory
  // TODO: Add env var to switch to PostgreSQL in Q2
  return new InMemoryExtensionRepository();
}
