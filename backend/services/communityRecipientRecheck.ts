/**
 * L-3 — recipient recheck immediately before a community action can reach a
 * platform (owner decisions L-3, L3-1, L3-2; 2026-11-03).
 *
 * Called at the two enforcement points:
 *   1. runExecution, after every other pre-dispatch gate and immediately before
 *      the platform call / browser enqueue (manual execute route, scheduler,
 *      retry flush, auto-rule, orchestration adapter all pass through it);
 *   2. GET /api/extension/commands, before a browser command is claimed
 *      (covers browser dispatch and every command-chain step).
 *
 * Deterministic and read-only. No name guessing, substring or fuzzy matching,
 * first-result fallback or classifier: the recipient is established by exact
 * keys or not at all.
 *
 *   discovered_user_id  → community_ai_discovered_users (same tenant, same
 *                          platform, exactly one row) → external_user_id
 *   otherwise target_id → engagement_messages with that exact
 *                          platform_message_id on that platform, kept only when
 *                          their thread is this tenant's; exactly ONE distinct
 *                          author → engagement_authors.platform_user_id
 *   otherwise           → the tenant's own published post (scheduled_posts
 *                          .platform_post_id via a social_account of this
 *                          company): no third-party recipient
 *   otherwise           → refused, RECIPIENT_UNRESOLVED
 *
 * A resolved recipient is then checked against the canonical consent store
 * (contact_governance_records via evaluateCanonicalGovernance), channel =
 * platform. Anything but `allowed` refuses. A missing record is not proof of
 * consent: it only means no restriction is recorded for a recipient whose
 * identity WAS established. Any read failure refuses (fail closed).
 */
import { supabase } from '../db/supabaseClient';
import { normalizePlatform } from '../constants/platforms';
import { evaluateCanonicalGovernance } from './prospectIdentity/contactGovernanceEvaluation';

export type RecipientRecheckCode =
  | 'RECIPIENT_UNRESOLVED'
  | 'RECIPIENT_AMBIGUOUS'
  | 'RECIPIENT_NOT_ELIGIBLE'
  | 'RECIPIENT_RESTRICTED'
  | 'RECIPIENT_STATE_UNREADABLE';

export interface RecipientRecheckAllowed {
  ok: true;
  basis: 'own_content' | 'recipient_allowed';
  recipient: { platform: string; platformUserId: string; personId: string | null } | null;
}

export interface RecipientRecheckRefusal {
  ok: false;
  code: RecipientRecheckCode;
  reason: string;
  recipient?: { platform: string; platformUserId: string | null; personId: string | null };
  governance?: { decision: string; governanceType: string | null; recordId: string | null };
}

export type RecipientRecheckResult = RecipientRecheckAllowed | RecipientRecheckRefusal;

/** Explicit guard: boolean-literal narrowing is not reliable under this repo's compiler settings. */
export const isRecipientRecheckRefusal = (r: RecipientRecheckResult): r is RecipientRecheckRefusal => r.ok !== true;

export interface RecheckActionInput {
  id: string;
  organization_id: string;
  tenant_id?: string | null;
  platform: string;
  action_type: string;
  target_id: string | null;
  discovered_user_id?: string | null;
}

export interface RecipientRecheckPort {
  loadDiscoveredUser(org: string, id: string): Promise<Array<Record<string, unknown>>>;
  loadMessagesByPlatformId(platform: string, platformMessageId: string): Promise<Array<Record<string, unknown>>>;
  loadThreads(org: string, threadIds: string[]): Promise<Array<Record<string, unknown>>>;
  loadAuthors(ids: string[]): Promise<Array<Record<string, unknown>>>;
  loadOwnPosts(platform: string, platformPostId: string): Promise<Array<Record<string, unknown>>>;
  loadCompanySocialAccounts(org: string, ids: string[]): Promise<Array<Record<string, unknown>>>;
  evaluate: typeof evaluateCanonicalGovernance;
  now(): string;
}

const read = async (q: PromiseLike<{ data: unknown; error: { message?: string } | null }>) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message || 'read failed');
  return (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
};

export const defaultRecipientRecheckPort: RecipientRecheckPort = {
  loadDiscoveredUser: (org, id) => read(supabase.from('community_ai_discovered_users')
    .select('id, organization_id, platform, external_user_id, eligible_for_engagement, blocked_reason')
    .eq('id', id).eq('organization_id', org)),
  loadMessagesByPlatformId: (platform, pmid) => read(supabase.from('engagement_messages')
    .select('id, thread_id, author_id, platform').eq('platform', platform).eq('platform_message_id', pmid)),
  loadThreads: (org, ids) => read(supabase.from('engagement_threads')
    .select('id, organization_id, unified_person_id').eq('organization_id', org).in('id', ids)),
  loadAuthors: (ids) => read(supabase.from('engagement_authors')
    .select('id, platform, platform_user_id').in('id', ids)),
  loadOwnPosts: (platform, ppid) => read(supabase.from('scheduled_posts')
    .select('id, social_account_id, platform').eq('platform', platform).eq('platform_post_id', ppid)),
  loadCompanySocialAccounts: (org, ids) => read(supabase.from('social_accounts')
    .select('id, company_id').eq('company_id', org).in('id', ids)),
  evaluate: evaluateCanonicalGovernance,
  now: () => new Date().toISOString(),
};

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function recheckCommunityRecipient(
  action: RecheckActionInput,
  port: RecipientRecheckPort = defaultRecipientRecheckPort,
): Promise<RecipientRecheckResult> {
  const org = s(action.organization_id);
  const platform = normalizePlatform(String(action.platform || '')) || s(action.platform);
  if (!org || !platform) {
    return { ok: false, code: 'RECIPIENT_UNRESOLVED', reason: 'action has no tenant or platform' };
  }

  try {
    let platformUserId: string | null = null;
    let personId: string | null = null;

    // ── 1. explicit discovered user ─────────────────────────────────────────
    const discoveredId = s(action.discovered_user_id);
    if (discoveredId) {
      const rows = (await port.loadDiscoveredUser(org, discoveredId))
        .filter((r) => s(r.platform) === platform);
      if (rows.length !== 1) {
        return { ok: false, code: 'RECIPIENT_UNRESOLVED', reason: 'discovered user not found for this tenant and platform' };
      }
      if (rows[0].eligible_for_engagement === false) {
        return {
          ok: false, code: 'RECIPIENT_NOT_ELIGIBLE',
          reason: `discovered user is not eligible for engagement${s(rows[0].blocked_reason) ? `: ${s(rows[0].blocked_reason)}` : ''}`,
          recipient: { platform, platformUserId: s(rows[0].external_user_id), personId: null },
        };
      }
      platformUserId = s(rows[0].external_user_id);
      if (!platformUserId) {
        return { ok: false, code: 'RECIPIENT_UNRESOLVED', reason: 'discovered user has no platform identifier' };
      }
    }

    // ── 2. the message being replied to / liked ─────────────────────────────
    const targetId = s(action.target_id);
    if (!platformUserId && targetId) {
      const messages = await port.loadMessagesByPlatformId(platform, targetId);
      const threadIds = [...new Set(messages.map((m) => s(m.thread_id)).filter((x): x is string => !!x))];
      if (threadIds.length > 0) {
        const tenantThreads = await port.loadThreads(org, threadIds);
        const tenantThreadIds = new Set(tenantThreads.map((t) => s(t.id)));
        const own = messages.filter((m) => tenantThreadIds.has(s(m.thread_id)));
        const authorIds = [...new Set(own.map((m) => s(m.author_id)).filter((x): x is string => !!x))];
        if (own.length > 0) {
          if (authorIds.length !== 1) {
            return {
              ok: false, code: authorIds.length === 0 ? 'RECIPIENT_UNRESOLVED' : 'RECIPIENT_AMBIGUOUS',
              reason: authorIds.length === 0
                ? 'the target message has no recorded author'
                : `the target id matches messages by ${authorIds.length} different authors`,
            };
          }
          const authors = (await port.loadAuthors(authorIds)).filter((a) => s(a.platform) === platform);
          platformUserId = authors.length === 1 ? s(authors[0].platform_user_id) : null;
          if (!platformUserId) {
            return { ok: false, code: 'RECIPIENT_UNRESOLVED', reason: 'the target message author has no platform identifier' };
          }
          const persons = [...new Set(tenantThreads
            .filter((t) => own.some((m) => s(m.thread_id) === s(t.id)))
            .map((t) => s(t.unified_person_id)).filter((x): x is string => !!x))];
          personId = persons.length === 1 ? persons[0] : null;
        }
      }

      // ── 3. the tenant's own post: no third-party recipient ────────────────
      if (!platformUserId) {
        const posts = await port.loadOwnPosts(platform, targetId);
        const accountIds = [...new Set(posts.map((p) => s(p.social_account_id)).filter((x): x is string => !!x))];
        if (accountIds.length > 0 && (await port.loadCompanySocialAccounts(org, accountIds)).length > 0) {
          return { ok: true, basis: 'own_content', recipient: null };
        }
      }
    }

    if (!platformUserId) {
      return { ok: false, code: 'RECIPIENT_UNRESOLVED', reason: 'the recipient of this action could not be established' };
    }

    // ── 4. canonical consent / suppression / opt-out ────────────────────────
    const evaluation = await port.evaluate({
      organizationId: org, channel: platform, personId, target: platformUserId, now: port.now(),
    });
    if (!evaluation.ok) {
      return {
        ok: false, code: 'RECIPIENT_STATE_UNREADABLE',
        reason: 'the recipient\'s consent state could not be read; held, not executed',
        recipient: { platform, platformUserId, personId },
      };
    }
    if (evaluation.verdict.decision !== 'allowed') {
      return {
        ok: false, code: 'RECIPIENT_RESTRICTED',
        reason: evaluation.verdict.reason || `recipient restriction: ${evaluation.verdict.decision}`,
        recipient: { platform, platformUserId, personId },
        governance: {
          decision: evaluation.verdict.decision,
          governanceType: evaluation.verdict.governanceType,
          recordId: evaluation.verdict.recordId,
        },
      };
    }
    return { ok: true, basis: 'recipient_allowed', recipient: { platform, platformUserId, personId } };
  } catch (e) {
    return {
      ok: false, code: 'RECIPIENT_STATE_UNREADABLE',
      reason: `recipient state could not be read (${e instanceof Error ? e.message : 'error'}); held, not executed`,
    };
  }
}
