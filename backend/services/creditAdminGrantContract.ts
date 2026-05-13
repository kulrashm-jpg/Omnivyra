export const ADMIN_GRANT_REASON_TYPES = [
  'customer_support',
  'goodwill',
  'promotional',
  'beta_feedback',
  'compensation',
  'correction',
  'other',
] as const;

export type AdminGrantReasonType = typeof ADMIN_GRANT_REASON_TYPES[number];

export const DEFAULT_ADMIN_GRANT_EXPIRY_DAYS = 14;
export const ADMIN_GRANT_MAX_PER_DAY = 3;

export type AdminGrantErrorCode =
  | 'MISSING_ORG'
  | 'MISSING_REASON'
  | 'INVALID_REASON_TYPE'
  | 'INVALID_CREDITS'
  | 'INVALID_EXPIRY'
  | 'GRANT_LIMIT_EXCEEDED'
  | 'LEDGER_FAILED';

export type AdminGrantResult =
  | {
      ok: true;
      credits: number;
      idempotencyKey: string;
      expiresAt: string | null;
    }
  | {
      ok: false;
      error: string;
      code: AdminGrantErrorCode;
    };
