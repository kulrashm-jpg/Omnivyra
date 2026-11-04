/**
 * Outreach channel-content layer — shared types.
 *
 * This layer is PURE: profiles are static data, formatters are deterministic
 * functions of their arguments, and validators return findings instead of
 * throwing. Nothing here reads a database, a clock, a random source, a model or
 * the network, and nothing here sends anything. Values for personalization are
 * passed in by the caller.
 */

export type ChannelId = 'email' | 'whatsapp' | 'community_reply' | 'sms' | 'voice_script' | 'social';

export type FindingSeverity = 'error' | 'warning';

export interface ChannelContentFinding {
  /** Stable machine code, e.g. `length_exceeded`, `personalization_unauthorized`. */
  readonly code: string;
  readonly severity: FindingSeverity;
  readonly message: string;
  /** The content field the finding is about (e.g. `subject`, `body`), when there is one. */
  readonly field?: string;
}

/** SMS encoding. GSM-7 is the default alphabet; anything outside it forces UCS-2. */
export type SmsEncoding = 'gsm7' | 'ucs2';

export interface LengthRule {
  /** Hard maximum, in characters (UTF-16 code units, as JS counts them). Exceeding it is an error. */
  readonly maxCharacters: number;
  /** Minimum non-whitespace length; below it is an error. */
  readonly minCharacters: number;
}

export interface LinkRule {
  readonly allowed: boolean;
  /** Maximum number of links; `null` means no cap beyond `allowed`. */
  readonly maxLinks: number | null;
}

export interface EmojiRule {
  readonly allowed: boolean;
  /** Maximum number of emoji; `null` means no cap beyond `allowed`. */
  readonly maxEmoji: number | null;
}

export interface FieldRule {
  readonly name: string;
  readonly required: boolean;
  readonly length: LengthRule;
  /** A single-line field (an email subject) may not contain a line break. */
  readonly singleLine: boolean;
  readonly links: LinkRule;
  readonly emoji: EmojiRule;
}

export interface SmsSegmentRule {
  /** Maximum number of concatenated segments; more is an error. */
  readonly maxSegments: number;
  /** Encoding policy: `auto` detects; `gsm7_only` makes a UCS-2 body an error. */
  readonly encodingPolicy: 'auto' | 'gsm7_only';
}

export interface ChannelProfile {
  readonly channel: Exclude<ChannelId, 'social'>;
  readonly label: string;
  readonly fields: readonly FieldRule[];
  /**
   * Whether `{{field}}` personalization placeholders may appear at all. When
   * permitted, only fields in the 041-D allow-list are accepted.
   */
  readonly personalizationPermitted: boolean;
  /** SMS only. */
  readonly segments?: SmsSegmentRule;
  /**
   * `formatting_only` marks a profile with NO provider or transport behind it
   * (SMS, voice). It must never be read as a send capability.
   */
  readonly status: 'active' | 'formatting_only';
  /** Where the numbers came from, so a reviewer can challenge them. */
  readonly basis: string;
}

/** Channel content is a flat map of named text fields (e.g. subject, body). */
export type ChannelContentFields = Readonly<Record<string, string | null | undefined>>;

export interface FormattedChannelContent {
  readonly channel: ChannelId;
  readonly fields: Readonly<Record<string, string>>;
  /** Exactly the personalization values substituted, keyed by field name. */
  readonly personalizationUsed: Readonly<Record<string, string>>;
}

export interface FormatResult {
  /** `null` when any error finding exists: the caller gets no usable content. */
  readonly content: FormattedChannelContent | null;
  readonly findings: readonly ChannelContentFinding[];
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly findings: readonly ChannelContentFinding[];
}
