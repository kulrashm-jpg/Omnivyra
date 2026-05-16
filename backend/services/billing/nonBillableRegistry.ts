/**
 * Non-Billable Action Registry — Phase 3 B
 *
 * Enterprise-safe management of intentional bypasses around the credit
 * orchestrator. Every entry MUST declare:
 *
 *   - action_key            (the aiGateway operation name or service entry)
 *   - reason                (human-readable justification)
 *   - approved_by           (super-admin user id)
 *   - category              (taxonomy: see NON_BILLABLE_CATEGORIES below)
 *   - owner_user_id         (point-of-contact for review)
 *   - expires_at            (optional auto-rotation date)
 *
 * The registry is backed by the existing `credit_untracked_actions` table
 * introduced in Phase 1's migration 20260663 (immutable at update; can be
 * rotated by inserting a new row with a fresh expires_at).
 *
 * Categories define HOW the entry should be reviewed at audit time:
 *
 *   inside_orchestrated_scope    — inner helper of an outer wrapped flow
 *                                  (e.g. parsing inside a campaign-plan generation
 *                                  that's already billed at the orchestrator level)
 *   internal_tool                — admin / ops / debugging surface
 *   pre_purchase_preview         — UI preview before user commits to spend
 *   system_internal_summary      — telemetry / system-internal summary
 *                                  (no user-facing output)
 *   regex_false_positive         — caught by guard regex but not actually an aiGateway call
 *
 * Each category implies a different review cadence; the registry exposes
 * helpers for auditors to scope their review.
 */

import { supabase } from '../../db/supabaseClient';
import { logger } from '../logger';
import { emitAnomaly } from './billingAuditEmitter';

export const NON_BILLABLE_CATEGORIES = [
  'inside_orchestrated_scope',
  'internal_tool',
  'pre_purchase_preview',
  'system_internal_summary',
  'regex_false_positive',
] as const;

export type NonBillableCategory = typeof NON_BILLABLE_CATEGORIES[number];

export interface NonBillableEntry {
  actionKey:    string;
  reason:       string;
  approvedBy:   string;
  category:     NonBillableCategory;
  ownerUserId:  string;
  expiresAt?:   string | null;
  metadata?:    Record<string, unknown>;
}

export interface RegisteredEntry extends NonBillableEntry {
  registeredAt: string;
  expired:      boolean;
  daysUntilExpiry: number | null;
}

export interface StaticNonBillableScopeRule {
  filePattern:  string;
  category:     NonBillableCategory;
  reason:       string;
  ownerUserId:  string;
  approvedBy:   string;
  reviewCadence: 'pre_ga' | 'quarterly' | 'annual';
}

export const STATIC_NON_BILLABLE_AI_SCOPE_RULES: StaticNonBillableScopeRule[] = [
  {
    filePattern: 'backend/queue/jobProcessors/creatorContentProcessor.ts',
    category: 'inside_orchestrated_scope',
    reason: 'Creator content queue processor inner AI calls are charged by the enclosing queued billing scope.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'backend/services/',
    category: 'inside_orchestrated_scope',
    reason: 'Service-layer AI helper calls are entered from billed HTTP, queue, or orchestration scopes documented in the pre-GA advisory.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'lib/blog/',
    category: 'inside_orchestrated_scope',
    reason: 'Blog generation sub-passes are charged by the outer blog generation or regeneration workflow.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'lib/content/',
    category: 'inside_orchestrated_scope',
    reason: 'Long-form planning and quality passes are charged by the outer content generation workflow.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'lib/newsletter/',
    category: 'inside_orchestrated_scope',
    reason: 'Newsletter generation repair and expansion passes are charged by the outer newsletter workflow.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'pages/api/activity-workspace/content.ts',
    category: 'inside_orchestrated_scope',
    reason: 'Activity workspace improve flows use runReservedFixedWorkflow; refine_variant is separately gated for customer-impact rollout.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'pre_ga',
  },
  {
    filePattern: 'pages/api/admin/blog/',
    category: 'internal_tool',
    reason: 'Super-admin blog authoring helpers are internal operations and not customer-billable.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'pages/api/track/ai-insights.ts',
    category: 'system_internal_summary',
    reason: 'Track AI insights are system-internal summaries with no customer-facing generated artifact.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'pages/api/bolt/campaign-chat.ts',
    category: 'inside_orchestrated_scope',
    reason: 'BOLT campaign chat generation is covered by the enclosing BOLT pipeline billing scope.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'pages/api/command-center/creator-content/generate.ts',
    category: 'inside_orchestrated_scope',
    reason: 'Creator command-center generation is covered by the creator content generation billing scope.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'pages/api/content/quick-platform-adapt.ts',
    category: 'inside_orchestrated_scope',
    reason: 'Quick platform adaptation is invoked inside the wrapped repurpose/adaptation workflow.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'pages/api/engagement/refine-suggestion.ts',
    category: 'inside_orchestrated_scope',
    reason: 'Engagement refinement is part of the reply-generation billing scope.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
  {
    filePattern: 'pages/api/planner/',
    category: 'inside_orchestrated_scope',
    reason: 'Planner generation helpers are inner steps of the billed planner workflow.',
    ownerUserId: 'billing-ops',
    approvedBy: 'finance-admin',
    reviewCadence: 'quarterly',
  },
];

const CATEGORY_REVIEW_WINDOW_DAYS: Record<NonBillableCategory, number | null> = {
  inside_orchestrated_scope: 365,
  internal_tool:             180,
  pre_purchase_preview:      90,
  system_internal_summary:   365,
  regex_false_positive:      null,  // never expires
};

/**
 * Idempotent registration. Re-registering the same action_key replaces
 * the previous (expired) entry — at the DB layer this is a fresh INSERT
 * because the table is immutable; the lookup picks the latest non-expired.
 */
export async function registerNonBillable(entry: NonBillableEntry): Promise<{
  ok: boolean;
  error?: string;
  expiresAt?: string | null;
}> {
  if (!entry.actionKey?.trim())  return { ok: false, error: 'actionKey required' };
  if (!entry.reason?.trim())     return { ok: false, error: 'reason required' };
  if (!entry.approvedBy)         return { ok: false, error: 'approvedBy required' };
  if (!entry.ownerUserId)        return { ok: false, error: 'ownerUserId required' };
  if (!(NON_BILLABLE_CATEGORIES as readonly string[]).includes(entry.category)) {
    return { ok: false, error: `category must be one of: ${NON_BILLABLE_CATEGORIES.join(', ')}` };
  }

  const reviewDays = CATEGORY_REVIEW_WINDOW_DAYS[entry.category];
  const expiresAt = entry.expiresAt !== undefined
    ? entry.expiresAt
    : (reviewDays !== null ? new Date(Date.now() + reviewDays * 86400_000).toISOString() : null);

  const { error } = await supabase
    .from('credit_untracked_actions')
    .upsert(
      {
        action_key:  entry.actionKey,
        reason:      entry.reason,
        approved_by: entry.approvedBy,
        expires_at:  expiresAt,
        metadata:    {
          category:       entry.category,
          owner_user_id:  entry.ownerUserId,
          ...(entry.metadata ?? {}),
        },
      },
      { onConflict: 'action_key', ignoreDuplicates: false },
    );

  if (error) {
    logger.error('non_billable_register_failed', { actionKey: entry.actionKey, message: error.message });
    return { ok: false, error: error.message };
  }
  return { ok: true, expiresAt };
}

export async function getRegisteredEntry(actionKey: string): Promise<RegisteredEntry | null> {
  const { data, error } = await supabase
    .from('credit_untracked_actions')
    .select('action_key, reason, approved_by, expires_at, metadata, created_at')
    .eq('action_key', actionKey)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
  const expiresAt = (row.expires_at as string | null) ?? null;
  const expired = expiresAt !== null && Date.parse(expiresAt) < Date.now();
  const daysUntilExpiry = expiresAt !== null
    ? Math.floor((Date.parse(expiresAt) - Date.now()) / 86400_000)
    : null;

  return {
    actionKey:       String(row.action_key),
    reason:          String(row.reason),
    approvedBy:      String(row.approved_by),
    category:        (metadata.category as NonBillableCategory) ?? 'internal_tool',
    ownerUserId:     String(metadata.owner_user_id ?? row.approved_by),
    expiresAt,
    metadata,
    registeredAt:    String(row.created_at),
    expired,
    daysUntilExpiry,
  };
}

export interface RegistryAuditResult {
  totalEntries:      number;
  byCategory:        Record<NonBillableCategory, number>;
  expiredCount:      number;
  expiringSoonCount: number;        // within 14 days
  missingOwnerCount: number;
  missingReasonCount: number;
  expiredEntries:    Array<Pick<RegisteredEntry, 'actionKey' | 'category' | 'expiresAt'>>;
}

/**
 * Inspect the entire registry. Used by the CI guard to fail PRs that
 * leave expired or malformed entries, and by the dashboard.
 */
export async function auditRegistry(): Promise<RegistryAuditResult> {
  const { data, error } = await supabase
    .from('credit_untracked_actions')
    .select('action_key, reason, approved_by, expires_at, metadata, created_at');

  if (error) {
    logger.warn('non_billable_audit_failed', { message: error.message });
    return {
      totalEntries:        0,
      byCategory:          emptyCategoryCounts(),
      expiredCount:        0,
      expiringSoonCount:   0,
      missingOwnerCount:   0,
      missingReasonCount:  0,
      expiredEntries:      [],
    };
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const now = Date.now();
  const result: RegistryAuditResult = {
    totalEntries:        rows.length,
    byCategory:          emptyCategoryCounts(),
    expiredCount:        0,
    expiringSoonCount:   0,
    missingOwnerCount:   0,
    missingReasonCount:  0,
    expiredEntries:      [],
  };

  for (const r of rows) {
    const metadata = (r.metadata as Record<string, unknown> | null) ?? {};
    const category = ((metadata.category as string) ?? 'internal_tool') as NonBillableCategory;
    if ((NON_BILLABLE_CATEGORIES as readonly string[]).includes(category)) {
      result.byCategory[category] += 1;
    }
    const owner = metadata.owner_user_id;
    if (!owner) result.missingOwnerCount += 1;
    const reason = r.reason as string | undefined;
    if (!reason?.trim()) result.missingReasonCount += 1;
    const expiresAt = r.expires_at as string | null;
    if (expiresAt && Date.parse(expiresAt) < now) {
      result.expiredCount += 1;
      result.expiredEntries.push({
        actionKey: String(r.action_key),
        category,
        expiresAt,
      });
    } else if (expiresAt && Date.parse(expiresAt) - now < 14 * 86400_000) {
      result.expiringSoonCount += 1;
    }
  }
  return result;
}

function emptyCategoryCounts(): Record<NonBillableCategory, number> {
  return {
    inside_orchestrated_scope: 0,
    internal_tool:             0,
    pre_purchase_preview:      0,
    system_internal_summary:   0,
    regex_false_positive:      0,
  };
}

/**
 * Convenience: check a single action key. If it's registered AND not
 * expired, return true. Used by aiGatewayBillingGuard for its allowlist
 * lookup (in addition to the existing allowlist cache).
 */
export async function isRegisteredNonBillable(actionKey: string): Promise<boolean> {
  const entry = await getRegisteredEntry(actionKey);
  return entry !== null && !entry.expired;
}

/**
 * Emit anomaly if an expired entry is being relied upon by a guard. Allows
 * ops to spot stale registrations the moment they fail audit but before
 * runtime breakage.
 */
export async function reportExpiredEntryAccess(actionKey: string): Promise<void> {
  const entry = await getRegisteredEntry(actionKey);
  if (entry && entry.expired) {
    emitAnomaly({
      kind: 'untracked_ai_call_blocked',
      severity: 'warn',
      message: `non-billable entry "${actionKey}" is EXPIRED — billing guard treating call as untracked`,
      metadata: {
        category:    entry.category,
        owner:       entry.ownerUserId,
        expired_at:  entry.expiresAt,
      },
    });
  }
}
