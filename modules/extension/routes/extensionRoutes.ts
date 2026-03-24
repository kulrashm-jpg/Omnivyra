/**
 * Extension Routes
 * 
 * Defines all extension API endpoints.
 * Mounts under /api/extension in main app.
 * 
 * Routes:
 * - POST   /api/extension/events          (ingest event)
 * - GET    /api/extension/commands        (fetch pending commands)
 * - POST   /api/extension/action-result   (report execution result)
 * - POST   /api/extension/validate        (validate session)
 * - GET    /api/extension/health          (health check)
 */

import { Router } from 'express';
import { extensionAuthMiddleware, requireExtensionUser, extensionRequestLogger } from '../../../middleware/extensionAuthMiddleware';
import { ExtensionController } from '../controllers/extensionController';
import { extensionEventService } from '../services/extensionEventService';
import { extensionCommandService } from '../services/extensionCommandService';
import { extensionAuthService } from '../services/extensionAuthService';

// ============================================================================
// SETUP
// ============================================================================

const router = Router();

// Create controller
const controller = new ExtensionController(
  extensionEventService,
  extensionCommandService,
  extensionAuthService
);

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Log all requests
router.use(extensionRequestLogger);

// ============================================================================
// PUBLIC ROUTES (minimal - health only)
// ============================================================================

/**
 * ⚠️ REMOVED: POST /api/extension/validate
 * This was a security hole - MOVED to protected routes
 * See: POST /api/extension/validate (below, requires auth)
 */

/**
 * GET /api/extension/health
 * 
 * Health check endpoint for monitoring systems.
 * Public endpoint (for k8s, monitoring).
 * 
 * Example request:
 * ```bash
 * curl http://localhost:3000/api/extension/health
 * ```
 * 
 * Example response (200 OK):
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "status": "healthy",
 *     "events": {
 *       "total_events": 1234,
 *       "unprocessed_events": 45,
 *       "by_platform": {
 *         "linkedin": 800,
 *         "youtube": 434
 *       },
 *       "by_event_type": {
 *         "comment": 600,
 *         "dm": 200,
 *         "mention": 100,
 *         "like": 250,
 *         "share": 84,
 *         "reply": 0
 *       }
 *     },
 *     "commands": {
 *       "total_commands": 567,
 *       "pending": 23,
 *       "executing": 2,
 *       "success": 520,
 *       "failed": 22,
 *       "cancelled": 0
 *     },
 *     "timestamp": "2026-03-23T12:34:56.000Z"
 *   },
 *   "timestamp": 1679596800000
 * }
 * ```
 */
router.get('/health', (req, res) => controller.handleHealth(req, res));

// ============================================================================
// PROTECTED ROUTES (auth required)
// ============================================================================

// Apply authentication middleware to all protected routes
router.use(extensionAuthMiddleware(extensionAuthService));
router.use(requireExtensionUser);

/**
 * POST /api/extension/events
 * 
 * Ingests raw event from Chrome extension.
 * Called every time user interacts with LinkedIn/YouTube.
 * 
 * Authorization: Bearer <session_token>
 * 
 * Example request:
 * ```bash
 * curl -X POST http://localhost:3000/api/extension/events \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer 3c5a5c7d9f2e1a8b4c6d9e1f3a5b7c9d1e2f4a5b6c7d8e9f0a1b2c3d4e5f6a" \
 *   -d {
 *     "platform": "linkedin",
 *     "event_type": "comment",
 *     "data": {
 *       "thread_id": "post_123456789",
 *       "comment_id": "comment_987654321",
 *       "comment_text": "This is a great insight!",
 *       "author": {
 *         "name": "John Doe",
 *         "profile_url": "https://linkedin.com/in/johndoe",
 *         "profile_id": "johndoe_123"
 *       },
 *       "created_at": 1679596800000
 *     },
 *     "timestamp": 1679596800000
 *   }
 * ```
 * 
 * Example response (202 Accepted):
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "event_id": "550e8400-e29b-41d4-a716-446655440000"
 *   },
 *   "timestamp": 1679596800000
 * }
 * ```
 * 
 * Example response (400 Bad Request):
 * ```json
 * {
 *   "success": false,
 *   "error": "Validation error: [\"platform\"] is required",
 *   "timestamp": 1679596800000
 * }
 * ```
 * 
 * Example response (401 Unauthorized):
 * ```json
 * {
 *   "success": false,
 *   "error": "Invalid or expired session token",
 *   "timestamp": 1679596800000
 * }
 * ```
 */
router.post('/events', (req, res) => controller.handlePostEvent(req, res));

/**
 * GET /api/extension/commands
 * 
 * Extension polls for pending commands.
 * Called every 30 seconds (configurable).
 * 
 * Authorization: Bearer <session_token>
 * 
 * Query params:
 * - platform (optional): 'linkedin' or 'youtube'
 * - limit (optional): max results (1-100, default: 10)
 * 
 * Example request:
 * ```bash
 * curl "http://localhost:3000/api/extension/commands?platform=linkedin&limit=5" \
 *   -H "Authorization: Bearer 3c5a5c7d9f2e1a8b4c6d9e1f3a5b7c9d1e2f4a5b6c7d8e9f0a1b2c3d4e5f6a"
 * ```
 * 
 * Example response (200 OK):
 * ```json
 * {
 *   "success": true,
 *   "data": [
 *     {
 *       "command_id": "660e8400-f29b-41d4-a716-446655441234",
 *       "platform": "linkedin",
 *       "action_type": "post_reply",
 *       "target_id": "comment_987654321",
 *       "payload": {
 *         "text": "Thanks for the comment! Here's my take on this...",
 *         "media_ids": []
 *       },
 *       "created_at": "2026-03-23T12:00:00.000Z",
 *       "expires_at": "2026-03-23T12:15:00.000Z",
 *       "status": "pending"
 *     },
 *     {
 *       "command_id": "770e8400-g29b-41d4-a716-446655442345",
 *       "platform": "linkedin",
 *       "action_type": "like",
 *       "target_id": "comment_987654322",
 *       "payload": {},
 *       "created_at": "2026-03-23T12:01:00.000Z",
 *       "expires_at": "2026-03-23T12:16:00.000Z",
 *       "status": "pending"
 *     }
 *   ],
 *   "timestamp": 1679596800000
 * }
 * ```
 * 
 * Example response (empty):
 * ```json
 * {
 *   "success": true,
 *   "data": [],
 *   "timestamp": 1679596800000
 * }
 * ```
 */
router.get('/commands', (req, res) => controller.handleGetCommands(req, res));

/**
 * POST /api/extension/validate
 * 
 * ✓ NOW PROTECTED: Validates session (requires Bearer token)
 * Called by extension during startup to verify token is still valid.
 * Returns user_id, org_id, polling config.
 * 
 * Authorization: Bearer <session_token>
 * 
 * Example request:
 * ```bash
 * curl -X POST http://localhost:3000/api/extension/validate \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer 3c5a5c7d..." \
 *   -d {}
 * ```
 * 
 * Example response (200 OK):
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "valid": true,
 *     "user_id": "123e4567-e89b-12d3-a456-426614174000",
 *     "org_id": "987f6543-cb21-43d2-b456-987654321000",
 *     "sync_mode": "batch",
 *     "polling_interval": 30
 *   },
 *   "timestamp": 1679596800000
 * }
 * ```
 */
router.post('/validate', (req, res) => controller.handleValidateSession(req, res));

/**
 * POST /api/extension/action-result
 * 
 * Extension reports command execution result.
 * Called after executing command on platform.
 * 
 * Authorization: Bearer <session_token>
 * 
 * Example request (success):
 * ```bash
 * curl -X POST http://localhost:3000/api/extension/action-result \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer 3c5a5c7d9f2e1a8b4c6d9e1f3a5b7c9d1e2f4a5b6c7d8e9f0a1b2c3d4e5f6a" \
 *   -d {
 *     "command_id": "660e8400-f29b-41d4-a716-446655441234",
 *     "status": "success",
 *     "result": {
 *       "success": true,
 *       "message": "Reply posted successfully",
 *       "platform_response": {
 *         "post_id": "reply_123456789",
 *         "timestamp": 1679596800000
 *       }
 *     }
 *   }
 * ```
 * 
 * Example request (failure):
 * ```bash
 * curl -X POST http://localhost:3000/api/extension/action-result \
 *   -H "Content-Type: application/json" \
 *   -H "Authorization: Bearer 3c5a5c7d9f2e1a8b4c6d9e1f3a5b7c9d1e2f4a5b6c7d8e9f0a1b2c3d4e5f6a" \
 *   -d {
 *     "command_id": "660e8400-f29b-41d4-a716-446655441234",
 *     "status": "failed",
 *     "result": {
 *       "success": false,
 *       "error": "Comment already deleted by author",
 *       "platform_response": {
 *         "code": 404,
 *         "message": "Resource not found"
 *       }
 *     }
 *   }
 * ```
 * 
 * Example response (200 OK):
 * ```json
 * {
 *   "success": true,
 *   "data": {
 *     "status": "success"
 *   },
 *   "timestamp": 1679596800000
 * }
 * ```
 * 
 * Example response (400 Bad Request):
 * ```json
 * {
 *   "success": false,
 *   "error": "Validation error: [\"status\"] must be one of ['success', 'failed']",
 *   "timestamp": 1679596800000
 * }
 * ```
 */
router.post('/action-result', (req, res) => controller.handleCommandResult(req, res));

// ============================================================================
// EXPORTS
// ============================================================================

export default router;
