/**
 * Extension Module Integration Guide
 * 
 * Shows how to integrate the extension module into the main application.
 * 
 * This file is a REFERENCE - copy these integration points into your main app.ts or server.ts
 */

import express, { Express } from 'express';
import extensionRoutes from './modules/extension/routes/extensionRoutes';
import { extensionAuthService, startSessionCleanup } from './modules/extension/services/extensionAuthService';
import { extensionCommandService, startCommandCleanup } from './modules/extension/services/extensionCommandService';

/**
 * Integration Step 1: Mount routes in Express app
 * 
 * Add this to your main app.ts or server.ts file, after other middleware setup:
 * 
 * ```typescript
 * import extensionRoutes from './modules/extension/routes/extensionRoutes';
 * 
 * const app = express();
 * 
 * // ... other middleware ...
 * 
 * // Mount extension module
 * app.use('/api/extension', extensionRoutes);
 * 
 * // ... rest of routes ...
 * ```
 */

export function integrateExtensionModule(app: Express): void {
  // Mount all extension routes under /api/extension
  app.use('/api/extension', extensionRoutes);

  console.log('[Extension Module] Mounted at /api/extension');
}

/**
 * Integration Step 2: Start background cleanup tasks
 * 
 * Call this during app startup to enable periodic cleanup of expired sessions/commands:
 * 
 * ```typescript
 * import { initializeExtensionCleanup } from './modules/extension/integration';
 * 
 * // In your app startup code:
 * initializeExtensionCleanup();
 * ```
 */

export function initializeExtensionCleanup(): void {
  // Clean up expired sessions every hour
  const sessionCleanupTimer = startSessionCleanup(3600000);

  // Clean up expired commands every hour
  const commandCleanupTimer = startCommandCleanup(3600000);

  console.log('[Extension Module] Cleanup tasks started');

  // Return timers for graceful shutdown
  return {
    sessionCleanupTimer,
    commandCleanupTimer,
  } as any;
}

/**
 * Integration Step 3: Graceful shutdown
 * 
 * Call this when app is shutting down:
 * 
 * ```typescript
 * process.on('SIGTERM', () => {
 *   console.log('SIGTERM received, shutting down gracefully...');
 *   shutdownExtensionModule(sessionCleanupTimer, commandCleanupTimer);
 *   server.close();
 * });
 * ```
 */

export function shutdownExtensionModule(
  sessionCleanupTimer?: NodeJS.Timer,
  commandCleanupTimer?: NodeJS.Timer
): void {
  if (sessionCleanupTimer) clearInterval(sessionCleanupTimer);
  if (commandCleanupTimer) clearInterval(commandCleanupTimer);

  console.log('[Extension Module] Cleanup tasks stopped');
}

/**
 * Complete integration example (main app.ts)
 * ============================================================================
 * 
 * ```typescript
 * import express from 'express';
 * import { integrateExtensionModule, initializeExtensionCleanup, shutdownExtensionModule } from './modules/extension/integration';
 * 
 * const app = express();
 * const PORT = process.env.PORT || 3000;
 * 
 * // Middleware
 * app.use(express.json());
 * app.use(express.urlencoded({ extended: true }));
 * 
 * // Error handler middleware
 * app.use((err, req, res, next) => {
 *   console.error('Unhandled error:', err);
 *   res.status(500).json({
 *     success: false,
 *     error: 'Internal server error',
 *     timestamp: Date.now(),
 *   });
 * });
 * 
 * // Mount extension module
 * integrateExtensionModule(app);
 * 
 * // Other routes...
 * app.get('/', (req, res) => {
 *   res.json({ message: 'Omnivyra API' });
 * });
 * 
 * // Start server
 * const server = app.listen(PORT, () => {
 *   console.log(`Server running on http://localhost:${PORT}`);
 * 
 *   // Initialize extension module cleanup
 *   const { sessionCleanupTimer, commandCleanupTimer } = initializeExtensionCleanup();
 * 
 *   // Graceful shutdown
 *   process.on('SIGTERM', () => {
 *     console.log('SIGTERM received, shutting down...');
 *     shutdownExtensionModule(sessionCleanupTimer, commandCleanupTimer);
 *     server.close();
 *   });
 * });
 * ```
 */

// ============================================================================
// UTILITY: Create extension session for user (admin/testing)
// ============================================================================

/**
 * Creates a new extension session for a user
 * Called by admin panel or testing scripts
 * 
 * Usage:
 * ```typescript
 * const session = await createExtensionSession('user-uuid', 'org-uuid');
 * // Send session.session_token to extension for use
 * ```
 */

export async function createExtensionSession(
  user_id: string,
  org_id: string
): Promise<{
  session_token: string;
  expires_at: Date;
  polling_interval: number;
}> {
  const session = await extensionAuthService.createSession(user_id, org_id);

  return {
    session_token: session.session_token,
    expires_at: session.expires_at,
    polling_interval: session.polling_interval,
  };
}

/**
 * Revokes an extension session
 * Called when user logs out or session is compromised
 */

export async function revokeExtensionSession(
  sessionToken: string
): Promise<boolean> {
  return extensionAuthService.revokeSession(sessionToken);
}

/**
 * Gets user's active sessions
 * For logout-all-devices functionality
 */

export async function getUserSessions(user_id: string) {
  return extensionAuthService.getSessionsByUser(user_id);
}

/**
 * Revokes all sessions for a user
 * For security incident response
 */

export async function revokeUserSessions(user_id: string): Promise<number> {
  const sessions = await extensionAuthService.getSessionsByUser(user_id);
  let revoked = 0;

  for (const session of sessions) {
    await extensionAuthService.revokeSession(session.session_token);
    revoked++;
  }

  return revoked;
}

// ============================================================================
// DATABASE SCHEMA REFERENCES
// ============================================================================

/**
 * Required database tables for extension module
 * (MVP uses in-memory store, but production needs these)
 * 
 * TABLE 1: extension_events
 * ============================================================================
 * 
 * CREATE TABLE extension_events (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id UUID NOT NULL REFERENCES users(id),
 *   org_id UUID NOT NULL REFERENCES organizations(id),
 *   platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'youtube')),
 *   event_type TEXT NOT NULL CHECK (event_type IN ('comment', 'dm', 'mention', 'like', 'share', 'reply')),
 *   data JSONB NOT NULL,
 *   source TEXT NOT NULL DEFAULT 'extension',
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   processed BOOLEAN DEFAULT FALSE,
 *   processed_at TIMESTAMP,
 *   deleted_at TIMESTAMP
 * );
 * 
 * CREATE INDEX idx_extension_events_user_org ON extension_events(user_id, org_id, created_at DESC);
 * CREATE INDEX idx_extension_events_processed ON extension_events(processed, created_at DESC);
 * 
 * 
 * TABLE 2: extension_commands
 * ============================================================================
 * 
 * CREATE TABLE extension_commands (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id UUID NOT NULL REFERENCES users(id),
 *   org_id UUID NOT NULL REFERENCES organizations(id),
 *   platform TEXT NOT NULL CHECK (platform IN ('linkedin', 'youtube')),
 *   action_type TEXT NOT NULL CHECK (action_type IN ('post_reply', 'like', 'follow', 'share', 'dm_reply')),
 *   target_id TEXT NOT NULL,
 *   payload JSONB NOT NULL,
 *   status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'success', 'failed', 'cancelled')),
 *   result JSONB,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   expires_at TIMESTAMP NOT NULL,
 *   executed_at TIMESTAMP,
 *   deleted_at TIMESTAMP
 * );
 * 
 * CREATE INDEX idx_extension_commands_user_org_status ON extension_commands(user_id, org_id, status, created_at DESC);
 * CREATE INDEX idx_extension_commands_expires ON extension_commands(expires_at) WHERE status = 'pending';
 * 
 * 
 * TABLE 3: extension_sessions
 * ============================================================================
 * 
 * CREATE TABLE extension_sessions (
 *   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id UUID NOT NULL REFERENCES users(id),
 *   org_id UUID NOT NULL REFERENCES organizations(id),
 *   token TEXT NOT NULL UNIQUE,
 *   sync_mode TEXT NOT NULL DEFAULT 'batch' CHECK (sync_mode IN ('batch', 'real-time')),
 *   polling_interval INTEGER NOT NULL DEFAULT 30,
 *   created_at TIMESTAMP DEFAULT NOW(),
 *   expires_at TIMESTAMP NOT NULL,
 *   revoked_at TIMESTAMP,
 *   last_activity_at TIMESTAMP
 * );
 * 
 * CREATE INDEX idx_extension_sessions_token ON extension_sessions(token) WHERE revoked_at IS NULL;
 * CREATE INDEX idx_extension_sessions_user ON extension_sessions(user_id, revoked_at);
 * CREATE INDEX idx_extension_sessions_expires ON extension_sessions(expires_at);
 */
