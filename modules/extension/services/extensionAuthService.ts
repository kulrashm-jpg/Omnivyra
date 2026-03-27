/**
 * Extension Authentication Service
 * 
 * Manages extension session tokens and validation.
 * Called by middleware to validate incoming requests.
 * 
 * IMPLEMENTATION NOTES:
 * - Currently uses in-memory store for MVP
 * - Production should use Redis or database
 * - Sessions expire after 7 days
 * - Tokens use crypto module for generation
 */


import { randomBytes } from 'crypto';
import {
  ExtensionSession,
  SyncMode,
  IExtensionAuthService,
} from '../types/extension.types';

// ============================================================================
// IN-MEMORY STORE (MVP ONLY - use Redis in production)
// ============================================================================

const sessionStore = new Map<string, ExtensionSession>();

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class ExtensionAuthService implements IExtensionAuthService {
  /**
   * Validates a session token
   * 
   * @param sessionToken The token to validate
   * @returns Session object if valid, null if invalid/expired
   */
  async validateSession(sessionToken: string): Promise<ExtensionSession | null> {
    try {
      // Lookup in store
      const session = sessionStore.get(sessionToken);

      if (!session) {
        return null;
      }

      // Check expiration
      if (new Date() > session.expires_at) {
        sessionStore.delete(sessionToken);
        return null;
      }

      return session;
    } catch (error) {
      console.error('[ExtensionAuthService] validateSession error:', error);
      return null;
    }
  }

  /**
   * Creates a new session for a user
   * 
   * @param user_id The user requesting session
   * @param org_id The organization context
   * @returns New session with token
   */
  async createSession(
    user_id: string,
    org_id: string
  ): Promise<ExtensionSession> {
    const sessionToken = this.generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const session: ExtensionSession = {
      session_token: sessionToken,
      user_id,
      org_id,
      created_at: now,
      expires_at: expiresAt,
      sync_mode: SyncMode.BATCH,
      polling_interval: 30, // seconds
    };

    sessionStore.set(sessionToken, session);
    return session;
  }

  /**
   * Revokes a session
   * 
   * @param sessionToken The token to revoke
   * @returns true if revoked, false if not found
   */
  async revokeSession(sessionToken: string): Promise<boolean> {
    return sessionStore.delete(sessionToken);
  }

  /**
   * Gets remaining sessions for a user
   * Useful for cleaning up old sessions
   * 
   * @param user_id User to query
   * @returns Array of active sessions
   */
  async getSessionsByUser(user_id: string): Promise<ExtensionSession[]> {
    const sessions: ExtensionSession[] = [];

    for (const session of sessionStore.values()) {
      if (session.user_id === user_id && new Date() <= session.expires_at) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Cleans up expired sessions
   * Run periodically (e.g., every hour)
   * 
   * @returns Number of sessions removed
   */
  async cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    let cleaned = 0;

    for (const [token, session] of sessionStore.entries()) {
      if (now > session.expires_at) {
        sessionStore.delete(token);
        cleaned++;
      }
    }

    console.log(`[ExtensionAuthService] Cleaned up ${cleaned} expired sessions`);
    return cleaned;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Generates a cryptographically secure session token
   * 
   * @returns 64-character hex string
   */
  private generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Validates token format (basic check)
   */
  private isValidTokenFormat(token: string): boolean {
    return /^[a-f0-9]{64}$/.test(token);
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

export const extensionAuthService = new ExtensionAuthService();

// ============================================================================
// MAINTENANCE FUNCTIONS
// ============================================================================

/**
 * Start periodic cleanup of expired sessions
 * Call this during app initialization
 */
export function startSessionCleanup(intervalMs: number = 3600000): NodeJS.Timer {
  return setInterval(async () => {
    await extensionAuthService.cleanupExpiredSessions();
  }, intervalMs);
}
