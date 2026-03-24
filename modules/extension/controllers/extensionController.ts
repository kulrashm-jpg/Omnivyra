/**
 * Extension Controller
 * 
 * Handles HTTP request/response logic for extension API endpoints.
 * Delegates business logic to services.
 * 
 * Endpoints:
 * 1. POST /api/extension/events
 * 2. GET /api/extension/commands
 * 3. POST /api/extension/action-result
 * 4. POST /api/extension/validate
 */

import { Request, Response } from 'express';
import { ZodError } from 'zod';
import {
  ExtensionEventRequest,
  ExtensionApiResponse,
  validateEventRequest,
  validateCommandResultRequest,
  validateSessionRequest,
  validateGetCommandsQuery,
  CommandResultRequest,
  GetCommandsQuery,
  ValidateSessionRequest,
} from '../validators/extensionValidators';
import { ExtensionEventService } from '../services/extensionEventService';
import { ExtensionCommandService } from '../services/extensionCommandService';
import { ExtensionAuthService } from '../services/extensionAuthService';
import { ValidatedExtensionEvent, PlatformType } from '../types/extension.types';

// ============================================================================
// CONTROLLER CLASS
// ============================================================================

export class ExtensionController {
  constructor(
    private eventService: ExtensionEventService,
    private commandService: ExtensionCommandService,
    private authService: ExtensionAuthService
  ) {}

  // ============================================================================
  // ENDPOINT HANDLERS
  // ============================================================================

  /**
   * POST /api/extension/events
   * 
   * Receives raw event from Chrome extension.
   * No business logic, just validation and storage.
   * 
   * Request body:
   * {
   *   "platform": "linkedin",
   *   "event_type": "comment",
   *   "data": {...},
   *   "timestamp": 1234567890000
   * }
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": { "event_id": "uuid" },
   *   "timestamp": 1234567890000
   * }
   */
  async handlePostEvent(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      let eventRequest: ExtensionEventRequest;
      try {
        eventRequest = validateEventRequest(req.body);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({
            success: false,
            error: `Validation error: ${error.errors[0].message}`,
            timestamp: Date.now(),
          } as ExtensionApiResponse<never>);
          return;
        }
        throw error;
      }

      // Ensure extension user is authenticated
      if (!req.extensionUser) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized',
          timestamp: Date.now(),
        } as ExtensionApiResponse<never>);
        return;
      }

      // Build validated event with user context
      const validatedEvent: ValidatedExtensionEvent = {
        platform: eventRequest.platform,
        event_type: eventRequest.event_type,
        platform_message_id: eventRequest.platform_message_id,
        data: eventRequest.data,
        timestamp: eventRequest.timestamp,
        user_id: req.extensionUser.user_id,
        org_id: req.extensionUser.org_id,
        source: 'extension',
      };

      // Ingest event
      const result = await this.eventService.ingestEvent(validatedEvent);

      // Return success response
      res.status(202).json({
        success: true,
        data: result,
        timestamp: Date.now(),
      } as ExtensionApiResponse<{ event_id: string }>);
    } catch (error) {
      console.error('[ExtensionController] handlePostEvent error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to ingest event',
        timestamp: Date.now(),
      } as ExtensionApiResponse<never>);
    }
  }

  /**
   * GET /api/extension/commands
   * 
   * Extension polls for pending commands.
   * Response includes array of commands to execute.
   * 
   * Query params:
   * - platform (optional): filter by 'linkedin' or 'youtube'
   * - limit (optional): max results (default: 10, max: 100)
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": [
   *     {
   *       "command_id": "uuid",
   *       "platform": "linkedin",
   *       "action_type": "post_reply",
   *       "target_id": "thread_id",
   *       "payload": {...},
   *       "created_at": "2026-03-23T...",
   *       "status": "pending"
   *     }
   *   ],
   *   "timestamp": 1234567890000
   * }
   */
  async handleGetCommands(req: Request, res: Response): Promise<void> {
    try {
      // Validate query parameters
      let query: GetCommandsQuery;
      try {
        query = validateGetCommandsQuery(req.query);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({
            success: false,
            error: `Invalid query: ${error.errors[0].message}`,
            timestamp: Date.now(),
          } as ExtensionApiResponse<never>);
          return;
        }
        throw error;
      }

      // Ensure authenticated
      if (!req.extensionUser) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized',
          timestamp: Date.now(),
        } as ExtensionApiResponse<never>);
        return;
      }

      // Fetch pending commands
      const commands = await this.commandService.getPendingCommands(
        req.extensionUser.user_id,
        req.extensionUser.org_id,
        query.platform,
        query.limit
      );

      // Return success response
      res.status(200).json({
        success: true,
        data: commands,
        timestamp: Date.now(),
      } as ExtensionApiResponse<typeof commands>);
    } catch (error) {
      console.error('[ExtensionController] handleGetCommands error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch commands',
        timestamp: Date.now(),
      } as ExtensionApiResponse<never>);
    }
  }

  /**
   * POST /api/extension/action-result
   * 
   * Extension reports command execution result.
   * Updates command status and stores result for audit.
   * 
   * Request body:
   * {
   *   "command_id": "uuid",
   *   "status": "success",
   *   "result": {
   *     "success": true,
   *     "platform_response": {...}
   *   }
   * }
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": { "status": "success" },
   *   "timestamp": 1234567890000
   * }
   */
  async handleCommandResult(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      let resultRequest: CommandResultRequest;
      try {
        resultRequest = validateCommandResultRequest(req.body);
      } catch (error) {
        if (error instanceof ZodError) {
          res.status(400).json({
            success: false,
            error: `Validation error: ${error.errors[0].message}`,
            timestamp: Date.now(),
          } as ExtensionApiResponse<never>);
          return;
        }
        throw error;
      }

      // Ensure authenticated
      if (!req.extensionUser) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized',
          timestamp: Date.now(),
        } as ExtensionApiResponse<never>);
        return;
      }

      // Update command status
      const updated = await this.commandService.updateCommandStatus(
        resultRequest.command_id,
        resultRequest.status as any,
        resultRequest.result
      );

      // TODO: Trigger post-execution handlers
      // - Deduct credits
      // - Mark opportunity resolved
      // - Send notification
      // - Update analytics

      res.status(200).json({
        success: true,
        data: { status: updated.status },
        timestamp: Date.now(),
      } as ExtensionApiResponse<{ status: string }>);
    } catch (error) {
      console.error('[ExtensionController] handleCommandResult error:', error);
      res.status(500).json({
        success: false,
        error:
          error instanceof Error ? error.message : 'Failed to update command status',
        timestamp: Date.now(),
      } as ExtensionApiResponse<never>);
    }
  }

  /**
   * POST /api/extension/validate
   * 
   * ✓ PROTECTED: Requires Authorization header with Bearer token
   * 
   * Request headers:
   * Authorization: Bearer <valid_session_token>
   * 
   * Response:
   * {
   *   "success": true,
   *   "data": {
   *     "valid": true,
   *     "user_id": "uuid",
   *     "org_id": "uuid",
   *     "sync_mode": "batch",
   *     "polling_interval": 30
   *   },
   *   "timestamp": 1234567890000
   * }
   */
  async handleValidateSession(req: Request, res: Response): Promise<void> {
    try {
      // ✓ Require authentication (Bearer token in Authorization header)
      if (!req.extensionUser) {
        res.status(401).json({
          success: false,
          error: 'Unauthorized - missing or invalid Authorization header',
          timestamp: Date.now(),
        } as ExtensionApiResponse<never>);
        return;
      }

      // Return session info from authenticated context
      res.status(200).json({
        success: true,
        data: {
          valid: true,
          user_id: req.extensionUser.user_id,
          org_id: req.extensionUser.org_id,
          sync_mode: 'batch',
          polling_interval: 30,
        },
        timestamp: Date.now(),
      } as ExtensionApiResponse<{
        valid: boolean;
        user_id: string;
        org_id: string;
        sync_mode: string;
        polling_interval: number;
      }>);
    } catch (error) {
      console.error('[ExtensionController] handleValidateSession error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to validate session',
        timestamp: Date.now(),
      } as ExtensionApiResponse<never>);
    }
  }

  // ============================================================================
  // HEALTH & MONITORING
  // ============================================================================

  /**
   * GET /api/extension/health
   * 
   * Returns service health metrics
   * Called by monitoring systems
   */
  async handleHealth(req: Request, res: Response): Promise<void> {
    try {
      const eventMetrics = await this.eventService.getMetrics();
      const commandMetrics = await this.commandService.getMetrics();

      res.status(200).json({
        success: true,
        data: {
          status: 'healthy',
          events: eventMetrics,
          commands: commandMetrics,
          timestamp: new Date().toISOString(),
        },
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error('[ExtensionController] handleHealth error:', error);
      res.status(500).json({
        success: false,
        error: 'Health check failed',
        timestamp: Date.now(),
      } as ExtensionApiResponse<never>);
    }
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createExtensionController(
  eventService: ExtensionEventService,
  commandService: ExtensionCommandService,
  authService: ExtensionAuthService
): ExtensionController {
  return new ExtensionController(eventService, commandService, authService);
}
