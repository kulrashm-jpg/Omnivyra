/**
 * Extension Module Validators
 * 
 * Zod schemas for request validation.
 * Ensures type safety at API boundaries.
 */

import { z } from 'zod';
import { EventType, PlatformType } from '../types/extension.types';

// ============================================================================
// ENUM VALIDATORS
// ============================================================================

const PlatformSchema = z.enum([PlatformType.LINKEDIN, PlatformType.YOUTUBE]);

const EventTypeSchema = z.enum([
  EventType.COMMENT,
  EventType.DM,
  EventType.MENTION,
  EventType.LIKE,
  EventType.SHARE,
  EventType.REPLY,
]);

// ============================================================================
// REQUEST VALIDATORS
// ============================================================================

/**
 * POST /api/extension/events
 * Validates raw event from extension
 */
export const ExtensionEventRequestSchema = z.object({
  platform: PlatformSchema.describe('Target platform'),
  event_type: EventTypeSchema.describe('Type of engagement event'),
  platform_message_id: z.string().min(1).describe('Unique ID from platform (for dedup)'),
  data: z.record(z.unknown()).describe('Platform-specific raw data'),
  timestamp: z.number().int().positive().describe('Unix timestamp in ms'),
});

export type ExtensionEventRequest = z.infer<typeof ExtensionEventRequestSchema>;

/**
 * GET /api/extension/commands?platform=linkedin
 * Query params validation
 */
// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface ExtensionApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

/**
 * GET /api/extension/commands?platform=linkedin
 * Query params validation
 */
export const GetCommandsQuerySchema = z.object({
  platform: PlatformSchema.optional().describe('Filter by platform'),
  limit: z.coerce.number().min(1).max(100).default(10).describe('Max results'),
});

export type GetCommandsQuery = z.infer<typeof GetCommandsQuerySchema>;

/**
 * POST /api/extension/action-result
 * Validates command execution result
 */
export const CommandResultRequestSchema = z.object({
  command_id: z.string().uuid().describe('UUID of executed command'),
  status: z
    .enum(['success', 'failed'])
    .describe('Execution status'),
  result: z
    .object({
      success: z.boolean(),
      message: z.string().optional(),
      platform_response: z.record(z.unknown()).optional(),
      error: z.string().optional(),
    })
    .describe('Execution details'),
});

export type CommandResultRequest = z.infer<typeof CommandResultRequestSchema>;

/**
 * POST /api/extension/validate
 * 
 * ✓ NOW PROTECTED: Requires Authorization: Bearer <token> header
 * Token MUST match the authenticated user's session.
 * 
 * No body required - authentication handled via header.
 */
export const ValidateSessionRequestSchema = z.object({});

export type ValidateSessionRequest = z.infer<typeof ValidateSessionRequestSchema>;

// ============================================================================
// RESPONSE VALIDATORS
// ============================================================================

/**
 * API Success Response wrapper
 */
export const ApiSuccessResponseSchema = <T extends z.ZodTypeAny>(schema: T) =>
  z.object({
    success: z.literal(true),
    data: schema,
    timestamp: z.number(),
  });

/**
 * API Error Response wrapper
 */
export const ApiErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
  timestamp: z.number(),
});

// ============================================================================
// PAYLOAD VALIDATORS
// ============================================================================

/**
 * LinkedIn comment event data
 * Example of platform-specific payload validation
 */
export const LinkedinCommentEventDataSchema = z.object({
  thread_id: z.string().describe('LinkedIn thread/post ID'),
  comment_id: z.string().describe('LinkedIn comment ID'),
  comment_text: z.string().describe('Comment content'),
  author: z.object({
    name: z.string(),
    profile_url: z.string().url(),
    profile_id: z.string(),
  }),
  created_at: z.number().describe('Unix timestamp'),
});

/**
 * YouTube comment event data
 */
export const YoutubeCommentEventDataSchema = z.object({
  video_id: z.string().describe('YouTube video ID'),
  comment_id: z.string().describe('YouTube comment ID'),
  comment_text: z.string().describe('Comment content'),
  author: z.object({
    name: z.string(),
    channel_id: z.string(),
    channel_url: z.string().url(),
  }),
  created_at: z.number().describe('Unix timestamp'),
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Parse and validate extension event request
 * Throws ZodError if invalid
 */
export function validateEventRequest(
  data: unknown
): ExtensionEventRequest {
  return ExtensionEventRequestSchema.parse(data);
}

/**
 * Parse and validate command result request
 */
export function validateCommandResultRequest(
  data: unknown
): CommandResultRequest {
  return CommandResultRequestSchema.parse(data);
}

/**
 * Parse and validate session token request
 */
export function validateSessionRequest(
  data: unknown
): ValidateSessionRequest {
  return ValidateSessionRequestSchema.parse(data);
}

/**
 * Parse and validate query parameters
 */
export function validateGetCommandsQuery(
  data: unknown
): GetCommandsQuery {
  return GetCommandsQuerySchema.parse(data);
}
