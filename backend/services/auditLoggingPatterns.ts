/**
 * API Route Pattern with Audit Logging
 *
 * Use this pattern in all authenticated API routes that access data.
 * This ensures all data access is logged for compliance.
 *
 * Example Usage:
 * ─────────────────────────────────────────────────────────────
 *
 * // pages/api/campaigns/list.ts
 * import { enforceCompanyAccess } from '@/backend/services/userContextService';
 * import { logAuditEvent } from '@/backend/services/auditLoggingService';
 *
 * export default async function handler(req, res) {
 *   const startTime = Date.now();
 *   let success = false;
 *   let errorMsg: string | undefined;
 *
 *   try {
 *     // 1. Validate access
 *     const context = await enforceCompanyAccess({
 *       req, res,
 *       companyId: req.query.companyId as string,
 *     });
 *     if (!context) return;
 *
 *     // 2. Fetch data
 *     const { data, error } = await supabase
 *       .from('campaigns')
 *       .select('id, name')
 *       .eq('company_id', context.companyId);
 *
 *     if (error) throw error;
 *
 *     success = true;
 *
 *     // 3. Return data
 *     res.status(200).json({ campaigns: data });
 *
 *   } catch (error) {
 *     errorMsg = error instanceof Error ? error.message : String(error);
 *     res.status(500).json({ error: errorMsg });
 *
 *   } finally {
 *     // 4. Log audit event (always)
 *     const context = req.locals?.userContext;
 *     if (context) {
 *       await logAuditEvent({
 *         operation: 'SELECT',
 *         table: 'campaigns',
 *         companyId: context.companyId,
 *         userId: context.userId,
 *         success,
 *         errorMessage: errorMsg,
 *         durationMs: Date.now() - startTime,
 *       });
 *     }
 *   }
 * }
 */

import { logAuditEvent, AuditOperation } from './auditLoggingService';

/**
 * Helper to log audit events with common data
 */
export async function logDataAccess(
  operation: AuditOperation,
  table: string,
  options: {
    companyId: string;
    userId: string;
    recordIds?: string[];
    success: boolean;
    errorMessage?: string;
    durationMs?: number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await logAuditEvent({
      operation,
      table,
      companyId: options.companyId,
      userId: options.userId,
      recordIds: options.recordIds,
      success: options.success,
      errorMessage: options.errorMessage,
      durationMs: options.durationMs,
      metadata: options.metadata,
    });
  } catch (err: unknown) {
    // Don't fail request if audit logging fails
    console.error('[auditLogging] Failed to log event:', err);
  }
}

/**
 * Middleware to attach audit logging to request context
 */
export function auditLoggingMiddleware(req: any, res: any, next: any) {
  // Attach timing
  req.startTime = Date.now();

  // Wrap res.json to log after response is sent
  const originalJson = res.json;
  res.json = function (body: any) {
    // Log to audit trail if user context available
    if (req.userContext && req.auditLog) {
      logAuditEvent(req.auditLog).catch((err) => {
        console.error('[auditLogging] Failed to log:', err);
      });
    }
    return originalJson.call(this, body);
  };

  next();
}
