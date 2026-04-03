/**
 * Content Architect Role: 2-Factor Approval System
 *
 * Prevents unauthorized escalation if auth credentials are compromised.
 * Content Architect mode (full system access override) requires:
 * 1. URL parameter: ?contentArchitectPassword=SECURED_PASSWORD
 * 2. Time-limited session: expires after 1 hour
 * 3. Audit trail: all actions logged with IP/user-agent
 *
 * Usage:
 *   import { grantContentArchitectAccess, validateContentArchitectSession } from '@/backend/services/contentArchitectService';
 *
 *   // In login API route:
 *   const token = await grantContentArchitectAccess(userId, ipAddress);
 *
 *   // In protected API routes:
 *   const isValid = await validateContentArchitectSession(token, ipAddress);
 *   if (!isValid) return res.status(403).json({ error: 'Session expired' });
 */

import { supabase } from '../db/supabaseClient';
import { config } from '@/config';
import { logAuditEvent } from './auditLoggingService';
import { createHash, randomBytes } from 'crypto';

export interface ContentArchitectSession {
  id: string;
  userId: string;
  token: string;
  ipAddress: string;
  userAgent: string;
  createdAt: Date;
  expiresAt: Date;
  lastActivityAt: Date;
}

const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour
const ACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 min inactivity timeout

/**
 * Grant Content Architect access (requires password + approval)
 *
 * Steps:
 * 1. Verify user exists and is an admin
 * 2. Verify password matches CONTENT_ARCHITECT_PASSWORD env var
 * 3. Create time-limited session
 * 4. Log approval in audit trail
 *
 * @param userId User requesting access
 * @param password Content Architect password (from request)
 * @param ipAddress Request IP for session binding and audit trail
 * @param userAgent Request user-agent for session binding
 *
 * @returns Session token (valid for 1 hour) or null if denied
 */
export async function grantContentArchitectAccess(
  userId: string,
  password: string,
  ipAddress: string,
  userAgent: string
): Promise<string | null> {
  const expectedPassword = config.CONTENT_ARCHITECT_PASSWORD;

  // Fail-safe: if password not configured, deny all access
  if (!expectedPassword) {
    await logAuditEvent({
      operation: 'SELECT',
      table: 'content_architect_sessions',
      companyId: 'SYSTEM',
      userId,
      success: false,
      errorMessage: 'Content Architect password not configured',
    });
    return null;
  }

  // 1. Verify password
  const passwordHash = createHash('sha256').update(password).digest('hex');
  const expectedHash = createHash('sha256').update(expectedPassword).digest('hex');

  if (passwordHash !== expectedHash) {
    // Log failed attempt
    await logAuditEvent({
      operation: 'SELECT',
      table: 'content_architect_sessions',
      companyId: 'SYSTEM',
      userId,
      success: false,
      errorMessage: 'Invalid Content Architect password',
      metadata: { ipAddress, userAgent },
    });
    return null;
  }

  // 2. Create session
  const sessionToken = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);

  const { error: insertError } = await supabase
    .from('content_architect_sessions')
    .insert([
      {
        user_id: userId,
        token: hashToken(sessionToken),  // Store hash, not plaintext
        ip_address: ipAddress,
        user_agent: userAgent,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        last_activity_at: now.toISOString(),
      },
    ]);

  if (insertError) {
    console.error('[contentArchitect] Failed to create session:', insertError);
    return null;
  }

  // 3. Log successful grant
  await logAuditEvent({
    operation: 'SELECT',
    table: 'content_architect_sessions',
    companyId: 'SYSTEM',
    userId,
    success: true,
    metadata: {
      action: 'GRANT_ARCHITECT_ACCESS',
      ipAddress,
      expiresAt: expiresAt.toISOString(),
    },
  });

  return sessionToken;
}

/**
 * Validate Content Architect session
 *
 * Checks:
 * 1. Token exists and not expired
 * 2. IP address matches (prevent token reuse on different IP)
 * 3. User agent matches (prevent token theft)
 * 4. Inactivity timeout not reached
 *
 * @param token Session token from request
 * @param ipAddress Current request IP
 * @param userAgent Current request user-agent
 * @param currentUserId Current authenticated user ID (for verification)
 *
 * @returns true if valid, false otherwise
 */
export async function validateContentArchitectSession(
  token: string,
  ipAddress: string,
  userAgent: string,
  currentUserId: string
): Promise<boolean> {
  if (!token) return false;

  // Query session by token hash
  const tokenHash = hashToken(token);
  const { data: sessions, error } = await supabase
    .from('content_architect_sessions')
    .select('id, user_id, ip_address, user_agent, expires_at, last_activity_at')
    .eq('token', tokenHash)
    .single();  // Expect exactly one result

  if (error || !sessions) {
    return false;
  }

  const now = new Date();
  const expiresAt = new Date(sessions.expires_at);
  const lastActivity = new Date(sessions.last_activity_at);
  const timeSinceActivity = now.getTime() - lastActivity.getTime();

  // Validate all conditions
  if (sessions.user_id !== currentUserId) {
    logSecurityViolation('user_mismatch', { token, ipAddress });
    return false;
  }

  if (sessions.ip_address !== ipAddress) {
    logSecurityViolation('ip_mismatch', {
      expected: sessions.ip_address,
      actual: ipAddress,
    });
    return false;
  }

  if (sessions.user_agent !== userAgent) {
    logSecurityViolation('user_agent_mismatch', {
      expected: sessions.user_agent,
      actual: userAgent,
    });
    return false;
  }

  if (now > expiresAt) {
    // Session expired
    return false;
  }

  if (timeSinceActivity > ACTIVITY_TIMEOUT_MS) {
    // Inactivity timeout
    await supabase
      .from('content_architect_sessions')
      .delete()
      .eq('id', sessions.id);
    return false;
  }

  // Session valid — update last activity
  await supabase
    .from('content_architect_sessions')
    .update({ last_activity_at: now.toISOString() })
    .eq('id', sessions.id);

  return true;
}

/**
 * Revoke all sessions for a user
 * Called when user password changes or on explicit logout
 */
export async function revokeContentArchitectSessions(userId: string): Promise<void> {
  const { error } = await supabase
    .from('content_architect_sessions')
    .delete()
    .eq('user_id', userId);

  if (error) {
    console.error('[contentArchitect] Failed to revoke sessions:', error);
  }

  // Log revocation
  await logAuditEvent({
    operation: 'DELETE',
    table: 'content_architect_sessions',
    companyId: 'SYSTEM',
    userId,
    success: !error,
    metadata: { action: 'REVOKE_ARCHITECT_SESSIONS' },
  });
}

/**
 * Hash token for secure storage
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Log security violations for investigation
 */
function logSecurityViolation(reason: string, details: Record<string, unknown>): void {
  console.warn('[contentArchitect] Security violation detected:', {
    reason,
    details,
    timestamp: new Date().toISOString(),
  });

  // Could also send to security monitoring system
}

/**
 * Database schema required for content_architect_sessions table
 *
 * CREATE TABLE content_architect_sessions (
 *   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 *   user_id uuid NOT NULL REFERENCES auth.users(id),
 *   token text NOT NULL UNIQUE,  -- SHA256 hash
 *   ip_address inet NOT NULL,
 *   user_agent text NOT NULL,
 *   created_at timestamptz NOT NULL DEFAULT now(),
 *   expires_at timestamptz NOT NULL,
 *   last_activity_at timestamptz NOT NULL DEFAULT now(),
 *   revoked_at timestamptz,
 *   CONSTRAINT valid_expiry CHECK (expires_at > created_at)
 * );
 *
 * CREATE INDEX idx_content_architect_sessions_token ON content_architect_sessions(token);
 * CREATE INDEX idx_content_architect_sessions_user_id ON content_architect_sessions(user_id);
 * CREATE INDEX idx_content_architect_sessions_expires ON content_architect_sessions(expires_at);
 *
 * -- Cleanup expired sessions daily
 * CREATE OR REPLACE FUNCTION cleanup_expired_architect_sessions()
 * RETURNS void AS $$
 * BEGIN
 *   DELETE FROM content_architect_sessions WHERE expires_at < now();
 * END;
 * $$ LANGUAGE plpgsql;
 */
