export const IDENTITY_LINK_STATUSES = ['candidate', 'confirmed', 'rejected'] as const;
export type IdentityLinkStatus = (typeof IDENTITY_LINK_STATUSES)[number];

export const IDENTITY_EVIDENCE_SIGNALS = [
  'username_exact_match',
  'username_normalised_match',
  'username_high_similarity',
  'shared_referenced_domain',
  'shared_referenced_company',
  'explicit_self_link',
  'repeated_identifier',
] as const;
export type IdentityEvidenceSignal = (typeof IDENTITY_EVIDENCE_SIGNALS)[number];

export type AuthorIdentityLink = {
  id: string;
  organization_id: string;
  primary_platform: string;
  primary_handle: string;
  secondary_platform: string;
  secondary_handle: string;
  confidence_score: number;
  evidence_signals: IdentityEvidenceSignal[];
  link_status: IdentityLinkStatus;
  metadata: Record<string, unknown>;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_at: string | null;
  created_at: string;
  updated_at: string;
};

export function canonicaliseHandle(handle: string): string {
  return handle.trim().toLowerCase().replace(/^@+/, '');
}

/**
 * Ordering rule used by the DB CHECK constraint:
 * (primary_platform:primary_handle) < (secondary_platform:secondary_handle)
 * Pre-sort caller inputs so the unique constraint catches (a,b)+(b,a).
 */
export function orderIdentityPair(args: {
  platformA: string;
  handleA: string;
  platformB: string;
  handleB: string;
}): {
  primary_platform: string;
  primary_handle: string;
  secondary_platform: string;
  secondary_handle: string;
} {
  const a = `${args.platformA.toLowerCase()}:${canonicaliseHandle(args.handleA)}`;
  const b = `${args.platformB.toLowerCase()}:${canonicaliseHandle(args.handleB)}`;
  if (a === b) {
    throw new Error('orderIdentityPair: identical pair');
  }
  return a < b
    ? {
        primary_platform: args.platformA.toLowerCase(),
        primary_handle: canonicaliseHandle(args.handleA),
        secondary_platform: args.platformB.toLowerCase(),
        secondary_handle: canonicaliseHandle(args.handleB),
      }
    : {
        primary_platform: args.platformB.toLowerCase(),
        primary_handle: canonicaliseHandle(args.handleB),
        secondary_platform: args.platformA.toLowerCase(),
        secondary_handle: canonicaliseHandle(args.handleA),
      };
}
