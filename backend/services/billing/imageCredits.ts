/**
 * Image credits — reserve before the paid provider call, settle on success,
 * release on failure. Owner ruling 2026-11-11: "charge image credits BEFORE
 * launch" (BLOCKING, money).
 *
 * ONE helper for every paid image call: the creator gpt-image flow
 * (creatorAssetRendererMedia) and the render pipeline (Orchestration wires it
 * per attempt). It invents nothing — it composes the existing pieces:
 *
 *   price    pricingService.resolveVendorUnitCost — provider unit cost
 *            (llm_model_pricing kind='unit') x action_pricing_config multiplier
 *            at the org credit rate; then CLAMPED to the IMAGE_GENERATION
 *            catalog bounds (the catalog supplies bounds, never the price).
 *   credits  creditExecutionServiceContracts.reserveCreditsForWork /
 *            confirmCreditReservation / releaseCreditReservation — the hold /
 *            confirm / release primitives under executeWithCredits (atomic
 *            apply_credit_reservation RPC; idempotent per key).
 *   lineage  enterpriseBillingOrchestrator.openBillingOperation /
 *            closeBillingOperation — one billing_operations row per attempt.
 *
 * CONTRACT
 * - reserve: fail CLOSED. No price, no credits, a blocked org, an unresolvable
 *   registry entry or an infra error => ok:false and the caller makes NO
 *   provider call.
 * - One reservation per attempt key. The same key again returns the SAME
 *   billingOperationId. The creator flow's keys carry a per-invocation nonce
 *   (creator-image:<org>:<uuid>:<n>), so it never presents a repeated key; the
 *   render pipeline's per-attempt keys are serialised by its claim / CAS. The
 *   same-key path is therefore DEFENCE for a future caller with a deterministic
 *   key, and the open converges on the row that owns the key (re-read after
 *   open) rather than relying on any caller's key shape. A REFUSED key is reusable (nothing was held). A
 *   key whose reservation was confirmed or released is SPENT ('key_spent').
 * - settle / release work BY billingOperationId with no request context
 *   (sweeper-callable), load everything from the row, and move exactly the one
 *   held row (compare-and-set on status). Release never un-confirms.
 * - Every external step is bounded by a timeout and surfaces as 'unavailable',
 *   never a hang. A reserve that times out may still have committed its hold
 *   server-side: that is safe — a retry with the same key finds it (same
 *   billingOperationId), and an abandoned hold is released by the orphan-hold
 *   reaper or the render sweeper (release, never charge).
 * - The helper only touches rows it created (metadata.helper).
 */
import { randomUUID } from 'crypto';
import { logger } from '../logger';

export const IMAGE_CREDIT_ACTION = 'image_generation';
export const IMAGE_CREDITS_HELPER = 'image_credits_v1';
const MODULE = 'image_credits';
const STEP_TIMEOUT_MS = 8_000;

export type ImageReserveRefusal = 'insufficient_credits' | 'org_blocked' | 'not_priced' | 'key_spent' | 'unavailable';

export interface ReserveImageCreditsInput {
  organizationId: string;
  /** One per attempt (render: per-attempt key; creator flow: per provider call). */
  idempotencyKey: string;
  correlationId?: string;
  actorUserId?: string | null;
  /** The billable SKU: what the provider charges for (unit cost lookup only). */
  provider: string;
  model: string;
  size: string;
  quality: string;
  metadata?: Record<string, unknown>;
}

export type ReserveImageCreditsResult =
  | { ok: true; billingOperationId: string; creditsReserved: number }
  | { ok: false; reason: ImageReserveRefusal; detail?: string };

export type SettleImageCreditsResult =
  | { ok: true; creditsCharged: number }
  | { ok: false; reason: 'not_held' | 'unavailable'; detail?: string };

export type ReleaseImageCreditsResult =
  | { ok: true }
  | { ok: false; reason: 'not_held' | 'unavailable'; detail?: string };

interface HoldHandle {
  orgId: string; userId: string; action: string; referenceType: string; referenceId: string;
  idempotencyKey: string; holdTransactionId: string; creditsReserved: number;
  split: { free: number; incentive: number; paid: number };
}
interface OpRow { id: string; status: string; organization_id: string; idempotency_key: string; metadata: Record<string, unknown> | null }

/** Every dependency is injectable so tests can drive each outcome; production uses the real modules. */
export interface ImageCreditsDeps {
  resolveFeatureActionKey(action: string): string | null;
  bounds(): { min: number; max: number };
  price(input: { provider: string; unit: string; units: number; actionKey: string; orgId: string }): Promise<{ credits: number; snapshot: Record<string, unknown> }>;
  isPricingMissing(err: unknown): boolean;
  findOpByKey(key: string): Promise<OpRow | null>;
  findOpById(id: string): Promise<OpRow | null>;
  openOp(args: { organizationId: string; actorUserId: string | null; idempotencyKey: string; correlationId: string; amountEstimated: number; metadata: Record<string, unknown> }): Promise<string>;
  closeOp(id: string, patch: Record<string, unknown>, fromStatuses: ReadonlyArray<string>): Promise<{ updated: number | null; error: string | null }>;
  reserve(opts: Record<string, unknown>): Promise<{ status: string } & Partial<HoldHandle> & Record<string, unknown>>;
  confirm(handle: HoldHandle & { note?: string }): Promise<{ status: string; creditsCharged?: number; confirmTransactionId?: string | null }>;
  release(handle: HoldHandle & { note?: string }): Promise<{ status: string; releaseTransactionId?: string | null }>;
  timeoutMs?: number;
}

class StepTimeout extends Error {}
function bounded<T>(p: Promise<T>, ms: number, step: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, rej) => { t = setTimeout(() => rej(new StepTimeout(`image credits: ${step} timed out after ${ms}ms`)), ms); }),
  ]).finally(() => { if (t) clearTimeout(t); });
}

/** The SKU string priced in llm_model_pricing (provider = vendor, model_name = this). */
export function imageUnitFor(model: string, size: string, quality: string): string {
  return `${String(model).trim()}:${String(size).trim()}:${String(quality || 'auto').trim()}`.toLowerCase();
}

/**
 * The image SKUs the owner must price in Super Admin before images can be
 * generated (owner ruling 2026-11-11: no seeded prices; fail closed until set).
 * Derived from what the code SENDS:
 *  - creator flow (creatorAssetRendererMedia): AI_IMAGE_SIZE 1024x1024;
 *    generate + showcase edit at 'low'; a main-subject reference edit raises
 *    'low' to 'medium' (referenceEditParams); model gpt-image-1.5, falling back
 *    to gpt-image-1 when 1.5 is unavailable.
 *  - render pipeline (Orchestration): gpt-image-1.5 at 'medium' in the three
 *    supported sizes.
 * Keep in step with those call sites; the Super Admin page lists these.
 */
export const REQUIRED_IMAGE_SKUS: ReadonlyArray<{ provider: string; model: string; size: string; quality: string; usedBy: string }> = Object.freeze([
  { provider: 'openai', model: 'gpt-image-1.5', size: '1024x1024', quality: 'low',    usedBy: 'creator: generate, style-reference edit' },
  { provider: 'openai', model: 'gpt-image-1.5', size: '1024x1024', quality: 'medium', usedBy: 'creator: main-subject edit; render' },
  { provider: 'openai', model: 'gpt-image-1.5', size: '1024x1536', quality: 'medium', usedBy: 'render (portrait)' },
  { provider: 'openai', model: 'gpt-image-1.5', size: '1536x1024', quality: 'medium', usedBy: 'render (landscape)' },
  { provider: 'openai', model: 'gpt-image-1',   size: '1024x1024', quality: 'low',    usedBy: 'creator fallback model' },
  { provider: 'openai', model: 'gpt-image-1',   size: '1024x1024', quality: 'medium', usedBy: 'creator fallback model' },
]);

export function clampCredits(credits: number, bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, Math.max(bounds.min, Math.ceil(credits)));
}

const isHelperRow = (op: OpRow | null) => Boolean(op && (op.metadata as Record<string, unknown> | null)?.helper === IMAGE_CREDITS_HELPER);
const REUSABLE = ['initiated', 'insufficient', 'error'] as const;

export function makeImageCredits(deps: ImageCreditsDeps) {
  const ms = deps.timeoutMs ?? STEP_TIMEOUT_MS;

  async function reserveImageCredits(input: ReserveImageCreditsInput): Promise<ReserveImageCreditsResult> {
    const key = String(input.idempotencyKey ?? '').trim();
    if (!key || !input.organizationId) return { ok: false, reason: 'unavailable', detail: 'organizationId and idempotencyKey are required' };

    // The registry must resolve the action to ITSELF (an unregistered key falls
    // back to a different cost centre — reports.snapshot / website_audit).
    const resolved = deps.resolveFeatureActionKey(IMAGE_CREDIT_ACTION);
    if (resolved !== IMAGE_CREDIT_ACTION) {
      logger.error('image_credits_registry_unresolved', { resolved });
      return { ok: false, reason: 'not_priced', detail: `registry resolved '${IMAGE_CREDIT_ACTION}' to '${resolved}'` };
    }

    try {
      const existing = await bounded(deps.findOpByKey(key), ms, 'lookup');
      if (existing && !isHelperRow(existing)) {
        logger.error('image_credits_foreign_row_for_key', { key, opId: existing.id });
        return { ok: false, reason: 'key_spent', detail: 'key belongs to a row this helper did not create' };
      }
      if (existing && existing.status === 'held') {
        const hold = (existing.metadata as Record<string, unknown>)?.hold as HoldHandle | undefined;
        return { ok: true, billingOperationId: existing.id, creditsReserved: hold?.creditsReserved ?? 0 };
      }
      if (existing && !(REUSABLE as readonly string[]).includes(existing.status)) {
        logger.warn('image_credits_key_spent', { key, opId: existing.id, status: existing.status });
        return { ok: false, reason: 'key_spent', detail: `reservation already ${existing.status}` };
      }

      // Price: unit cost x multiplier at the org rate, clamped to the catalog bounds.
      let credits: number;
      let snapshot: Record<string, unknown>;
      try {
        const priced = await bounded(deps.price({
          provider: input.provider.toLowerCase(),
          unit: imageUnitFor(input.model, input.size, input.quality),
          units: 1,
          actionKey: IMAGE_CREDIT_ACTION,
          orgId: input.organizationId,
        }), ms, 'price');
        const b = deps.bounds();
        credits = clampCredits(priced.credits, b);
        snapshot = { ...priced.snapshot, unclamped_credits: priced.credits, catalog_min: b.min, catalog_max: b.max, credits };
      } catch (err) {
        if (err instanceof StepTimeout) throw err;
        if (deps.isPricingMissing(err)) {
          logger.warn('image_credits_not_priced', { provider: input.provider, unit: imageUnitFor(input.model, input.size, input.quality) });
          return {
            ok: false,
            reason: 'not_priced',
            detail: `not priced: ${input.provider.toLowerCase()} '${imageUnitFor(input.model, input.size, input.quality)}' - `
              + 'a Super Admin must set it under Pricing > Provider unit costs (image SKUs: '
              + REQUIRED_IMAGE_SKUS.map((k) => imageUnitFor(k.model, k.size, k.quality)).join(', ') + ')'
              + ` [cause: ${err instanceof Error ? err.message : String(err)}]`,
          };
        }
        throw err;
      }

      const correlationId = input.correlationId ?? randomUUID();
      const baseMeta = {
        ...(input.metadata ?? {}),
        helper: IMAGE_CREDITS_HELPER,
        sku: { provider: input.provider, model: input.model, size: input.size, quality: input.quality },
        pricing: snapshot,
      };
      let opId = existing?.id ?? null;
      if (!opId) {
        await bounded(deps.openOp({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId ?? null,
          idempotencyKey: key,
          correlationId,
          amountEstimated: credits,
          metadata: baseMeta,
        }), ms, 'open');
        // openBillingOperation upserts on the key; re-read by key so a lost
        // first-open race converges on the ONE row that owns it instead of
        // depending on the caller's key shape (05).
        const owner = await bounded(deps.findOpByKey(key), ms, 'lookup-after-open');
        if (!owner || !isHelperRow(owner)) return { ok: false, reason: 'unavailable', detail: 'could not open the billing operation' };
        if (owner.status === 'held') {
          const hold = (owner.metadata as Record<string, unknown>)?.hold as HoldHandle | undefined;
          return { ok: true, billingOperationId: owner.id, creditsReserved: hold?.creditsReserved ?? 0 };
        }
        if (!(REUSABLE as readonly string[]).includes(owner.status)) return { ok: false, reason: 'key_spent', detail: `reservation already ${owner.status}` };
        opId = owner.id;
      }

      const res = await bounded(deps.reserve({
        userId: input.organizationId,            // org-as-actor sentinel (no session; membership not re-checked)
        orgId: input.organizationId,
        action: IMAGE_CREDIT_ACTION,
        referenceType: IMAGE_CREDIT_ACTION,
        referenceId: key,
        idempotencyKey: key,
        amountOverride: credits,
        note: `image ${imageUnitFor(input.model, input.size, input.quality)}`,
        validateMembership: false,
      }), ms, 'reserve');

      if (res.status === 'reserved' || res.status === 'already_reserved') {
        const hold: HoldHandle = {
          orgId: res.orgId as string, userId: res.userId as string, action: res.action as string,
          referenceType: res.referenceType as string, referenceId: res.referenceId as string,
          idempotencyKey: res.idempotencyKey as string, holdTransactionId: res.holdTransactionId as string,
          creditsReserved: Number(res.creditsReserved), split: res.split as HoldHandle['split'],
        };
        const moved = await bounded(deps.closeOp(opId, {
          status: 'held', reservationTxnId: hold.holdTransactionId, metadata: { ...baseMeta, hold },
        }, REUSABLE), ms, 'mark-held');
        if (moved.error || moved.updated !== 1) {
          // The credits ARE held; the lineage row could not record it. Release
          // the hold rather than leave an untracked reservation (fail closed).
          const orphan = await bounded(deps.release({ ...hold, note: 'image credits: lineage write failed' }), ms, 'release-orphan')
            .then((x) => x.status)
            .catch((e: unknown) => `release failed: ${e instanceof Error ? e.message : String(e)}`);
          logger.error('image_credits_lineage_failed', { opId, key, updated: moved.updated, error: moved.error, holdId: hold.holdTransactionId, orphanRelease: orphan });
          return { ok: false, reason: 'unavailable', detail: 'could not record the hold' };
        }
        return { ok: true, billingOperationId: opId, creditsReserved: hold.creditsReserved };
      }

      // Refusals leave NOTHING held; the row is closed as refused so the key stays reusable.
      const refusal: { reason: ImageReserveRefusal; status: 'insufficient' | 'error' } =
        res.status === 'insufficient_credits' || res.status === 'no_credit_account'
          ? { reason: 'insufficient_credits', status: 'insufficient' }
          : res.status === 'org_control_blocked' || res.status === 'not_a_member'
            ? { reason: 'org_blocked', status: 'error' }
            : res.status === 'already_confirmed' || res.status === 'already_released'
              ? { reason: 'key_spent', status: 'error' }
              : { reason: 'unavailable', status: 'error' };
      await bounded(deps.closeOp(opId, { status: refusal.status, failureReason: res.status, metadata: baseMeta }, REUSABLE), ms, 'mark-refused')
        .catch((e) => logger.warn('image_credits_refusal_not_recorded', { opId, message: e instanceof Error ? e.message : String(e) }));
      return { ok: false, reason: refusal.reason, detail: res.status };
    } catch (err) {
      logger.warn('image_credits_reserve_unavailable', { key, message: err instanceof Error ? err.message : String(err) });
      return { ok: false, reason: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async function loadHeld(billingOperationId: string): Promise<{ op: OpRow; hold: HoldHandle } | { notHeld: string } | { unavailable: string }> {
    try {
      const op = await bounded(deps.findOpById(billingOperationId), ms, 'load');
      if (!op || !isHelperRow(op)) return { notHeld: op ? 'not an image-credits row' : 'no such operation' };
      const hold = (op.metadata as Record<string, unknown>)?.hold as HoldHandle | undefined;
      if (op.status !== 'held' || !hold?.holdTransactionId) return { notHeld: `status ${op.status}` };
      return { op, hold };
    } catch (err) {
      return { unavailable: err instanceof Error ? err.message : String(err) };
    }
  }

  async function settleImageCredits(input: { billingOperationId: string }): Promise<SettleImageCreditsResult> {
    const loaded = await loadHeld(input.billingOperationId);
    if ('unavailable' in loaded) return { ok: false, reason: 'unavailable', detail: loaded.unavailable };
    if ('notHeld' in loaded) return { ok: false, reason: 'not_held', detail: loaded.notHeld };
    const { op, hold } = loaded;
    try {
      const r = await bounded(deps.confirm({ ...hold, note: 'image delivered' }), ms, 'confirm');
      // A charge is recorded ONLY for a status named here (05, BLOCKING): any
      // other answer - released, refused, unknown - touches nothing and leaves
      // the row 'held' for reconciliation. Never charge by default.
      let charged: number;
      if (r.status === 'confirmed') charged = Number(r.creditsCharged ?? hold.creditsReserved);
      else if (r.status === 'already_confirmed') charged = hold.creditsReserved;
      else if (r.status === 'already_released' || r.status === 'released') {
        return { ok: false, reason: 'not_held', detail: `reservation was released (${r.status})` };
      } else {
        logger.error('image_credits_confirm_unexpected_status', { opId: op.id, status: r.status });
        return { ok: false, reason: 'unavailable', detail: `confirm answered '${r.status}'; nothing recorded` };
      }
      const moved = await bounded(deps.closeOp(op.id, {
        status: 'confirmed', amountCharged: charged, reservationTxnId: hold.holdTransactionId,
        confirmTxnId: r.confirmTransactionId ?? undefined, metadata: op.metadata ?? {},
      }, ['held']), ms, 'mark-confirmed');
      if (moved.error) return { ok: false, reason: 'unavailable', detail: moved.error };
      if (moved.updated !== 1) return { ok: false, reason: 'not_held', detail: 'the held row changed underneath' };
      return { ok: true, creditsCharged: charged };
    } catch (err) {
      return { ok: false, reason: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async function releaseImageCredits(input: { billingOperationId: string; reason: string }): Promise<ReleaseImageCreditsResult> {
    let op: OpRow | null;
    try {
      op = await bounded(deps.findOpById(input.billingOperationId), ms, 'load');
    } catch (err) {
      return { ok: false, reason: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
    }
    if (!op || !isHelperRow(op)) return { ok: false, reason: 'not_held', detail: op ? 'not an image-credits row' : 'no such operation' };
    if (op.status === 'released') return { ok: true };                   // idempotent
    if (op.status !== 'held') return { ok: false, reason: 'not_held', detail: `status ${op.status}` }; // never un-confirm
    const hold = (op.metadata as Record<string, unknown>)?.hold as HoldHandle | undefined;
    if (!hold?.holdTransactionId) return { ok: false, reason: 'not_held', detail: 'no hold recorded' };
    try {
      const r = await bounded(deps.release({ ...hold, note: `image not delivered: ${input.reason}` }), ms, 'release');
      if (r.status === 'already_confirmed') {
        logger.error('image_credits_release_after_confirm', { opId: op.id });
        return { ok: false, reason: 'not_held', detail: 'reservation was already confirmed' };
      }
      if (r.status !== 'released' && r.status !== 'already_released') {
        logger.error('image_credits_release_unexpected_status', { opId: op.id, status: r.status });
        return { ok: false, reason: 'unavailable', detail: `release answered '${r.status}'; nothing recorded` };
      }
      const moved = await bounded(deps.closeOp(op.id, {
        status: 'released', reservationTxnId: hold.holdTransactionId,
        releaseTxnId: r.releaseTransactionId ?? undefined, failureReason: input.reason, metadata: op.metadata ?? {},
      }, ['held']), ms, 'mark-released');
      if (moved.error) return { ok: false, reason: 'unavailable', detail: moved.error };
      if (moved.updated !== 1) {
        // The credits ARE released; the lineage row did not move (it changed
        // underneath). Report it rather than claim a clean release.
        logger.error('image_credits_release_lineage_not_moved', { opId: op.id, updated: moved.updated });
        return { ok: false, reason: 'not_held', detail: 'the held row changed underneath' };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: 'unavailable', detail: err instanceof Error ? err.message : String(err) };
    }
  }

  return { reserveImageCredits, settleImageCredits, releaseImageCredits };
}

// ── Production wiring (lazy imports: no DB client at import time) ──────────────
async function db() { return (await import('../../db/supabaseClient')).supabase; }
const OP_COLUMNS = 'id, status, organization_id, idempotency_key, metadata';

export const productionImageCreditsDeps: ImageCreditsDeps = {
  resolveFeatureActionKey: (action) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveMonetizationFeature } = require('../../../shared/monetization/featureRegistry');
    return resolveMonetizationFeature({ action_key: action })?.action_key ?? null;
  },
  bounds: () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ACTIVITY_CLASS_ECONOMICS } = require('../activityEconomyCatalog');
    const e = ACTIVITY_CLASS_ECONOMICS.IMAGE_GENERATION;
    return { min: e.minimumCredits, max: e.maximumCredits };
  },
  price: async (i) => {
    const { resolveVendorUnitCost } = await import('../pricingService');
    const r = await resolveVendorUnitCost(i);
    return { credits: r.credits, snapshot: r.pricing_snapshot };
  },
  isPricingMissing: (err) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PricingMissingError } = require('../pricingService');
    return err instanceof PricingMissingError || /Missing action_pricing_config row/.test(String((err as Error)?.message ?? ''));
  },
  findOpByKey: async (key) => {
    const { data, error } = await (await db()).from('billing_operations').select(OP_COLUMNS).eq('idempotency_key', key).limit(1);
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error('no answer from billing_operations');
    return (data[0] as OpRow | undefined) ?? null;
  },
  findOpById: async (id) => {
    const { data, error } = await (await db()).from('billing_operations').select(OP_COLUMNS).eq('id', id).limit(1);
    if (error) throw new Error(error.message);
    if (!Array.isArray(data)) throw new Error('no answer from billing_operations');
    return (data[0] as OpRow | undefined) ?? null;
  },
  openOp: async (a) => {
    const { openBillingOperation } = await import('./enterpriseBillingOrchestrator');
    return openBillingOperation({
      correlationId: a.correlationId, module: MODULE, action: IMAGE_CREDIT_ACTION,
      organizationId: a.organizationId, actorUserId: a.actorUserId as string,
      idempotencyKey: a.idempotencyKey, amountEstimated: a.amountEstimated, metadata: a.metadata,
    });
  },
  closeOp: async (id, patch, fromStatuses) => {
    const { closeBillingOperation } = await import('./enterpriseBillingOrchestrator');
    return closeBillingOperation(id, patch as Parameters<typeof closeBillingOperation>[1], { fromStatuses });
  },
  reserve: async (opts) => (await import('../creditExecutionServiceContracts')).reserveCreditsForWork(opts as never) as never,
  confirm: async (h) => (await import('../creditExecutionServiceContracts')).confirmCreditReservation(h as never) as never,
  release: async (h) => (await import('../creditExecutionServiceContracts')).releaseCreditReservation(h as never) as never,
};

export const { reserveImageCredits, settleImageCredits, releaseImageCredits } = makeImageCredits(productionImageCreditsDeps);
