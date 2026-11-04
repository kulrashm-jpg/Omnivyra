/**
 * Per-channel formatter and validator entry points. Each is the shared
 * profile-driven rule set bound to that channel's profile.
 */
import { formatChannelContent, validateChannelContent } from './channelRules';
import {
  COMMUNITY_REPLY_PROFILE,
  EMAIL_PROFILE,
  SMS_PROFILE,
  VOICE_SCRIPT_PROFILE,
  WHATSAPP_PROFILE,
} from './profiles';
import type { ChannelContentFields, FormatResult, ValidationResult } from './types';

type Values = Readonly<Record<string, string | null | undefined>>;

export interface EmailContentInput { readonly subject: string | null | undefined; readonly body: string | null | undefined }
export interface BodyContentInput { readonly body: string | null | undefined }

const fieldsOf = (input: object | null | undefined): ChannelContentFields =>
  (input ?? {}) as ChannelContentFields;

export const validateEmail = (input: EmailContentInput): ValidationResult =>
  validateChannelContent(EMAIL_PROFILE, fieldsOf(input));
export const formatEmail = (input: EmailContentInput, personalization: Values = {}): FormatResult =>
  formatChannelContent(EMAIL_PROFILE, fieldsOf(input), personalization);

export const validateWhatsApp = (input: BodyContentInput): ValidationResult =>
  validateChannelContent(WHATSAPP_PROFILE, fieldsOf(input));
export const formatWhatsApp = (input: BodyContentInput, personalization: Values = {}): FormatResult =>
  formatChannelContent(WHATSAPP_PROFILE, fieldsOf(input), personalization);

export const validateCommunityReply = (input: BodyContentInput): ValidationResult =>
  validateChannelContent(COMMUNITY_REPLY_PROFILE, fieldsOf(input));
export const formatCommunityReply = (input: BodyContentInput, personalization: Values = {}): FormatResult =>
  formatChannelContent(COMMUNITY_REPLY_PROFILE, fieldsOf(input), personalization);

/** Formatting profile only: no SMS provider exists or is activated. */
export const validateSms = (input: BodyContentInput): ValidationResult =>
  validateChannelContent(SMS_PROFILE, fieldsOf(input));
export const formatSms = (input: BodyContentInput, personalization: Values = {}): FormatResult =>
  formatChannelContent(SMS_PROFILE, fieldsOf(input), personalization);

/** Formatting profile only: no voice provider exists or is activated. */
export const validateVoiceScript = (input: BodyContentInput): ValidationResult =>
  validateChannelContent(VOICE_SCRIPT_PROFILE, fieldsOf(input));
export const formatVoiceScript = (input: BodyContentInput, personalization: Values = {}): FormatResult =>
  formatChannelContent(VOICE_SCRIPT_PROFILE, fieldsOf(input), personalization);
