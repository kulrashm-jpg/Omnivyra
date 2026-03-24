/**
 * Extension Module Type Definitions
 * 
 * Defines types for Chrome extension communication layer.
 * Kept separate from existing engagement system types to maintain isolation.
 */

// ============================================================================
// ENUMS
// ============================================================================

export enum PlatformType {
  LINKEDIN = 'linkedin',
  YOUTUBE = 'youtube',
}

export enum EventType {
  COMMENT = 'comment',
  DM = 'dm',
  MENTION = 'mention',
  LIKE = 'like',
  SHARE = 'share',
  REPLY = 'reply',
}

export enum CommandStatus {
  PENDING = 'pending',
  EXECUTING = 'executing', // ✓ Added for retry safety
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum CommandPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum SyncMode {
  BATCH = 'batch',      // Extension polls on interval
  REAL_TIME = 'real-time', // WebSocket (future)
}

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

/**
 * Extension event from Chrome extension
 * Raw data from browser capture
 */
export interface ExtensionEventPayload {
  platform: PlatformType;
  event_type: EventType;
  data: Record<string, unknown>;
  timestamp: number;
  platform_message_id: string; // ✓ CRITICAL: unique ID from platform for dedup
}

/**
 * Internal representation after validation
 * ✓ Includes platform_message_id for deduplication
 */
export interface ValidatedExtensionEvent extends ExtensionEventPayload {
  user_id: string;
  org_id: string;
  source: 'extension'; // marker for deduplication later
  platform_message_id: string; // ✓ CRITICAL: for dedup with API polling
}

/**
 * Command from backend to extension
 * e.g., "execute this reply on LinkedIn"
 */
export interface ExtensionCommand {
  command_id: string;
  platform: PlatformType;
  action_type: 'post_reply' | 'like' | 'follow' | 'share' | 'dm_reply';
  target_id: string;
  payload: Record<string, unknown>;
  priority: CommandPriority; // ✓ Added: HIGH=urgent, MEDIUM=normal, LOW=background
  created_at: Date;
  expires_at: Date;
  status: CommandStatus;
}

/**
 * Result from extension reporting command execution
 */
export interface CommandExecutionResult {
  command_id: string;
  status: CommandStatus;
  executed_at: Date;
  result: {
    success: boolean;
    message?: string;
    platform_response?: Record<string, unknown>;
    error?: string;
  };
}

/**
 * Extension session (NOT same as user session)
 * Short-lived token for extension communication
 */
export interface ExtensionSession {
  session_token: string;
  user_id: string;
  org_id: string;
  created_at: Date;
  expires_at: Date;
  sync_mode: SyncMode;
  polling_interval: number; // seconds
}

/**
 * Attached to Express request by middleware
 */
export interface ExtensionUser {
  user_id: string;
  org_id: string;
  session_token: string;
}

/**
 * API Response wrapper
 */
export interface ExtensionApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// ============================================================================
// SERVICE INTERFACES
// ============================================================================

export interface IExtensionEventService {
  ingestEvent(event: ValidatedExtensionEvent): Promise<{ event_id: string }>;
  getEvent(event_id: string): Promise<ValidatedExtensionEvent | null>;
}

export interface IExtensionCommandService {
  getPendingCommands(
    user_id: string,
    org_id: string,
    platform?: PlatformType,
    limit?: number
  ): Promise<ExtensionCommand[]>;
  
  updateCommandStatus(
    command_id: string,
    status: CommandStatus,
    result?: CommandExecutionResult['result']
  ): Promise<ExtensionCommand>;
  
  createCommand(
    user_id: string,
    org_id: string,
    command: Omit<ExtensionCommand, 'command_id' | 'created_at' | 'status'>
  ): Promise<ExtensionCommand>;
}

export interface IExtensionAuthService {
  validateSession(session_token: string): Promise<ExtensionSession | null>;
  createSession(user_id: string, org_id: string): Promise<ExtensionSession>;
  revokeSession(session_token: string): Promise<boolean>;
}

// ============================================================================
// DATABASE MODELS (Placeholders)
// ============================================================================

/**
 * Table: extension_events
 * Stores raw events from extension
 */
export interface ExtensionEventRow {
  id: string;
  user_id: string;
  org_id: string;
  platform: string;
  platform_message_id: string; // ✓ for deduplication
  event_type: string;
  data: Record<string, unknown>;
  source: string; // 'extension'
  created_at: Date;
  processed: boolean;
  processed_at?: Date;
}

/**
 * Table: extension_commands
 * Stores commands awaiting execution by extension
 */
export interface ExtensionCommandRow {
  id: string;
  user_id: string;
  org_id: string;
  platform: string;
  action_type: string;
  target_id: string;
  payload: Record<string, unknown>;
  priority: string; // ✓ 'low' | 'medium' | 'high'
  status: string;
  result?: Record<string, unknown>;
  created_at: Date;
  expires_at: Date;
  executed_at?: Date;
}

/**
 * Table: extension_sessions
 * Stores extension auth sessions
 */
export interface ExtensionSessionRow {
  id: string;
  user_id: string;
  org_id: string;
  token: string;
  sync_mode: string;
  polling_interval: number;
  created_at: Date;
  expires_at: Date;
  revoked_at?: Date;
}
