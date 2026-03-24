/**
 * Extension Authentication Middleware
 * 
 * Validates extension session tokens and attaches user context to request.
 * Separate from main app authentication (OAuth, JWT).
 * 
 * IMPORTANT: This is extension-specific and does NOT use existing user auth.
 */

import { Request, Response, NextFunction } from 'express';
import { ExtensionUser } from '../modules/extension/types/extension.types';
import { ExtensionAuthService } from '../modules/extension/services/extensionAuthService';

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * Extended Express Request with extension user context
 */
declare global {
  namespace Express {
    interface Request {
      extensionUser?: ExtensionUser;
    }
  }
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Validates extension session token from Authorization header
 * 
 * Expected header:
 *   Authorization: Bearer <session_token>
 * 
 * Attaches to req.extensionUser on success
 * Returns 401 on failure
 * 
 * @param authService Instance of extension auth service
 * @returns Express middleware function
 */
export function extensionAuthMiddleware(
  authService: ExtensionAuthService
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Extract token from Authorization header
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({
          success: false,
          error: 'Missing or invalid Authorization header',
          timestamp: Date.now(),
        });
        return;
      }

      const sessionToken = authHeader.substring('Bearer '.length).trim();

      if (!sessionToken) {
        res.status(401).json({
          success: false,
          error: 'Empty session token',
          timestamp: Date.now(),
        });
        return;
      }

      // Validate session token
      const session = await authService.validateSession(sessionToken);
      if (!session) {
        res.status(401).json({
          success: false,
          error: 'Invalid or expired session token',
          timestamp: Date.now(),
        });
        return;
      }

      // Attach extension user to request
      req.extensionUser = {
        user_id: session.user_id,
        org_id: session.org_id,
        session_token: sessionToken,
      };

      next();
    } catch (error) {
      console.error('[Extension Auth Middleware] Error:', error);
      res.status(500).json({
        success: false,
        error: 'Authentication service error',
        timestamp: Date.now(),
      });
    }
  };
}

// ============================================================================
// UTILITY MIDDLEWARE
// ============================================================================

/**
 * Ensures extensionUser is present on request
 * Use after extensionAuthMiddleware to enforce protection
 */
export function requireExtensionUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.extensionUser) {
    res.status(401).json({
      success: false,
      error: 'Extension authentication required',
      timestamp: Date.now(),
    });
    return;
  }

  next();
}

/**
 * Logs extension API requests
 * Optional middleware for debugging
 */
export function extensionRequestLogger(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[Extension API] ${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`, {
      user_id: req.extensionUser?.user_id,
      org_id: req.extensionUser?.org_id,
    });
  });

  next();
}
