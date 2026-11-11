import { enqueueOrThrow } from '../middleware/queueBackpressure';
import { ownedDbTable } from '../db/writeOwner';
/**
 * WhatsApp Broadcast Service
 *
 * Manages 1-to-many WhatsApp message sends:
 *  - Create broadcast + expand recipients
 *  - Enqueue chunked jobs per tier limits
 *  - Track per-recipient delivery
 *  - Retry failed recipients
 *
 * Incorporates:
 *  - Refinement 4: ON CONFLICT DO NOTHING on recipient insert
 *  - Improvement 4: tier-aware batch chunking
 *  - Improvement 5 / Refinement 7: template safety check before enqueue
 */

import crypto from 'crypto';
import { supabase } from '../db/supabaseClient';

import { getActiveTemplate } from './whatsappTemplateService';
import { checkAndConsume, getBroadcastChunkStrategy } from './whatsappRateLimiter';
import { getValidAccessToken } from '../auth/metaAuthService';
import { requireEncryptionKey } from '../auth/credentialEncryption';
import { withLease } from '../../lib/platform/distributedLock';
import { resolveRolloutChecked } from '../../lib/platform/rolloutAdmin';
import { WHATSAPP_SENDING_FLAG } from './whatsappSendingFlag';

// W0-C — the canonical contact-governance evaluator, applied through
// `evaluateGovernanceReads` (A2): each read's rows are judged at that read's own
// DATABASE instant, never the host clock. The tenant-scoped read is the only I/O
// this adds, and it happens once per batch.
import { evaluateGovernanceReads } from './prospectIdentity/contactGovernanceAggregation';
import type { MayContactResult } from './prospectIdentity/contactGovernance';
import { recordContactGovernance } from './prospectIdentity/contactGovernanceWriter';
import {
  loadTenantGovernanceRecords,
  normalizeGovernanceTarget,
} from './prospectIdentity/contactGovernanceRepository';
import { isLeadOutreachGloballyDisabled, loadTenantGovernanceConfig, OUTREACH_GOVERNANCE_CONFIG_TABLE } from './leadOutreachExecution/governanceService';

const META_GRAPH = 'https://graph.facebook.com/v22.0';

/** L-4: a provider call still open after this is abandoned and recorded `send_uncertain`. */
export const WHATSAPP_SEND_TIMEOUT_MS = 20_000;

/** L-4: provider answers that do not say the message was refused: it may have been sent. */
export const isAmbiguousProviderStatus = (status: number): boolean => status >= 500 || status === 408;

/** Recipient states whose send outcome is unknown; a status webhook's marker reconciles them. */
const UNCONFIRMED_SEND_STATES = ['sending', 'send_uncertain'] as const;

/**
 * Leaving `sending` is CONDITIONAL (05 / e9, 2026-11-11). The claim into `sending` was
 * a compare-and-set but every write OUT of it was keyed by id alone, so a worker that
 * resolved late (a stall past the unconfirmed-send sweep's 5-minute floor) silently
 * overwrote whatever the sweep or the marker reconcile had recorded. Now:
 *   - the four INFERENCE outcomes (send_uncertain x3, failed) apply only while the row
 *     is still `sending`;
 *   - `sent` WITH the provider's message id - proof the send happened - applies while
 *     the row is `sending` OR `send_uncertain` (the sweep's no-evidence inference) and
 *     has no message id yet; it never overwrites an id another path attached.
 * Zero rows moved means another path took the row while this worker held it: logged
 * at ERROR (for `sent`, with this worker's message id and the row's current state, so
 * two different ids for one recipient - near-proof of a duplicate - are on record).
 * Neither the webhook's forward-only rule (updateRecipientDelivery, keyed by message
 * id) nor any trigger governs these writes; this filter is the whole rule.
 */
async function resolveClaimedSend(
  recipientId: string,
  patch:       Record<string, unknown>,
): Promise<{ moved: boolean; error: string | null }> {
  const { data, error } = await ownedDbTable('whatsapp_broadcast_recipients')
    .update(patch)
    .eq('id', recipientId)
    .eq('status', 'sending')
    .select('id');
  if (error) return { moved: false, error: error.message };
  const moved = Array.isArray(data) && data.length > 0;
  if (!moved) {
    console.error('[wa-broadcast] send outcome NOT recorded: the row moved while this worker held it', {
      recipient_id: recipientId, outcome: patch.status,
    });
  }
  return { moved, error: null };
}

/**
 * A2b — governance re-read within a batch (decided by virality-e9). The batch reads
 * governance once, then sends one message per recipient, so a restriction committed
 * mid-batch (an unsubscribe) was not seen by the recipients still to go. Governance is
 * re-read for the remaining recipients every WHATSAPP_GOVERNANCE_REREAD_MS (default
 * 30 s) OR every WHATSAPP_GOVERNANCE_REREAD_EVERY recipients (default 50), whichever
 * comes first, so an unsubscribe takes effect within about 30 s however long the batch
 * runs. The host clock only SCHEDULES re-reads; every verdict still uses the read's
 * own database instant (A2).
 */
export const DEFAULT_GOVERNANCE_REREAD_MS = 30_000;
export const DEFAULT_GOVERNANCE_REREAD_EVERY = 50;
/**
 * Upper bounds on the two settings. These are a DAMAGE LIMIT ON MISCONFIGURATION,
 * not policy: the defaults above (30 s / 50) are the policy. At the cap, up to
 * 5 minutes or 500 messages can still go out after an unsubscribe; the cap only
 * bounds how far a setting can drift without anyone noticing. A value above the
 * cap is clamped (and logged), never refused, so a bad setting weakens the guard
 * as little as possible instead of stopping sends.
 */
export const MAX_GOVERNANCE_REREAD_MS = 300_000;
export const MAX_GOVERNANCE_REREAD_EVERY = 500;

/**
 * A positive integer from the environment, at most `cap`. Not a positive integer
 * -> the default; above the cap -> the cap. Both are logged by variable name.
 */
function positiveIntEnv(name: string, fallback: number, cap: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 1) {
    console.warn(`[whatsappBroadcast] ${name} is not a positive integer; using the default`, { value: raw.slice(0, 32), default: fallback });
    return fallback;
  }
  if (n > cap) {
    console.warn(`[whatsappBroadcast] ${name} is above its cap; using the cap`, { value: n, cap });
    return cap;
  }
  return n;
}

const PHONE_SALT = process.env.PHONE_HASH_SALT ?? '';

const RECIPIENT_ID_PAGE = 1000;

/** How the orchestration adapter names a broadcast it creates for a journey step (`wf:<task>`). */
export const JOURNEY_BROADCAST_PREFIX = 'wf:';

/**
 * A journey recipient a send-time check refused. Terminal, and never picked up by
 * `retryFailed`. The cause is in `error_message`. Text status: the column has no CHECK.
 */
export const BLOCKED_SEND_CONTROL = 'blocked_send_control';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContactInput {
  phone_e164:   string;   // E.164 format, e.g. "+15551234567"
  contact_name?: string;
}

/**
 * A journey recipient: Orchestration names the canonical person (owner GO 2026-11-08), so the
 * send-time check applies the person's restrictions as well as the number's. The database
 * derives the person's tenant from the broadcast and refuses another tenant's person
 * (20270128000004). Manual broadcasts never use this and stay number-only.
 */
export interface PersonContactInput extends ContactInput {
  person_id: string;
}

export interface CreateBroadcastInput {
  company_id:        string;
  social_account_id: string;
  name:              string;
  message_type:      'template' | 'text' | 'image';
  template_name?:    string;
  template_params?:  Record<string, unknown>;
  body?:             string;
  media_id?:         string;
  media_caption?:    string;
  scheduled_for?:    string;
  created_by?:       string;
}

export interface RecipientDeliveryUpdate {
  wa_message_id: string;
  status:        'sent' | 'delivered' | 'read' | 'failed';
  error_code?:   number;
  error_message?: string;
  /** L-4: the status event's biz_opaque_callback_data, our recipient id (processBatch). */
  callback_data?: string | null;
  /** L-4: the status event's recipient_id, the number's WhatsApp id (digits). */
  recipient_wa_id?: string | null;
}

// ── Phone privacy helpers ─────────────────────────────────────────────────────

function hashPhone(e164: string): string {
  if (!PHONE_SALT) throw new Error('PHONE_HASH_SALT env var not set');
  return crypto.createHmac('sha256', PHONE_SALT).update(e164.replace(/\s/g, '')).digest('hex');
}

function encryptPhone(e164: string): string {
  // Reuse AES-256-GCM from tokenStore encryption pattern.
  // SEC91-B12: the shared strict key parser — a missing/malformed ENCRYPTION_KEY fails with
  // a clear error instead of `ENCRYPTION_KEY ?? ''` silently producing a short key buffer.
  const key = requireEncryptionKey();
  const iv   = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let enc = cipher.update(e164, 'utf8', 'hex') + cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc;
}

export function decryptPhone(encrypted: string): string {
  const key = requireEncryptionKey();
  const [ivHex, tagHex, enc] = encrypted.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(enc, 'hex', 'utf8') + decipher.final('utf8');
}

// ── Sender-account ownership ──────────────────────────────────────────────────

/**
 * A broadcast is sent with the Meta token and phone number of
 * `social_account_id`. That id arrives in the request body, so it must belong to
 * the broadcast's company; otherwise an admin of company A could send through
 * company B's WhatsApp number and token.
 *
 * Refusal reasons: `not_found` covers both "no such account" and "another
 * company's account" (the caller must not learn which); `unreadable` is a failed
 * lookup and also refuses (fail closed).
 */
export type SenderAccountRefusal = 'not_found' | 'unreadable' | 'disconnected';

export class WhatsAppSenderAccountError extends Error {
  constructor(public readonly reason: SenderAccountRefusal) {
    super(reason === 'unreadable'
      ? 'WhatsApp sender account could not be verified'
      : reason === 'disconnected'
        ? 'WhatsApp sender account is disconnected; reconnect it before sending'
        : 'WhatsApp sender account not found');
    this.name = 'WhatsAppSenderAccountError';
  }
}

export async function loadOwnedSenderAccount(
  companyId: unknown,
  socialAccountId: unknown,
): Promise<
  | { ok: true; account: { id: string; company_id: string; phone_number_id: string | null; is_active?: boolean | null } }
  | { ok: false; reason: SenderAccountRefusal }
> {
  if (typeof companyId !== 'string' || !companyId || typeof socialAccountId !== 'string' || !socialAccountId) {
    return { ok: false, reason: 'not_found' };
  }
  let res: { data?: any; error?: unknown };
  try {
    res = await ownedDbTable('social_accounts')
      .select('id, company_id, phone_number_id, is_active')
      .eq('id', socialAccountId)
      .eq('company_id', companyId)
      .maybeSingle();
  } catch {
    return { ok: false, reason: 'unreadable' };
  }
  if (res.error) return { ok: false, reason: 'unreadable' };
  // The predicate already scopes by company; the comparison is defence in depth.
  if (!res.data || res.data.company_id !== companyId) return { ok: false, reason: 'not_found' };
  return { ok: true, account: res.data };
}

/**
 * HTTP mapping for routes, matching `pages/api/social/comments.ts`: an unknown
 * and a foreign account both get 404, a failed lookup 503. Null for any other error.
 */
export function senderAccountRefusalResponse(err: unknown): { status: 404 | 409 | 503; error: string; code?: string } | null {
  if (err instanceof WhatsAppSendStoppedError) return { status: 409, error: err.message, code: `${err.code}:${err.reason}` };
  if (err instanceof WhatsAppSharedNumberError) return { status: 409, error: err.message, code: err.code };
  if (!(err instanceof WhatsAppSenderAccountError)) return null;
  if (err.reason === 'disconnected') return { status: 409, error: err.message };
  return err.reason === 'unreadable'
    ? { status: 503, error: 'Social account lookup failed. Please try again.' }
    : { status: 404, error: 'Social account not found' };
}

// ── Emergency stop + shared number (owner ruling via e9, 2026-11-11) ──────────

/** Which kill switch stopped WhatsApp sending; `unreadable` = the tenant switch could not be read. */
export type WhatsAppSendStop =
  | 'global_kill_switch' | 'super_admin_stop' | 'stop_switch_unreadable'
  | 'tenant_kill_switch' | 'kill_switch_unreadable';

const SEND_STOP_MESSAGES: Record<WhatsAppSendStop, string> = {
  global_kill_switch:     'WhatsApp sending is stopped: the GLOBAL outreach kill switch is on.',
  super_admin_stop:       'WhatsApp sending is stopped: the Super Admin "stop all WhatsApp" switch is on.',
  stop_switch_unreadable: 'WhatsApp sending is paused: the Super Admin stop switch could not be read, so it is treated as on.',
  tenant_kill_switch:     'WhatsApp sending is stopped: this company\'s outreach kill switch is on.',
  kill_switch_unreadable: 'WhatsApp sending is stopped: this company\'s kill switch could not be read, so it is treated as on.',
};

/** Sending refused by a kill switch. Recipients are left `pending`, so Resume works once it clears. */
export class WhatsAppSendStoppedError extends Error {
  readonly code = 'WHATSAPP_SENDING_STOPPED';
  constructor(readonly reason: WhatsAppSendStop) {
    super(SEND_STOP_MESSAGES[reason]);
    this.name = 'WhatsAppSendStoppedError';
  }
}

/** The sender's phone number is held by more than one live account (mirrors the inbound refusal). */
export class WhatsAppSharedNumberError extends Error {
  readonly code = 'WHATSAPP_NUMBER_SHARED';
  constructor(readonly otherAccounts: number) {
    // Operator-facing: the other holder may be in a tenant this operator cannot see, so the
    // text sends them to support (the account ids are logged server-side, never returned).
    super('This WhatsApp number is connected to more than one account, so sending is blocked. Contact support to resolve it - retrying will not help.');
    this.name = 'WhatsAppSharedNumberError';
  }
}

/** At most one UNREADABLE-stop alert per window per process (the check runs per send). */
const STOP_UNREADABLE_ALERT_WINDOW_MS = 60_000;
let lastStopUnreadableAlertAt = 0;
/** Test seam: forget the alert window. */
export function __resetStopAlertWindow(): void { lastStopUnreadableAlertAt = 0; }

/**
 * The GLOBAL stops, either of which stops ALL WhatsApp sending (owner rulings 2026-11-11):
 *   1. env LEAD_OUTREACH_EXECUTION_DISABLED (needs a redeploy to flip);
 *   2. the instant Super Admin switch, rollout flag `whatsapp-sending` (no redeploy). It FAILS
 *      SAFE: if the admin config cannot be read (Redis/admin config unreadable), sending PAUSES
 *      (same pending/pause semantics as the tenant switch) and an alert is logged at ERROR with
 *      a stable marker - the log-alerting path D2b's "provider FAILING" uses.
 * Read through the kit's 30 s cache, so it is cheap per send; a kill reaches other processes
 * within that TTL (the writing process re-reads at once). No admin layer at all (Redis not
 * configured - local dev, tests) means no instant switch exists here: env only.
 */
export async function whatsappGlobalStop(): Promise<WhatsAppSendStop | null> {
  if (isLeadOutreachGloballyDisabled()) return 'global_kill_switch';
  const { decision, adminReadable } = await resolveRolloutChecked(WHATSAPP_SENDING_FLAG);
  if (adminReadable === false) {
    if (Date.now() - lastStopUnreadableAlertAt >= STOP_UNREADABLE_ALERT_WINDOW_MS) {
      lastStopUnreadableAlertAt = Date.now();
      console.error('[whatsappBroadcast] WhatsApp stop switch UNREADABLE - all WhatsApp sending PAUSED (fail safe)', {
        flag: WHATSAPP_SENDING_FLAG.key,
        action: 'restore Redis / the rollout admin config; sending resumes on the next successful read',
      });
    }
    return 'stop_switch_unreadable';
  }
  // Only THIS flag's own stop counts; the kit-wide rollout kill (source 'global-kill') does not.
  if (decision.mode === 'off' && decision.source !== 'global-kill') return 'super_admin_stop';
  return null;
}

/**
 * OWNER RULING ("stop everything"): when the GLOBAL or the TENANT WS-3 kill switch is on, no
 * WhatsApp message goes out - journeys AND operator broadcasts (create, enqueue/Resume, Retry,
 * and batches already queued). ONLY the two kill switches: tenant_not_enabled /
 * channel_not_enabled are WS-3 ENABLEMENT, not an emergency stop, and are NOT applied to
 * operator broadcasts (they would block every tenant without lead-outreach config).
 *
 * The global switch is the env LEAD_OUTREACH_EXECUTION_DISABLED (no read; checked per send).
 * The tenant switch is read here directly rather than through loadTenantGovernanceConfig,
 * which maps a FAILED read to "unconfigured, switch off": for a stop switch an unreadable
 * state must count as ON (fail closed), while NO config row is genuinely "off".
 */
export async function whatsappKillSwitchStop(companyId: string): Promise<WhatsAppSendStop | null> {
  const global = await whatsappGlobalStop();
  if (global) return global;
  try {
    const { data, error } = await ownedDbTable(OUTREACH_GOVERNANCE_CONFIG_TABLE)
      .select('kill_switch')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) return 'kill_switch_unreadable';
    return data?.kill_switch === true ? 'tenant_kill_switch' : null;
  } catch {
    return 'kill_switch_unreadable';
  }
}

/**
 * Another LIVE WhatsApp account (any tenant) holding this account's phone_number_id makes the
 * per-account daily budget per-account rather than per-number, so the number's real tier
 * limit can be exceeded - the inbound processor already refuses such a number
 * (whatsappWebhookProcessor: "phone_number_id held by more than one tenant"). Disconnected
 * accounts do not count: they can no longer send. FAIL CLOSED: an unreadable lookup refuses.
 * A null phone_number_id is not checked here; processBatch refuses it before any send.
 */
async function assertNumberNotShared(account: { id: string; phone_number_id: string | null }): Promise<void> {
  if (!account.phone_number_id) return;
  let res: { data?: any; error?: unknown };
  try {
    // DELIBERATELY CROSS-TENANT (05): the read has NO company_id filter, because a holder in
    // ANOTHER tenant is exactly the case this check exists for. It goes through ownedDbTable,
    // which today provides no tenant scoping; if ownedDbTable ever becomes a real tenant seam,
    // this read MUST keep its cross-tenant reach (use the service client explicitly), or the
    // check silently becomes per-tenant and stops detecting the only case it exists for.
    // Pinned by whatsappKillSwitchSharedNumber.test.ts "held by another tenant".
    res = await ownedDbTable('social_accounts')
      .select('id, company_id, is_active')
      .eq('platform', 'whatsapp')
      .eq('phone_number_id', account.phone_number_id);
  } catch {
    throw new WhatsAppSenderAccountError('unreadable');
  }
  if (res.error) throw new WhatsAppSenderAccountError('unreadable');
  const others = (Array.isArray(res.data) ? res.data : []).filter((r: any) => r.id !== account.id && r.is_active !== false);
  if (others.length > 0) {
    // For support, server-side only: which accounts hold the number (never returned to the caller).
    console.error('[whatsappBroadcast] sending refused: phone_number_id held by more than one live account', {
      account_id: account.id,
      other_account_ids: others.map((r: any) => r.id),
      other_company_ids: [...new Set(others.map((r: any) => r.company_id))],
    });
    throw new WhatsAppSharedNumberError(others.length);
  }
}

/**
 * The SEND paths' check (create, enqueue/resume, processBatch): owned AND connected.
 * Disconnecting an account sets is_active=false but keeps its encrypted tokens
 * (pages/api/social-accounts/disconnect.ts: "harmless - reconnect overwrites them"), and
 * getValidAccessToken reads the token without looking at is_active, so before this a
 * paused or failed broadcast on a disconnected account could still be resumed or retried,
 * and its queued batches still sent (e9, 2026-11-11). Only an explicit false refuses: a
 * row without the field is judged on ownership, as before. The template routes keep using
 * loadOwnedSenderAccount (ownership only) - managing templates is not a send.
 */
async function assertOwnedSenderAccount(companyId: unknown, socialAccountId: unknown) {
  const check = await loadOwnedSenderAccount(companyId, socialAccountId);
  if (check.ok === false) throw new WhatsAppSenderAccountError(check.reason);
  // `=== false`, NOT `!is_active`, and deliberately (05): social_accounts.is_active is
  // `boolean DEFAULT true` and NULLABLE (baseline.sql). NULL arises only from an explicit
  // null insert or a row written before the column mattered; those accounts could send
  // before this guard, so refusing them would be a functional break, not a safety gain.
  // "Tightening" this to `!is_active` changes WHICH LEGACY ACCOUNTS CAN SEND - decide that
  // deliberately (measure `is_active IS NULL` first; if zero, SET NOT NULL retires it).
  if (check.account.is_active === false) throw new WhatsAppSenderAccountError('disconnected');
  return check.account;
}

/**
 * The ONE check every WhatsApp send path runs (create, enqueue/Resume, Retry, processBatch):
 * owned and connected, its number not shared, and no kill switch on. Order: the kill switch
 * first (cheapest, and the answer an operator most needs), then the account.
 */
async function assertSenderMaySend(companyId: unknown, socialAccountId: unknown) {
  if (typeof companyId === 'string' && companyId) {
    const stop = await whatsappKillSwitchStop(companyId);
    if (stop) throw new WhatsAppSendStoppedError(stop);
  }
  const account = await assertOwnedSenderAccount(companyId, socialAccountId);
  await assertNumberNotShared(account);
  return account;
}

/**
 * processBatch's answer to a kill switch. An OPERATOR broadcast is paused - the state the UI
 * shows with Resume - with every remaining recipient left `pending`, and the job ends without
 * throwing (no retry storm). A JOURNEY broadcast keeps Orchestration's B-17 contract: the error
 * is thrown, the job retries, and the batch-start send-control check records the refusal
 * (blocked_send_control) as it always has.
 */
async function pauseForStop(broadcastId: string, isJourney: boolean, stop: WhatsAppSendStoppedError, remaining: number): Promise<void> {
  if (isJourney) throw stop;
  console.error('[whatsappBroadcast] sending stopped by a kill switch; broadcast paused, remaining recipients left pending', {
    broadcast_id: broadcastId, switch: stop.reason, remaining,
  });
  const { error } = await ownedDbTable('whatsapp_broadcasts')
    .update({ status: 'paused', updated_at: new Date().toISOString() })
    .eq('id', broadcastId);
  if (error) console.error('[whatsappBroadcast] could not mark the broadcast paused', { broadcast_id: broadcastId, error: error.message });
}

// ── Create broadcast ──────────────────────────────────────────────────────────

export async function createBroadcast(input: CreateBroadcastInput): Promise<string> {
  await assertSenderMaySend(input.company_id, input.social_account_id);

  const { data, error } = await ownedDbTable('whatsapp_broadcasts')
    .insert({
      ...input,
      status:     'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(`Failed to create broadcast: ${error?.message}`);
  return data.id;
}

// ── Expand recipients ─────────────────────────────────────────────────────────

/**
 * Bulk insert contacts as broadcast recipients.
 * Refinement 4: ON CONFLICT DO NOTHING — safe for re-runs and retries.
 * Constraint: UNIQUE (broadcast_id, hashed_phone)
 */
export async function expandRecipients(
  broadcastId: string,
  contacts:    ContactInput[],
): Promise<{ inserted: number; skipped: number }> {
  // Fields are mapped one by one: a manual request body cannot attach a person.
  return insertRecipients(broadcastId, contacts.map((c) => recipientRow(broadcastId, c, null)));
}

/**
 * Journey recipients, each with its canonical person (Orchestration's adapter). The same
 * insert as `expandRecipients`; a missing person is refused rather than written number-only.
 */
export async function expandPersonRecipients(
  broadcastId: string,
  contacts:    PersonContactInput[],
): Promise<{ inserted: number; skipped: number }> {
  for (const c of contacts) {
    if (typeof c.person_id !== 'string' || c.person_id.trim() === '') {
      throw new Error('expandPersonRecipients: every recipient needs its person_id');
    }
  }
  return insertRecipients(broadcastId, contacts.map((c) => recipientRow(broadcastId, c, c.person_id)));
}

function recipientRow(broadcastId: string, c: ContactInput, personId: string | null) {
  return {
    broadcast_id:    broadcastId,
    hashed_phone:    hashPhone(c.phone_e164),
    encrypted_phone: encryptPhone(c.phone_e164),
    contact_name:    c.contact_name ?? null,
    ...(personId === null ? {} : { person_id: personId }),
    status:          'pending',
    retry_count:     0,
    created_at:      new Date().toISOString(),
  };
}

async function insertRecipients(
  broadcastId: string,
  rows:        ReturnType<typeof recipientRow>[],
): Promise<{ inserted: number; skipped: number }> {
  // Batch insert in chunks of 500 to avoid Supabase payload limits
  let inserted = 0;
  let skipped  = 0;
  const CHUNK  = 500;

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await ownedDbTable('whatsapp_broadcast_recipients')
      .upsert(chunk, { onConflict: 'broadcast_id,hashed_phone', ignoreDuplicates: true })
      .select('id');

    if (error) throw new Error(`expandRecipients batch ${i} failed: ${error.message}`);
    inserted += data?.length ?? 0;
    skipped  += chunk.length - (data?.length ?? 0);
  }

  // Update total_recipients count on broadcast
  await ownedDbTable('whatsapp_broadcasts')
    .update({ total_recipients: inserted, updated_at: new Date().toISOString() })
    .eq('id', broadcastId);

  return { inserted, skipped };
}

// ── Enqueue broadcast ─────────────────────────────────────────────────────────

/**
 * Resume and one-run-at-a-time (e9 decision (a), 2026-11-11; S port).
 *
 * THE DEFECTS THIS CLOSES: batch jobs had a FIXED jobId `wa-batch-<id>-<n>` (retries:
 * `wa-retry-<id>-<Date.now()>`), the whatsapp-broadcast queue keeps completed jobs for
 * 24 h, and BullMQ ignores an add whose jobId exists. So a resume (POST
 * ?action=enqueue on a paused broadcast) within 24 h of the first run added NO jobs
 * while the route answered `enqueued: true`, and two retries in one millisecond shared
 * an id. Every run now carries a random token (a UUID, never a timestamp).
 *
 *  - SAFETY: enqueue and retry run only under the distributed lease
 *    `whatsapp-broadcast-enqueue:<id>` (lib/platform/distributedLock), so they exclude
 *    each other and themselves. Inside the lease the run first checks for live jobs,
 *    so by the time a lease is released its jobs EXIST and the next caller sees them.
 *  - UX ONLY: the live-job check (409). It reads BullMQ, and a job can start or finish
 *    right after the read, so it is a courtesy against the common mistake; concurrent
 *    ENQUEUES are made safe by the lease, and two JOBS that already exist are made safe
 *    by processBatch's pending -> sending claim, never by this check.
 *  - A worker that died mid-job leaves its job 'active' until BullMQ's stall detection
 *    (stalledInterval 30 min on this queue): until then a resume is refused with a 409
 *    that says so. Nothing is lost meanwhile - the claimed rows are resolved by the
 *    unconfirmed-send sweep, the rest stay pending for the next run.
 *
 * Lease unavailable (Redis down): refused, nothing enqueued - unless the platform
 * switches DISTRIBUTED_LOCKS_FAIL_OPEN / DISTRIBUTED_LOCKS_KILL make every lease a
 * pass-through by platform policy (single replica only).
 */
export class BroadcastAlreadyRunningError extends Error {
  readonly code = 'BROADCAST_ALREADY_RUNNING';
  constructor(message: string) {
    super(message);
    this.name = 'BroadcastAlreadyRunningError';
  }
}

export interface EnqueueBroadcastResult {
  run_id: string;
  /** Batch jobs known to be in the queue from this run. */
  batches: number;
  /** Pending recipients covered by those jobs. */
  recipients: number;
}

/**
 * Some batches are in the queue, then an add failed (its recipients withdrawn by the
 * L-4 settlement, or - `uncertain` - the withdrawal itself could not be written). The
 * queued batches WILL run, so this is neither "enqueued" nor "nothing enqueued".
 */
export class BroadcastPartiallyEnqueuedError extends Error {
  readonly code = 'BROADCAST_PARTIALLY_ENQUEUED';
  readonly uncertain: boolean;
  constructor(readonly result: EnqueueBroadcastResult, cause: unknown) {
    super(`Enqueue stopped after ${result.batches} batch(es) covering ${result.recipients} recipient(s) were queued: `
      + `${cause instanceof Error ? cause.message : String(cause)}. The queued batches will run.`);
    this.name = 'BroadcastPartiallyEnqueuedError';
    this.uncertain = cause instanceof WhatsAppEnqueueUncertainError;
  }
}

/** Long enough for a large broadcast's pages; withLease renews it at half-TTL anyway. */
const ENQUEUE_LEASE_TTL_SECONDS = 120;

/** Job states in which a batch of this broadcast may still send. */
const LIVE_JOB_STATES = ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'];

async function liveBatchJobCount(
  queue: { getJobs: (types: string[]) => Promise<Array<{ data?: { broadcast_id?: string } } | undefined>> },
  broadcastId: string,
): Promise<number> {
  // A read failure throws: no new run starts when we cannot tell whether one is live.
  const jobs = await queue.getJobs([...LIVE_JOB_STATES]);
  return jobs.filter((j) => j?.data?.broadcast_id === broadcastId).length;
}

function alreadyRunning(live: number, action: 'resuming' | 'retrying'): BroadcastAlreadyRunningError {
  return new BroadcastAlreadyRunningError(
    `Broadcast is already running: ${live} batch job(s) queued or active. Wait for them to finish before ${action}. `
    + 'If no batch is progressing, a worker may have stopped mid-batch; its job clears within 30 minutes and this broadcast can then be resumed.',
  );
}

async function withBroadcastLease<T>(broadcastId: string, run: () => Promise<T>, busy: string): Promise<T> {
  const leased = await withLease(`whatsapp-broadcast-enqueue:${broadcastId}`, ENQUEUE_LEASE_TTL_SECONDS, run);
  if (!leased.ran) {
    if (leased.reason === 'held') throw new BroadcastAlreadyRunningError(busy);
    throw new Error('Could not take the broadcast enqueue lock; nothing was queued. Please try again.');
  }
  return leased.value as T;
}

/**
 * The HTTP answer for an enqueue. `enqueued` means "at least one batch is KNOWN to be
 * queued": true only when a job was added; `partial` / `uncertain` add detail and never
 * flip it, so a truthy check and a strict === true check agree.
 */
export function enqueueOutcomeResponse(
  outcome: { ok: true; result: EnqueueBroadcastResult } | { ok: false; error: unknown },
): { status: number; body: Record<string, unknown> } {
  if (outcome.ok === true) {
    const { result } = outcome as { ok: true; result: EnqueueBroadcastResult };
    if (result.batches > 0) {
      return { status: 200, body: { enqueued: true, run_id: result.run_id, batches: result.batches, recipients: result.recipients } };
    }
    return { status: 409, body: { enqueued: false, error: 'Nothing was enqueued: no pending recipients remained.' } };
  }
  const err = (outcome as { ok: false; error: unknown }).error;
  if (err instanceof BroadcastAlreadyRunningError) {
    return { status: 409, body: { enqueued: false, code: err.code, error: err.message } };
  }
  if (err instanceof BroadcastPartiallyEnqueuedError) {
    return {
      status: 202,
      body: {
        enqueued: true, partial: true, uncertain: err.uncertain, code: err.code,
        run_id: err.result.run_id, batches: err.result.batches, recipients: err.result.recipients, error: err.message,
      },
    };
  }
  if (err instanceof WhatsAppEnqueueUncertainError) {
    // Nothing is KNOWN to be queued, but a batch may be: a person reviews before any resend.
    return { status: 500, body: { enqueued: false, uncertain: true, code: err.code, error: err.message } };
  }
  // A draft naming another company's account (created before the ownership
  // check) is refused like an unknown account.
  const refused = senderAccountRefusalResponse(err);
  if (refused) return { status: refused.status, body: { enqueued: false, error: refused.error, ...(refused.code ? { code: refused.code } : {}) } };
  return { status: 400, body: { enqueued: false, error: err instanceof Error ? err.message : String(err) } };
}

/** The HTTP answer for a retry: `retried: true` only when recipients were re-queued. */
export function retryOutcomeResponse(
  outcome: { ok: true; result: RetryResult } | { ok: false; error: unknown },
): { status: number; body: Record<string, unknown> } {
  if (outcome.ok === true) {
    const { result } = outcome as { ok: true; result: RetryResult };
    if (result.retried > 0) return { status: 200, body: { retried: true, recipients: result.retried } };
    // WHY nothing is retryable, so the operator learns the recipients were REFUSED rather
    // than that the button was pointless (05). Retry offers itself on failed_count > 0,
    // which includes compliance refusals, so this sentence is the common answer.
    const why: string[] = [];
    if (result.refused) why.push(`${result.refused} were refused by contact governance or send controls and are not retried`);
    if (result.exhausted) why.push(`${result.exhausted} failed and have used all their retries`);
    return {
      status: 409,
      body: {
        retried: false, refused: result.refused ?? 0, exhausted: result.exhausted ?? 0,
        error: `No retryable recipients${why.length ? `: ${why.join('; ')}` : ''}.`,
      },
    };
  }
  const err = (outcome as { ok: false; error: unknown }).error;
  if (err instanceof BroadcastAlreadyRunningError) {
    return { status: 409, body: { retried: false, code: err.code, error: err.message } };
  }
  if (err instanceof WhatsAppEnqueueUncertainError) {
    return { status: 500, body: { retried: false, uncertain: true, code: err.code, error: err.message } };
  }
  const refused = senderAccountRefusalResponse(err);
  if (refused) return { status: refused.status, body: { retried: false, error: refused.error, ...(refused.code ? { code: refused.code } : {}) } };
  return { status: 400, body: { retried: false, error: err instanceof Error ? err.message : String(err) } };
}

/** A retry's answer. `refused` / `exhausted` say why nothing was retryable when retried is 0. */
export interface RetryResult { retried: number; refused?: number; exhausted?: number }

/**
 * Validate template, check rate limits, chunk recipients, enqueue jobs.
 * Improvement 5 / Refinement 7: template check happens here — before any job creation.
 */
export async function enqueueBroadcast(
  broadcastId: string,
  plan:        string,
): Promise<EnqueueBroadcastResult> {
  const { data: broadcast, error } = await ownedDbTable('whatsapp_broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .single();

  if (error || !broadcast) throw new Error(`Broadcast not found: ${broadcastId}`);

  // A draft created before the ownership check existed may name another
  // company's account; refuse before its rate limit or queue is touched.
  await assertSenderMaySend(broadcast.company_id, broadcast.social_account_id);

  // Improvement 5 + Refinement 7: validate template before touching queue
  if (broadcast.message_type === 'template') {
    if (!broadcast.template_name) {
      throw new Error('template_name is required for template broadcasts');
    }
    // Throws if template is missing, not approved, or not active
    await getActiveTemplate(broadcast.company_id, broadcast.template_name);
  }

  // Everything from here runs under the per-broadcast enqueue lease.
  return withBroadcastLease(broadcastId, () => enqueueRun(broadcastId, broadcast, plan),
    'Another enqueue or retry of this broadcast is in progress.');
}

/** One enqueue run of a broadcast. Called ONLY under the enqueue lease. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function enqueueRun(broadcastId: string, broadcast: any, plan: string): Promise<EnqueueBroadcastResult> {
  const { getContentQueue } = await import('../queue/contentGenerationQueues');
  const queue = getContentQueue('whatsapp-broadcast');

  // UX (see above): refuse while a previous run can still send, before any screening
  // write or quota is consumed.
  const live = await liveBatchJobCount(queue as never, broadcastId);
  if (live > 0) throw alreadyRunning(live, 'resuming');

  // A recipient already restricted is marked before the rate limit counts it, so a held
  // recipient consumes no quota. processBatch decides again at send time.
  await screenPendingRecipients(broadcast.company_id, broadcastId);

  // Count pending recipients
  const { count } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('*', { count: 'exact', head: true })
    .eq('broadcast_id', broadcastId)
    .eq('status', 'pending');

  const totalCount = count ?? 0;
  if (totalCount === 0) throw new Error('No pending recipients for broadcast');

  // Check rate limit for total recipient count
  const rateCheck = await checkAndConsume({
    social_account_id: broadcast.social_account_id,
    // NOT the phone number id: the limiter's Redis key (wa:usage:<this>:<day>) is per SENDER
    // ACCOUNT, and the DB quota is keyed by social_account_id too. Never null here (the account
    // was asserted above), so no two accounts can share a bucket (05). processBatch separately
    // refuses an account without a phone_number_id before any send.
    phone_number_id:   broadcast.social_account_id,
    company_id:        broadcast.company_id,
    plan,
    count:             totalCount,
  });

  if (!rateCheck.allowed) {
    await ownedDbTable('whatsapp_broadcasts')
      .update({ status: 'paused', updated_at: new Date().toISOString() })
      .eq('id', broadcastId);
    throw new Error(
      `Rate limit exceeded (tier ${rateCheck.tier}). ` +
      `Remaining today: ${rateCheck.remaining}. Broadcast paused.`
    );
  }

  // Improvement 4: tier-aware chunking
  const { batch_size, delay_ms } = getBroadcastChunkStrategy(rateCheck.tier);

  // Fetch recipient IDs in pages and add to queue
  // Every id is read BEFORE the first job is queued, and paged by key. Batch 0 has no
  // delay, so a worker moves rows out of `pending` while this runs: an offset over that
  // shrinking set skips recipients, and they are never queued.
  const pendingIds: string[] = [];
  for (;;) {
    let page = ownedDbTable('whatsapp_broadcast_recipients')
      .select('id')
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending');
    if (pendingIds.length > 0) page = page.gt('id', pendingIds[pendingIds.length - 1]);

    const { data: recipients, error: readError } = await page
      .order('id', { ascending: true })
      .limit(RECIPIENT_ID_PAGE);
    if (readError) throw new Error(`Broadcast recipients unreadable: ${readError.message}`);
    // Until an empty page: the server's row cap may be lower than the page asked for.
    if (!recipients?.length) break;
    pendingIds.push(...recipients.map((r) => r.id as string));
  }

  const runId = crypto.randomUUID();
  let batchIndex = 0;
  let enqueuedRecipients = 0;
  const markRunning = () => ownedDbTable('whatsapp_broadcasts')
    .update({ status: 'running', started_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', broadcastId);

  for (let i = 0; i < pendingIds.length; i += batch_size) {
    const recipientIds = pendingIds.slice(i, i + batch_size);

    try {
      await enqueueOrThrow(
        queue,
        'whatsapp-broadcast',
        'wa-broadcast-batch',
        { broadcast_id: broadcastId, recipient_ids: recipientIds },
        {
          // A fresh run token per run: a resume is never deduped against an old job.
          jobId:    `wa-batch-${broadcastId}-${runId}-${batchIndex}`,
          delay:    batchIndex * delay_ms,
          priority: 6,
          attempts: 3,
          backoff:  { type: 'exponential', delay: 5000 },
        },
      );
    } catch (enqueueError) {
      // L-4: the job may be in the queue even though the add threw.
      let settled: 'withdrawn' | 'queued';
      try {
        settled = await settleUnconfirmedEnqueue(broadcastId, recipientIds);
      } catch (uncertain) {
        if (batchIndex === 0) throw uncertain;
        await markRunning();
        throw new BroadcastPartiallyEnqueuedError({ run_id: runId, batches: batchIndex, recipients: enqueuedRecipients }, uncertain);
      }
      if (settled === 'withdrawn') {
        if (batchIndex === 0) throw enqueueError; // nothing of this run is queued: a plain failure
        await markRunning();
        throw new BroadcastPartiallyEnqueuedError({ run_id: runId, batches: batchIndex, recipients: enqueuedRecipients }, enqueueError);
      }
      // 'queued': the job exists and is running; count it.
    }

    batchIndex += 1;
    enqueuedRecipients += recipientIds.length;
  }

  if (batchIndex > 0) await markRunning();
  return { run_id: runId, batches: batchIndex, recipients: enqueuedRecipients };
}

// ── L-4: an enqueue whose acknowledgement was lost ───────────────────────────

/** error_message of a recipient withdrawn after an unconfirmed enqueue: never sent, safe to retry. */
export const ENQUEUE_UNCONFIRMED_MESSAGE = 'enqueue_unconfirmed: withdrawn before any send; safe to retry';

/**
 * The queue add threw, but the job may still have been stored (a lost acknowledgement): it
 * would then run and send while the caller reports a failure, and a person re-submitting
 * would send twice. Instead of guessing, the batch's recipients that are still `pending`
 * are withdrawn (`pending -> failed`, compare-and-set). Every send needs the
 * `pending -> sending` claim (processBatch), so a withdrawn recipient can never be sent by
 * that job, by a retry of it, or by any other: the ambiguity becomes a certain "not sent".
 *
 *   'withdrawn' every recipient of the batch was withdrawn: nothing of it can be sent, and
 *               `retryFailed` may queue it again (it was never sent).
 *   'queued'    some recipient had already left `pending`: the job exists and is running.
 *               The rest are withdrawn and visible as failed; nothing is sent twice.
 * If the withdrawal itself cannot be written, the batch is genuinely uncertain:
 * WhatsAppEnqueueUncertainError, for a person to review before any resend.
 */
export class WhatsAppEnqueueUncertainError extends Error {
  readonly code = 'whatsapp_enqueue_uncertain';
  constructor(readonly broadcastId: string, detail: string) {
    super(`the WhatsApp queue may hold a batch of broadcast ${broadcastId} and its recipients could not be withdrawn (${detail}); review before any resend`);
    this.name = 'WhatsAppEnqueueUncertainError';
  }
}

async function settleUnconfirmedEnqueue(broadcastId: string, recipientIds: string[]): Promise<'withdrawn' | 'queued'> {
  let withdrawn: unknown[] | null = null;
  try {
    const { data, error } = await ownedDbTable('whatsapp_broadcast_recipients')
      .update({ status: 'failed', error_code: null, error_message: ENQUEUE_UNCONFIRMED_MESSAGE })
      .eq('broadcast_id', broadcastId)
      .in('id', recipientIds)
      .eq('status', 'pending')
      .select('id');
    if (error) throw new WhatsAppEnqueueUncertainError(broadcastId, error.message);
    withdrawn = Array.isArray(data) ? data : [];
  } catch (err) {
    if (err instanceof WhatsAppEnqueueUncertainError) throw err;
    throw new WhatsAppEnqueueUncertainError(broadcastId, err instanceof Error ? err.message : 'withdrawal failed');
  }
  return withdrawn.length === recipientIds.length ? 'withdrawn' : 'queued';
}

// ── Contact governance for one recipient (W0-C + owner GO 2026-11-08) ─────────

type GovernanceRead = Awaited<ReturnType<typeof loadTenantGovernanceRecords>>;

/**
 * The canonical verdict for one recipient: the restrictions on its PERSON, when the journey
 * named one, AND on its number. The person comes only from the recipient row, never from a
 * phone lookup; a manual recipient has none and is judged on the number alone.
 *
 * A2: judged through `evaluateGovernanceReads`, so each read's rows are judged at THAT
 * read's own database instant, never this host's clock (a clock running ahead ended an
 * in-force restriction early). `verdict` is null when the store could not be read OR the
 * reads are indeterminate (rows without a read instant, an inconsistent producer); the
 * caller refuses, and `refusal` says which.
 *
 * The third argument is the producer's REAL flat record count. The consistency GUARD it
 * feeds cannot fire for the tenant loader, by construction: `records` and `reads[0].records`
 * are the same array. Passing the real value costs nothing and stays correct if the loader
 * ever changes (05, A2).
 */
interface RecipientGovernance {
  verdict: MayContactResult | null;
  /** Why there is no verdict; null when there is one. */
  refusal: string | null;
}

function recipientVerdict(
  companyId:  string,
  personId:   unknown,
  phone:      string,
  governance: GovernanceRead,
): RecipientGovernance {
  if (!governance.ok) return { verdict: null, refusal: `governance unreadable: ${governance.error ?? 'unknown'}` };
  const decision = evaluateGovernanceReads(governance.reads, {
    organizationId:   companyId,
    personId:         typeof personId === 'string' && personId !== '' ? personId : null,
    targetNormalized: normalizeGovernanceTarget('whatsapp', phone),
    channel:          'whatsapp',
  }, governance.records.length);
  // `'verdict' in`, not the discriminant: this repo compiles with strict:false, where
  // `decision.ok` does not narrow the union.
  if ('verdict' in decision) return { verdict: decision.verdict, refusal: null };
  return { verdict: null, refusal: `governance indeterminate: ${'error' in decision ? decision.error : 'unknown'}` };
}

function governanceRefusalReason(decided: RecipientGovernance): string {
  const v = decided.verdict;
  return v ? `${v.governanceType ?? v.decision}: ${v.reason}` : decided.refusal ?? 'governance unreadable: unknown';
}

/**
 * Before the rate limit is consumed: every pending recipient already refused is moved to
 * `blocked_governance`. FAIL CLOSED: an unreadable store or recipient page throws, so the
 * broadcast is not started and no quota is consumed.
 */
async function screenPendingRecipients(companyId: string, broadcastId: string): Promise<void> {
  // The channel list is a HARD-CODED literal, and that is what keeps this safe: the loader adds
  // the all-channels wildcard to it, so ['whatsapp'] always makes a request. A blank channel or
  // the wildcard alone would make NO request (reads: []), which the evaluator reads as "nothing
  // applies" -> every recipient ALLOWED. Never pass a channel taken from data here (05).
  const governance = await loadTenantGovernanceRecords(companyId, ['whatsapp']);
  if (!governance.ok) throw new Error(`contact governance unreadable: ${governance.error ?? 'unknown'}`);

  let after: string | null = null;
  for (;;) {
    let page = ownedDbTable('whatsapp_broadcast_recipients')
      .select('id, encrypted_phone, person_id')
      .eq('broadcast_id', broadcastId)
      .eq('status', 'pending');
    if (after !== null) page = page.gt('id', after);
    const { data, error } = await page.order('id', { ascending: true }).limit(RECIPIENT_ID_PAGE);
    if (error) throw new Error(`Broadcast recipients unreadable: ${error.message}`);
    if (!data?.length) break;
    after = String(data[data.length - 1].id);

    for (const r of data) {
      // A number that cannot be read is left `pending`: processBatch, which decides at send
      // time, cannot read it either and sends nothing.
      let phone: string;
      try { phone = decryptPhone(r.encrypted_phone); } catch { continue; }
      const decided = recipientVerdict(companyId, r.person_id, phone, governance);
      if (decided.verdict && decided.verdict.decision === 'allowed') continue;
      const { error: blockError } = await ownedDbTable('whatsapp_broadcast_recipients')
        .update({ status: 'blocked_governance', error_code: null, error_message: `contact_governance: ${governanceRefusalReason(decided)}` })
        .eq('id', r.id)
        .eq('status', 'pending');
      if (blockError) throw new Error(`governance block could not be recorded: ${blockError.message}`);
    }
  }
}

// ── Send-time checks for journey broadcasts (B-17) ───────────────────────────

/**
 * The WS-3 tenant controls for this channel: null when it may be used, otherwise why
 * not. A failed read gives `configured: false`, so it refuses.
 */
export async function whatsappChannelRefusal(companyId: string): Promise<string | null> {
  if (isLeadOutreachGloballyDisabled()) return 'global_kill_switch';
  const config = await loadTenantGovernanceConfig(companyId);
  if (!config.configured || !config.enabled) return 'tenant_not_enabled';
  if (config.killSwitch) return 'tenant_kill_switch';
  if (!config.enabledChannels.includes('whatsapp')) return 'channel_not_enabled';
  return null;
}

/**
 * Has this number written to the tenant since the broadcast was created? The webhook
 * processor keys threads as wa:<account>:<digits>. Read against every WhatsApp account
 * of the tenant, as journeyResponses does. Not a verdict on the journey, which the next
 * sweep settles: only a reason not to send now. Fails closed.
 */
async function inboundRefusal(broadcast: any, phone: string): Promise<string | null> {
  const unreadable = 'inbound_unreadable';
  const createdMs = Date.parse(String(broadcast.created_at));
  if (!Number.isFinite(createdMs)) return unreadable;
  // Meta's timestamps have no milliseconds, so a reply in the same second must still count.
  const since = new Date(Math.floor(createdMs / 1000) * 1000).toISOString();
  const digits = phone.replace(/\D/g, '');

  try {
    const accounts = await ownedDbTable('social_accounts')
      .select('id')
      .eq('company_id', broadcast.company_id)
      .eq('platform', 'whatsapp');
    if (accounts.error) return unreadable;
    const threadKeys = (accounts.data ?? []).map((a) => `wa:${String(a.id)}:${digits}`);
    if (threadKeys.length === 0) return null;

    const threads = await ownedDbTable('engagement_threads')
      .select('id')
      .eq('organization_id', broadcast.company_id)
      .eq('platform', 'whatsapp')
      .in('platform_thread_id', threadKeys);
    if (threads.error) return unreadable;
    const threadIds = (threads.data ?? []).map((t) => String(t.id));
    if (threadIds.length === 0) return null;

    const messages = await ownedDbTable('engagement_messages')
      .select('id')
      .in('thread_id', threadIds)
      .eq('direction', 'inbound')
      .gte('created_at', since)
      .limit(1);
    if (messages.error) return unreadable;
    return (messages.data ?? []).length > 0 ? 'inbound_since_broadcast' : null;
  } catch {
    return unreadable;
  }
}

// ── Process a single batch (called by queue processor) ───────────────────────

export async function processBatch(
  broadcastId:  string,
  recipientIds: string[],
): Promise<void> {
  const { data: broadcast } = await ownedDbTable('whatsapp_broadcasts')
    .select('*')
    .eq('id', broadcastId)
    .single();

  if (!broadcast) throw new Error(`Broadcast not found: ${broadcastId}`);

  // B-17. The adapter checks the tenant controls before a journey broadcast exists, but
  // the job can wait in the queue, so a kill switch thrown or a reply received meanwhile
  // must still stop it. Journey broadcasts only: these are lead-outreach controls, and a
  // tenant with no config row would otherwise have every operator broadcast refused.
  const isJourney = typeof broadcast.name === 'string' && broadcast.name.startsWith(JOURNEY_BROADCAST_PREFIX);

  if (isJourney) {
    const refusal = await whatsappChannelRefusal(broadcast.company_id);
    if (refusal !== null) {
      const { error: blockError } = await ownedDbTable('whatsapp_broadcast_recipients')
        .update({ status: BLOCKED_SEND_CONTROL, error_code: null, error_message: `send_control: ${refusal}` })
        .in('id', recipientIds)
        .eq('status', 'pending');
      // Nothing was sent; the job retries and the row stays `pending` until it is recorded.
      if (blockError) throw new Error(`send control block could not be recorded: ${blockError.message}`);
      return;
    }
  }

  // Re-checked here, before the token is read, because a job may have been
  // queued (or a draft created) before the route checked ownership, and the
  // retry path reaches this function without the route. On refusal nothing is
  // sent, recipients stay `pending`, and the job fails visibly.
  let account: Awaited<ReturnType<typeof assertSenderMaySend>>;
  try {
    account = await assertSenderMaySend(broadcast.company_id, broadcast.social_account_id);
  } catch (err) {
    // A kill switch is not a failure of this job: pause, leave every recipient `pending`,
    // and return (no retry storm). Resume works once the switch clears.
    if (err instanceof WhatsAppSendStoppedError) { await pauseForStop(broadcastId, isJourney, err, recipientIds.length); return; }
    throw err;
  }

  if (!account.phone_number_id) throw new Error('phone_number_id not set on social account');

  const accessToken = await getValidAccessToken(broadcast.social_account_id);

  // ONLY `pending` recipients (be1771a2e, the main hotfix). A batch job is retried with
  // the SAME recipient_ids; the pending -> sending claim below is what guarantees a retry
  // never messages anyone twice, and this filter skips the rows already settled before any
  // governance read or decrypt. retryFailed resets failed rows to `pending` first, so that
  // path still reaches them. The person is part of the identity the check needs: an
  // unreadable page throws, so the job retries and nothing in it is sent.
  const { data: recipients, error: recipientsError } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('id, encrypted_phone, contact_name, person_id')
    .in('id', recipientIds)
    .eq('status', 'pending');
  if (recipientsError) throw new Error(`Broadcast recipients unreadable: ${recipientsError.message}`);

  if (!recipients?.length) return;

  // ── W0-C. CONTACT GOVERNANCE, before any external send ───────────────────
  // This path reaches Meta Graph without ever passing the outreach dispatch
  // gate, so the same canonical rules are applied here. `whatsapp` is already a
  // KNOWN_CHANNEL, so restrictions for it can exist and were simply not read.
  //
  // One tenant-scoped read per batch, then the PURE evaluator per recipient.
  // FAIL CLOSED: if the store cannot be read, NOTHING in this batch is sent.
  const rereadMs = positiveIntEnv('WHATSAPP_GOVERNANCE_REREAD_MS', DEFAULT_GOVERNANCE_REREAD_MS, MAX_GOVERNANCE_REREAD_MS);
  const rereadEvery = positiveIntEnv('WHATSAPP_GOVERNANCE_REREAD_EVERY', DEFAULT_GOVERNANCE_REREAD_EVERY, MAX_GOVERNANCE_REREAD_EVERY);
  console.debug('[whatsappBroadcast] governance re-read schedule', { broadcast_id: broadcastId, reread_ms: rereadMs, reread_every: rereadEvery });
  // Taken BEFORE the read, so the re-read schedule errs early, never late.
  let readStartedAt = Date.now();
  // The channel list is a HARD-CODED literal, and that is what keeps this safe: the loader adds
  // the all-channels wildcard to it, so ['whatsapp'] always makes a request. A blank channel or
  // the wildcard alone would make NO request (reads: []), which the evaluator reads as "nothing
  // applies" -> every recipient ALLOWED. Never pass a channel taken from data here (05).
  let governance = await loadTenantGovernanceRecords(broadcast.company_id, ['whatsapp']);
  let decidedSinceRead = 0;
  // A2 — THE DEFECT THIS CLOSES: the decision instant was `new Date()` on this
  // HOST, taken after the read, for every recipient. A host clock running ahead
  // ended an in-force restriction early (effective_until "passed") and let the
  // broadcast reach a number the tenant had restricted. No instant is taken here:
  // `evaluateGovernanceReads` judges the read's rows at the read's own `read_at`
  // (the database's transaction instant), and anything without a usable instant is
  // INDETERMINATE and fails closed, like an unreadable store.
  //
  // LIMIT, stated: the verdict is current as of THIS BATCH'S single read, not as
  // of each send. Batch staleness is bounded by the A2b re-read below: governance is
  // re-read every rereadMs or rereadEvery recipients, whichever comes first.

  let sentCount = 0;
  let failedCount = 0;

  for (let i = 0; i < recipients.length; i += 1) {
    const recipient = recipients[i];
    // OWNER RULINGS: the GLOBAL stops (env + the instant Super Admin switch, fail safe) are
    // checked before EVERY send; the flag is read through the kit's 30 s cache.
    const globalStop = await whatsappGlobalStop();
    if (globalStop) {
      await pauseForStop(broadcastId, isJourney, new WhatsAppSendStoppedError(globalStop), recipients.length - i);
      break;
    }
    // A2b — re-read governance for the REMAINING recipients when due.
    if (decidedSinceRead >= rereadEvery || Date.now() - readStartedAt >= rereadMs) {
      readStartedAt = Date.now();
      // The TENANT kill switch is re-read on the same cadence (every rereadMs / rereadEvery,
      // the bound an unsubscribe has): a switch flipped mid-run stops the rest of this batch.
      const stop = await whatsappKillSwitchStop(broadcast.company_id);
      if (stop) {
        await pauseForStop(broadcastId, isJourney, new WhatsAppSendStoppedError(stop), recipients.length - i);
        break;
      }
      // Same hard-coded ['whatsapp'] as the first read above (never a channel from data).
      const fresh = await loadTenantGovernanceRecords(broadcast.company_id, ['whatsapp']);
      if (!fresh.ok) {
        // FAIL CLOSED by stopping: nothing more is sent from this batch, and the
        // remaining recipients are left untouched ('pending'), so they stay retryable
        // (enqueueBroadcast re-queues every pending recipient). Marking them blocked
        // would turn a transient read failure into a permanent refusal.
        //
        // The broadcast is marked 'paused' - the state the rate-limit stop already
        // uses and the UI already shows - so an unfinished broadcast never looks
        // finished or merely idle. Resumption is MANUAL only (POST ?action=enqueue);
        // nothing auto-resumes a paused broadcast, so a persistent read failure
        // cannot loop. whatsapp_broadcasts has no reason column: this ERROR log is
        // the only record of WHY it paused (rate limit vs governance re-read).
        //
        // A resume works at any time: each enqueue run gives its batch jobs a fresh
        // UUID jobId (the resume fix, e9 decision (a)), so a completed job kept 24 h
        // by the queue no longer swallows the re-queue, and the run lease plus the
        // live-job check refuse a resume while a batch of this broadcast is still
        // queued or active.
        console.error('[whatsappBroadcast] governance re-read failed; batch stopped, broadcast paused, remaining recipients left pending. '
          + 'Resume is manual (?action=enqueue)', {
          broadcast_id: broadcastId,
          remaining: recipients.length - i,
          error: fresh.error ?? 'unknown',
        });
        const { error: pauseErr } = await ownedDbTable('whatsapp_broadcasts')
          .update({ status: 'paused', updated_at: new Date().toISOString() })
          .eq('id', broadcastId);
        if (pauseErr) {
          console.error('[whatsappBroadcast] could not mark the broadcast paused', { broadcast_id: broadcastId, error: pauseErr.message });
        }
        break;
      }
      governance = fresh;
      decidedSinceRead = 0;
    }
    decidedSinceRead += 1;
    const phone = decryptPhone(recipient.encrypted_phone);

    // Evaluated BEFORE the message body is built and before `fetch`, so a
    // refusal cannot reach the provider. The person's restrictions and the number's,
    // on every run of every batch, retries included, judged at the read's own
    // database instant (A2) - never this host's clock.
    const decided = recipientVerdict(broadcast.company_id, recipient.person_id, phone, governance);
    const verdict = decided.verdict;

    if (!verdict || verdict.decision !== 'allowed') {
      const reason = governanceRefusalReason(decided);
      // `error_code` is an INTEGER column (Meta's numeric code); the governance
      // cause is text and goes in `error_message`. Writing the text code into the
      // integer column failed the whole update, leaving the recipient `pending`.
      //
      // The write's error is READ (05, 2026-11-11): this exact write once failed silently
      // and left the recipient `pending` while the loop counted it refused. A failure
      // throws, like the send-control block below: nothing is sent to this recipient, the
      // row stays `pending`, and the job retries and re-reads governance.
      const { error: blockError } = await ownedDbTable('whatsapp_broadcast_recipients')
        .update({ status: 'blocked_governance', error_code: null, error_message: `contact_governance: ${reason}` })
        .eq('id', recipient.id)
        .eq('status', 'pending');
      if (blockError) throw new Error(`governance block could not be recorded: ${blockError.message}`);
      failedCount++;
      continue;
    }

    // After governance, which outranks it, so a recorded opt-out still reads as one.
    if (isJourney) {
      const refusal = await inboundRefusal(broadcast, phone);
      if (refusal !== null) {
        const { error: blockError } = await ownedDbTable('whatsapp_broadcast_recipients')
          .update({ status: BLOCKED_SEND_CONTROL, error_code: null, error_message: `send_control: ${refusal}` })
          .eq('id', recipient.id)
          .eq('status', 'pending');
        if (blockError) throw new Error(`send control block could not be recorded: ${blockError.message}`);
        failedCount++;
        continue;
      }
    }

    // ── CLAIM before the external send (compare-and-set) ──────────────────
    // A batch job is retried (attempts: 3) and a recipient id can reach two
    // batches, while this loop never looked at the status it was given. Only the
    // invocation that moves the row `pending → sending` may send it; every other
    // one skips, so a retry can never message a recipient twice.
    // send_started_at dates the claim, so the unconfirmed-send sweep measures age from it.
    const { data: claimed } = await ownedDbTable('whatsapp_broadcast_recipients')
      .update({ status: 'sending', send_started_at: new Date().toISOString() })
      .eq('id', recipient.id)
      .eq('status', 'pending')
      .select('id');
    if (!Array.isArray(claimed) || claimed.length === 0) continue;

    // L-4: the provider call alone is inside the try. Its outcome decides the state; a
    // failed write of that state never turns a confirmed send into an uncertain one.
    let res: Response;
    let result: any;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHATSAPP_SEND_TIMEOUT_MS);
    try {
      const messageBody = buildMessageBody(broadcast, phone, recipient.id);

      res = await fetch(`${META_GRAPH}/${account.phone_number_id}/messages`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify(messageBody),
        signal:  controller.signal,
      });

      result = await res.json().catch(() => ({}));
    } catch (err) {
      // The request may have reached Meta before the exception (a timeout, a reset
      // connection, a lost response): the outcome is UNKNOWN, so it is recorded as
      // uncertain and is never re-queued by `retryFailed`, which would risk a duplicate
      // message. A status webhook carrying this recipient's marker reconciles it.
      await resolveClaimedSend(recipient.id, {
        status: 'send_uncertain',
        error_message: controller.signal.aborted ? `provider call timed out after ${WHATSAPP_SEND_TIMEOUT_MS} ms` : (err instanceof Error ? err.message : 'Exception'),
      });
      failedCount++;
      continue;
    } finally {
      clearTimeout(timer);
    }

    const waMessageId = res.ok ? result?.messages?.[0]?.id : null;
    if (waMessageId) {
      // Confirmed by the provider's id: may advance `sending` OR the sweep's inferred
      // `send_uncertain`, but never a row that already carries an id (see
      // resolveClaimedSend).
      const { data: sentRows, error: sentError } = await ownedDbTable('whatsapp_broadcast_recipients')
        .update({ status: 'sent', wa_message_id: waMessageId, sent_at: new Date().toISOString() })
        .eq('id', recipient.id)
        .in('status', [...UNCONFIRMED_SEND_STATES])
        .is('wa_message_id', null)
        .select('id');
      // Sent, but not recorded: the row stays `sending` (never re-sent) and the status
      // webhook's marker records the message id.
      if (sentError) {
        console.warn('[wa-broadcast] sent but not recorded; left sending for reconciliation', recipient.id);
      } else if (!Array.isArray(sentRows) || sentRows.length === 0) {
        // Another path resolved the row first. Record this worker's proof alongside
        // what the row now says: a DIFFERENT id there means the recipient was messaged twice.
        const { data: now } = await ownedDbTable('whatsapp_broadcast_recipients')
          .select('status, wa_message_id')
          .eq('id', recipient.id)
          .maybeSingle();
        console.error('[wa-broadcast] SENT (provider id below) but the row had already been resolved by another path', {
          recipient_id: recipient.id,
          worker_wa_message_id: waMessageId,
          row_status: now?.status ?? null,
          row_wa_message_id: now?.wa_message_id ?? null,
          conflicting_ids: !!now?.wa_message_id && now.wa_message_id !== waMessageId,
        });
      }
      sentCount++;
    } else if (res.ok) {
      // Accepted without a message id: Meta may have sent it. Never retried
      // automatically (`retryFailed` only re-queues `failed`).
      await resolveClaimedSend(recipient.id, { status: 'send_uncertain', error_message: 'provider accepted the request without a message id' });
      failedCount++;
    } else if (isAmbiguousProviderStatus(res.status)) {
      // A 5xx or a 408 does not say the message was refused: it may have been sent.
      await resolveClaimedSend(recipient.id, { status: 'send_uncertain', error_code: res.status, error_message: result?.error?.message ?? `provider answered HTTP ${res.status}` });
      failedCount++;
    } else {
      const errCode    = result?.error?.code ?? res.status;
      const errMessage = result?.error?.message ?? 'Unknown error';
      // Fetch current retry_count then increment (supabase.rpc can't be used inline as a value)
      const { data: cur } = await ownedDbTable('whatsapp_broadcast_recipients')
        .select('retry_count')
        .eq('id', recipient.id)
        .single();
      await resolveClaimedSend(recipient.id, { status: 'failed', error_code: errCode, error_message: errMessage, retry_count: (cur?.retry_count ?? 0) + 1 });
      failedCount++;
    }
  }

  // Batch end: recompute the broadcast's counts from the rows, unconditionally (it is
  // idempotent; a batch that moved nothing still clears a deferred refresh).
  void sentCount; void failedCount;
  await refreshBroadcastCounts(broadcastId);
}

// ── Broadcast counts (recomputed from the recipient rows) ─────────────────────

/**
 * C10 (2026-11-11): the counters used to be bumped through rpc('increment_broadcast_counts')
 * and rpc('increment_broadcast_stat'), functions that exist in no environment, with the
 * results discarded - every count read 0 and no broadcast ever completed. Now one reviewed
 * function RECOMPUTES the counts from the recipient rows (idempotent, self-healing) and
 * completes a running broadcast with nothing pending/sending.
 *
 * minIntervalSeconds > 0 debounces (the delivery webhook can fire per message): a refresh
 * within the window only marks the broadcast dirty; batch ends refresh unconditionally and
 * readers refresh dirty broadcasts first (refreshDirtyBroadcastCounts), so nothing is lost.
 * Counts are bookkeeping: a failure is logged at ERROR and never fails the send or webhook.
 */
export const WEBHOOK_COUNTS_MIN_INTERVAL_SECONDS = 30;

export async function refreshBroadcastCounts(
  broadcastId: string,
  minIntervalSeconds = 0,
): Promise<'refreshed' | 'deferred' | 'missing' | 'error'> {
  try {
    const { data, error } = await supabase.rpc('whatsapp_refresh_broadcast_counts', {
      p_broadcast_id:         broadcastId,
      p_min_interval_seconds: minIntervalSeconds,
    });
    if (error) {
      console.error('[wa-broadcast] broadcast counts NOT refreshed', { broadcast_id: broadcastId, error: error.message });
      return 'error';
    }
    if (data === 'refreshed' || data === 'deferred' || data === 'missing') return data;
    console.error('[wa-broadcast] broadcast counts refresh returned no answer', { broadcast_id: broadcastId });
    return 'error';
  } catch (err) {
    console.error('[wa-broadcast] broadcast counts refresh threw', {
      broadcast_id: broadcastId, error: err instanceof Error ? err.message : String(err),
    });
    return 'error';
  }
}

/**
 * Readers call this BEFORE reading counts: every listed broadcast whose last refresh was
 * deferred is recomputed now (unconditionally), so a reader never sees a debounced gap.
 */
export async function refreshDirtyBroadcastCounts(broadcasts: Array<{ id: string; counts_dirty?: boolean | null }>): Promise<number> {
  let n = 0;
  for (const b of broadcasts) {
    if (b.counts_dirty !== true) continue;
    if ((await refreshBroadcastCounts(b.id)) === 'refreshed') n += 1;
  }
  return n;
}

// ── Build message body ────────────────────────────────────────────────────────

function buildMessageBody(broadcast: any, toPhone: string, recipientId: string): Record<string, unknown> {
  const base = {
    messaging_product: 'whatsapp',
    recipient_type:    'individual',
    to:                toPhone,
    // L-4: Meta echoes this in every status webhook for the message, so a send whose
    // response was lost (send_uncertain, or `sending` after a crash) can be matched to
    // its recipient and reconciled. Our own recipient id only: no number, no text.
    biz_opaque_callback_data: recipientId,
  };

  if (broadcast.message_type === 'template' && broadcast.template_name) {
    return { ...base, type: 'template', template: { name: broadcast.template_name, language: { code: 'en_US' }, ...(broadcast.template_params ?? {}) } };
  }

  if (broadcast.message_type === 'image' && broadcast.media_id) {
    return { ...base, type: 'image', image: { id: broadcast.media_id, caption: broadcast.media_caption ?? '' } };
  }

  return { ...base, type: 'text', text: { body: broadcast.body ?? '' } };
}

// ── Retry failed recipients ───────────────────────────────────────────────────

/** Retry failed recipients - under the SAME lease and live-job check as an enqueue. */
export async function retryFailed(broadcastId: string): Promise<RetryResult> {
  // The sender account must be owned AND connected before anything is reset or queued
  // (e9): processBatch would refuse at send, but only after the failed rows were reset.
  const { data: broadcast, error } = await ownedDbTable('whatsapp_broadcasts')
    .select('company_id, social_account_id')
    .eq('id', broadcastId)
    .single();
  if (error || !broadcast) throw new Error(`Broadcast not found: ${broadcastId}`);
  await assertSenderMaySend(broadcast.company_id, broadcast.social_account_id);
  return withBroadcastLease(broadcastId, () => retryRun(broadcastId),
    'Another enqueue or retry of this broadcast is in progress.');
}

/** One retry run. Called ONLY under the enqueue lease. */
/** Why a retry found nothing: refusals (never retried) and failures out of retries. */
async function unretryableCounts(broadcastId: string): Promise<{ refused: number; exhausted: number }> {
  const count = async (build: (q: any) => any): Promise<number> => {
    // Explanatory only - it never decides anything - so an unreadable count is reported as none.
    try {
      const { count: n, error } = await build(ownedDbTable('whatsapp_broadcast_recipients')
        .select('id', { count: 'exact', head: true })
        .eq('broadcast_id', broadcastId));
      return error ? 0 : n ?? 0;
    } catch {
      return 0;
    }
  };
  const [refused, exhausted] = await Promise.all([
    count((q) => q.in('status', ['blocked_governance', BLOCKED_SEND_CONTROL])),
    count((q) => q.eq('status', 'failed').gte('retry_count', 3)),
  ]);
  return { refused, exhausted };
}

async function retryRun(broadcastId: string): Promise<RetryResult> {
  const { getContentQueue } = await import('../queue/contentGenerationQueues');
  const queue = getContentQueue('whatsapp-broadcast');
  const live = await liveBatchJobCount(queue as never, broadcastId);
  if (live > 0) throw alreadyRunning(live, 'retrying');

  const { data: failed } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('id')
    .eq('broadcast_id', broadcastId)
    .eq('status', 'failed')
    .lt('retry_count', 3);

  if (!failed?.length) return { retried: 0, ...(await unretryableCounts(broadcastId)) };

  // Reset to pending for re-enqueue: only rows that are STILL `failed` (compare-and-set).
  // A status webhook may have moved one to `delivered` since the read above; resetting it
  // would send that message a second time.
  const { data: reset, error: resetError } = await ownedDbTable('whatsapp_broadcast_recipients')
    .update({ status: 'pending', next_retry_at: null })
    .in('id', failed.map((r) => r.id))
    .eq('status', 'failed')
    .select('id');
  if (resetError) throw new Error(`retry reset failed: ${resetError.message}`);
  const retryIds = (reset ?? []).map((r: { id: string }) => r.id);
  if (retryIds.length === 0) return { retried: 0 };

  // Re-enqueue as a single batch
  try {
    await enqueueOrThrow(queue, 'whatsapp-broadcast', 'wa-broadcast-batch', {
      broadcast_id:  broadcastId,
      recipient_ids: retryIds,
    }, {
      // A UUID, not Date.now(): two retries in one millisecond shared an id and the
      // second was silently deduped.
      jobId:    `wa-retry-${broadcastId}-${crypto.randomUUID()}`,
      priority: 7,
      attempts: 2,
      backoff:  { type: 'exponential', delay: 10000 },
    });
  } catch (enqueueError) {
    // L-4: as in enqueueBroadcast, the retry job may exist; withdraw what it has not claimed.
    if ((await settleUnconfirmedEnqueue(broadcastId, retryIds)) === 'withdrawn') throw enqueueError;
  }
  return { retried: retryIds.length };
}

// ── Update delivery status (called by deliveryTracker) ───────────────────────

/**
 * The statuses each webhook event may move a recipient FROM, so status only goes
 * forward. Meta does not order its webhooks and a job can replay them, so without this
 * a late `sent` rewrites `delivered`, and a late `failed` makes a delivered message
 * eligible for `retryFailed`: a duplicate. `failed` can still be overtaken: evidence
 * that it arrived outranks it. A row only has a message id once `processBatch` wrote
 * `sent`, so a `sent` event never has anything to advance, and `pending` or `sending`
 * here mean a retry is in flight and the id belongs to the previous attempt.
 */
const DELIVERY_ADVANCES_FROM: Record<RecipientDeliveryUpdate['status'], readonly string[]> = {
  sent:      [],
  failed:    ['sent'],
  delivered: ['sent', 'failed'],
  read:      ['sent', 'failed', 'delivered'],
};

export interface DeliveryEvidenceEvent {
  status:       RecipientDeliveryUpdate['status'];
  event_at:     string;
  error_code?:  number | null;
  error_title?: string | null;
}

/** Forward order: the tie-break for events Meta stamped with the same second. */
const DELIVERY_RANK: Record<RecipientDeliveryUpdate['status'], number> = { sent: 0, failed: 1, delivered: 2, read: 3 };

/**
 * Follow-up A. Where a message ends after these provider events, applied in event order
 * through DELIVERY_ADVANCES_FROM (the rule the status webhook applies one event at a time),
 * starting from `sent`: an attached message id means Meta accepted the message. Pure.
 * `permanentFailureCode` is set when an applied `failed` carried a permanent code, where the
 * webhook path would have written the N-2 restriction.
 */
export function foldDeliveryEvidence(events: readonly DeliveryEvidenceEvent[]): {
  status:               RecipientDeliveryUpdate['status'];
  sent_at:              string | null;
  delivered_at:         string | null;
  read_at:              string | null;
  error_code:           number | null;
  error_message:        string | null;
  permanentFailureCode: number | null;
} {
  const ordered = [...events].sort((a, b) =>
    a.event_at < b.event_at ? -1 : a.event_at > b.event_at ? 1 : DELIVERY_RANK[a.status] - DELIVERY_RANK[b.status]);
  const out = {
    status:               'sent' as RecipientDeliveryUpdate['status'],
    sent_at:              ordered[0]?.event_at ?? null,
    delivered_at:         null as string | null,
    read_at:              null as string | null,
    error_code:           null as number | null,
    error_message:        null as string | null,
    permanentFailureCode: null as number | null,
  };
  for (const e of ordered) {
    if (!DELIVERY_ADVANCES_FROM[e.status].includes(out.status)) continue;
    out.status = e.status;
    if (e.status === 'delivered') out.delivered_at = e.event_at;
    if (e.status === 'read') out.read_at = e.event_at;
    if (typeof e.error_code === 'number') out.error_code = e.error_code;
    if (e.error_title) out.error_message = e.error_title;
    if (e.status === 'failed' && typeof e.error_code === 'number' && WHATSAPP_PERMANENT_FAILURE_CODES.includes(e.error_code)) {
      out.permanentFailureCode = e.error_code;
    }
  }
  return out;
}

/**
 * N-2. Meta error codes that mean the NUMBER cannot receive WhatsApp, not that this one send
 * failed: 131026 "Message undeliverable" (not a WhatsApp user, or cannot receive). Such a
 * failure writes an `invalid_contact` restriction on (tenant, whatsapp, number), the same
 * role a permanent SES bounce plays for an address (`bounce_hard`). Every other code is
 * evidence only. A deliberately short list: widening it is an owner decision.
 */
export const WHATSAPP_PERMANENT_FAILURE_CODES: readonly number[] = [131026];
export const WHATSAPP_STATUS_SOURCE = 'webhook:whatsapp_status';

/**
 * G-9b. Append one Meta status event to `whatsapp_provider_events`. Identity and status
 * only — never the number or text. A replay collapses on (message, status, event time) and
 * is not an error. Throws on any other failure, so the webhook job is retried.
 */
export async function recordWhatsAppProviderEvent(event: {
  wa_message_id: string;
  status: RecipientDeliveryUpdate['status'];
  timestamp?: unknown;
  error_code?: number;
  error_message?: string;
  /** Follow-up A: the recipient its marker named, ONLY once verifyCallbackRecipient matched the number. */
  verified_recipient_id?: string | null;
}): Promise<'recorded' | 'duplicate'> {
  const seconds = typeof event.timestamp === 'string' || typeof event.timestamp === 'number' ? Number(event.timestamp) : NaN;
  // Meta always stamps a status; a missing stamp is recorded at receipt time.
  const eventAt = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
  const { error } = await ownedDbTable('whatsapp_provider_events').insert({
    wa_message_id: event.wa_message_id,
    event_status:  event.status,
    event_at:      eventAt.toISOString(),
    error_code:    typeof event.error_code === 'number' ? event.error_code : null,
    error_title:   event.error_message ?? null,
    // Only when present, so an event without a marker is written exactly as before.
    ...(event.verified_recipient_id ? { verified_recipient_id: event.verified_recipient_id } : {}),
  });
  if (!error) return 'recorded';
  if ((error as { code?: string }).code === '23505') return 'duplicate';
  throw new Error(`[wa-delivery] provider event not recorded: ${(error as { code?: string }).code ?? 'unknown'}`);
}

/**
 * N-2. Before a permanent failure moves the recipient, record the restriction, so a failed
 * write is retried with the event (once the row has moved to `failed`, a replay would find
 * nothing to advance and the restriction would never be written).
 */
async function restrictPermanentFailure(update: RecipientDeliveryUpdate, advancesFrom: readonly string[]): Promise<void> {
  if (update.status !== 'failed' || typeof update.error_code !== 'number') return;
  if (!WHATSAPP_PERMANENT_FAILURE_CODES.includes(update.error_code)) return;

  const { data: rows, error } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('id, broadcast_id, encrypted_phone')
    .eq('wa_message_id', update.wa_message_id)
    .in('status', [...advancesFrom]);
  if (error) throw new Error(`[wa-delivery] recipient read failed: ${error.message}`);
  const recipient = (rows ?? [])[0] as { id: string; broadcast_id: string; encrypted_phone: string } | undefined;
  if (!recipient) return;

  const { data: broadcast, error: bErr } = await ownedDbTable('whatsapp_broadcasts')
    .select('company_id')
    .eq('id', recipient.broadcast_id)
    .maybeSingle();
  if (bErr || !broadcast?.company_id) throw new Error('[wa-delivery] broadcast tenant unreadable');

  await recordInvalidContact(String(broadcast.company_id), recipient.encrypted_phone, update.wa_message_id, update.error_code, recipient.id);
}

/** N-2: the `invalid_contact` restriction on (tenant, whatsapp, number). Collapses on the store's canonical key. */
export async function recordInvalidContact(
  companyId: string,
  encryptedPhone: string,
  waMessageId: string,
  errorCode: number,
  recipientId: string,
): Promise<void> {
  await recordContactGovernance({
    organizationId: companyId,
    governanceType: 'invalid_contact',
    channel: 'whatsapp',
    personId: null,
    target: decryptPhone(encryptedPhone),
    source: WHATSAPP_STATUS_SOURCE,
    // Summary only: the message id and Meta's code, never the number.
    evidence: { waMessageId, errorCode, recipientId },
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * L-4. A send whose response was lost is `send_uncertain` (or `sending`, if the process died
 * after the claim) with no message id, so a status event, keyed by message id, cannot find
 * it. Every message carries its recipient id as biz_opaque_callback_data, which Meta echoes
 * in its status events. When such an event names an unconfirmed recipient with no message
 * id AND the event's recipient number is that recipient's number, the provider has the
 * message: the id is attached and the row becomes `sent` (compare-and-set), then the event
 * is applied as usual (delivered, read, failed, the N-2 restriction). Nothing is ever sent
 * here; an event that does not match exactly changes nothing. Returns whether it attached.
 */
/**
 * The recipient a status event's marker names, when the event's number is that recipient's
 * number; otherwise null. A read failure throws, so the webhook job is retried. The webhook
 * job records the answer in the provider event ledger (Follow-up A), so the evidence
 * outlives a job that later runs out of attempts.
 */
export async function verifyCallbackRecipient(callbackData: unknown, recipientWaId: unknown): Promise<string | null> {
  const recipientId = typeof callbackData === 'string' ? callbackData.trim() : '';
  if (!UUID_RE.test(recipientId)) return null;
  const waId = typeof recipientWaId === 'string' ? recipientWaId.replace(/\D/g, '') : '';
  if (!waId) return null;

  const { data: rows, error } = await ownedDbTable('whatsapp_broadcast_recipients')
    .select('id, encrypted_phone')
    .eq('id', recipientId);
  if (error) throw new Error(`[wa-delivery] marked recipient read failed: ${error.message}`);
  const row = (rows ?? [])[0] as { id: string; encrypted_phone: string } | undefined;
  if (!row) return null;

  let number = '';
  try {
    number = decryptPhone(row.encrypted_phone).replace(/\D/g, '');
  } catch {
    return null;
  }
  if (number !== waId) {
    console.warn('[wa-delivery] status marker names a recipient whose number differs; not reconciled', recipientId);
    return null;
  }
  return row.id;
}

async function reconcileUnconfirmedSend(update: RecipientDeliveryUpdate): Promise<boolean> {
  const recipientId = await verifyCallbackRecipient(update.callback_data, update.recipient_wa_id);
  if (!recipientId) return false;

  const { data: attached, error: attachError } = await ownedDbTable('whatsapp_broadcast_recipients')
    .update({ status: 'sent', wa_message_id: update.wa_message_id, sent_at: new Date().toISOString() })
    .eq('id', recipientId)
    .in('status', [...UNCONFIRMED_SEND_STATES])
    .is('wa_message_id', null)
    .select('id');
  if (attachError) throw new Error(`[wa-delivery] unconfirmed recipient reconcile failed: ${attachError.message}`);
  return Array.isArray(attached) && attached.length > 0;
}

export async function updateRecipientDelivery(update: RecipientDeliveryUpdate): Promise<void> {
  // L-4 first: an unconfirmed send gets its message id, then the event applies as usual.
  await reconcileUnconfirmedSend(update);

  const advancesFrom = DELIVERY_ADVANCES_FROM[update.status];
  if (advancesFrom.length === 0) return;

  await restrictPermanentFailure(update, advancesFrom);

  // No status_at: that column is on engagement_messages. Writing it here failed every
  // delivery update, silently, because the result below read as 'no such recipient'.
  const updateData: Record<string, unknown> = {
    status:    update.status,
  };

  if (update.status === 'delivered') updateData.delivered_at = new Date().toISOString();
  if (update.status === 'read')      updateData.read_at      = new Date().toISOString();
  if (update.error_code)             updateData.error_code   = update.error_code;
  if (update.error_message)          updateData.error_message = update.error_message;

  // Not `.single()`: wa_message_id has no unique key on the chain, and zero rows is the
  // normal answer for a message that is not ours or an event that has nothing to advance.
  const { data: moved, error } = await ownedDbTable('whatsapp_broadcast_recipients')
    .update(updateData)
    .eq('wa_message_id', update.wa_message_id)
    .in('status', [...advancesFrom])
    .select('broadcast_id');

  // Thrown so the webhook job is retried. Only rows that moved are counted below, so
  // replaying an event that did apply cannot count it twice.
  if (error) throw new Error(`[wa-delivery] delivery update failed: ${error.message}`);

  const recipient = moved?.[0];
  if (!recipient) return;

  // Recompute the broadcast's counts, debounced (one refresh per window; a deferred one
  // marks the broadcast dirty for the next batch end or reader).
  await refreshBroadcastCounts(recipient.broadcast_id, WEBHOOK_COUNTS_MIN_INTERVAL_SECONDS);
}
