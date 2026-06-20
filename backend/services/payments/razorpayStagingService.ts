import crypto from 'crypto';
import { ownedDbTable } from '../../db/writeOwner';
import { completePurchase, failPurchase, recordPaymentProviderEvent } from '../purchaseService';
import {
  assertMonetizationExposureModeConfigured,
  assertMonetizationOperationAllowed,
  getMonetizationControlMode,
  recordMonetizationOperationalEvent,
} from '../monetizationOpsService';
import { assertMonetizationBetaAccess, getMonetizationBetaRuntimeMode, getOrganizationBetaTag } from '../monetizationBetaAccessService';
import { getFxConfig } from '../pricingConfigService';
import { resolvePrice } from '@/lib/billing/currency';

const PROVIDER = 'razorpay';
const PROVIDER_MODE = 'test';
const RAZORPAY_API_BASE = 'https://api.razorpay.com/v1';

export type RazorpayWebhookOutcome =
  | { status: 'processed'; purchaseId: string; paymentId: string; creditsGranted: number; duplicateEvent: boolean }
  | { status: 'duplicate'; eventId: string }
  | { status: 'ignored'; reason: string; eventId: string }
  | { status: 'failed'; reason: string; eventId?: string; purchaseId?: string };

export type RazorpayPaymentVerificationOutcome =
  | { status: 'processed'; purchaseId: string; paymentId: string; creditsGranted: number; duplicateEvent: boolean }
  | { status: 'failed'; reason: string; purchaseId?: string; paymentId?: string };

export type RazorpayReplayOutcome =
  | { status: 'dry_run'; eventId: string; wouldProcess: boolean; reason?: string; purchaseId?: string | null }
  | RazorpayWebhookOutcome;

export interface RazorpayOrderIntent {
  purchaseId: string;
  organizationId: string;
  packageId: string | null;
  credits: number;
  amount: number;
  amountSubunits: number;
  currency: string;
  providerOrderId: string;
  keyId: string;
}

type RazorpayPaymentEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  notes?: Record<string, unknown> | null;
};

type RazorpayWebhookPayload = {
  id?: string;
  event?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: RazorpayPaymentEntity };
    order?: { entity?: Record<string, unknown> };
  };
};

function requireStagingEnabled(): void {
  assertMonetizationExposureModeConfigured();
  if (process.env.RAZORPAY_STAGING_ENABLED !== 'true') {
    throw new Error('Razorpay staging is disabled. Set RAZORPAY_STAGING_ENABLED=true in a non-production environment.');
  }
  if (process.env.NODE_ENV === 'production' && process.env.RAZORPAY_ALLOW_PRODUCTION_STAGING !== 'true') {
    throw new Error('Razorpay staging endpoints are disabled in production.');
  }
  const mode = getMonetizationControlMode();
  if (mode.globalKillSwitch) throw new Error('monetization_global_kill_switch_enabled');
}

function getKeyId(): string {
  const value = process.env.RAZORPAY_TEST_KEY_ID;
  if (!value) throw new Error('Missing RAZORPAY_TEST_KEY_ID');
  if (value.startsWith('rzp_live_')) throw new Error('Live Razorpay key is not allowed in staging foundation');
  return value;
}

function getKeySecret(): string {
  const value = process.env.RAZORPAY_TEST_KEY_SECRET;
  if (!value) throw new Error('Missing RAZORPAY_TEST_KEY_SECRET');
  return value;
}

function getWebhookSecret(): string {
  const value = process.env.RAZORPAY_TEST_WEBHOOK_SECRET;
  if (!value) throw new Error('Missing RAZORPAY_TEST_WEBHOOK_SECRET');
  return value;
}

function toSubunits(amount: number, currency: string): number {
  const upper = currency.toUpperCase();
  if (upper === 'JPY') return Math.round(amount);
  return Math.round(amount * 100);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', getWebhookSecret())
    .update(rawBody)
    .digest('hex');
  return timingSafeEqualHex(expected, signature);
}

export function verifyRazorpayPaymentSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const expected = crypto
    .createHmac('sha256', getKeySecret())
    .update(`${input.orderId}|${input.paymentId}`)
    .digest('hex');
  return timingSafeEqualHex(expected, input.signature);
}

async function createRazorpayOrder(input: {
  amountSubunits: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}): Promise<{ id: string; raw: Record<string, unknown> }> {
  const keyId = getKeyId();
  const keySecret = getKeySecret();
  const response = await fetch(`${RAZORPAY_API_BASE}/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amountSubunits,
      currency: input.currency,
      receipt: input.receipt,
      notes: input.notes,
      payment_capture: 1,
    }),
  });
  const raw = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`razorpay_order_create_failed:${response.status}:${JSON.stringify(raw)}`);
  }
  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!id) throw new Error('razorpay_order_create_failed:missing_order_id');
  if (id.startsWith('order_live')) throw new Error('Razorpay live order id rejected in staging foundation');
  return { id, raw };
}

async function fetchRazorpayPayment(paymentId: string): Promise<RazorpayPaymentEntity> {
  const keyId = getKeyId();
  const keySecret = getKeySecret();
  const response = await fetch(`${RAZORPAY_API_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
    },
  });
  const raw = await response.json().catch(() => ({})) as RazorpayPaymentEntity & Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`razorpay_payment_fetch_failed:${response.status}:${JSON.stringify(raw)}`);
  }
  return raw;
}

export async function createRazorpayStagingCreditOrder(input: {
  organizationId: string;
  packageId: string;
  requestedBy: string;
}): Promise<RazorpayOrderIntent> {
  requireStagingEnabled();
  assertMonetizationOperationAllowed('order_create');
  const betaAccess = await assertMonetizationBetaAccess({
    organizationId: input.organizationId,
    userId: input.requestedBy,
    surface: 'checkout',
  });

  const { data: pkg, error: pkgErr } = await ownedDbTable('credit_packages')
    .select('id, credits, price, is_active, sku, canonical_usd_price')
    .eq('id', input.packageId)
    .maybeSingle();
  if (pkgErr) throw new Error(`credit_package_lookup_failed:${pkgErr.message}`);
  if (!pkg || (pkg as any).is_active !== true) throw new Error('credit_package_not_available');

  const credits = Number((pkg as any).credits);
  const currency = 'INR';
  // INR charge resolves from the canonical USD price via Super-Admin FX (+ market
  // override). Falls back to the legacy `price` column when canonical is absent.
  const canonicalUsd = (pkg as any).canonical_usd_price;
  let amount = Number((pkg as any).price);
  if (canonicalUsd != null && Number.isFinite(Number(canonicalUsd))) {
    const fx = await getFxConfig();
    amount = resolvePrice(Number(canonicalUsd), 'INR', fx, (pkg as any).sku ?? undefined);
  }
  const amountSubunits = toSubunits(amount, currency);
  if (!Number.isFinite(credits) || credits <= 0) throw new Error('credit_package_invalid_credits');
  if (!Number.isFinite(amountSubunits) || amountSubunits <= 0) throw new Error('credit_package_invalid_amount');

  const { data: purchase, error: purchaseErr } = await ownedDbTable('credit_purchases')
    .insert({
      organization_id: input.organizationId,
      package_id: input.packageId,
      credits,
      amount_paid: amount,
      currency,
      status: 'pending',
      provider: PROVIDER,
      provider_mode: PROVIDER_MODE,
      amount_subunits: amountSubunits,
      fulfillment_status: 'pending',
      beta_cohort: betaAccess.beta_cohort,
      beta_access_level: betaAccess.access_level,
      monetization_beta_enabled: betaAccess.monetization_beta_enabled,
      provider_payload: {
        created_by: input.requestedBy,
        environment: 'staging',
        beta_cohort: betaAccess.beta_cohort,
        beta_access_level: betaAccess.access_level,
      },
    })
    .select('id')
    .single();
  if (purchaseErr || !purchase) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.payment_intent_create_failed',
      severity: 'ERROR',
      organizationId: input.organizationId,
      provider: PROVIDER,
      alertKey: 'payment_intent_create_failed',
      betaCohort: betaAccess.beta_cohort,
      betaAccessLevel: betaAccess.access_level,
      monetizationBetaEnabled: betaAccess.monetization_beta_enabled,
      metadata: { package_id: input.packageId, message: purchaseErr?.message ?? 'missing row' },
    });
    throw new Error(`credit_purchase_intent_create_failed:${purchaseErr?.message ?? 'missing row'}`);
  }

  const purchaseId = String((purchase as any).id);
  const order = await createRazorpayOrder({
    amountSubunits,
    currency,
    receipt: `credit_${purchaseId}`,
    notes: {
      purchase_id: purchaseId,
      organization_id: input.organizationId,
      package_id: input.packageId,
      provider_mode: PROVIDER_MODE,
    },
  });

  const { error: updateErr } = await ownedDbTable('credit_purchases')
    .update({
      provider_order_id: order.id,
      provider_payload: {
        created_by: input.requestedBy,
        environment: 'staging',
        beta_cohort: betaAccess.beta_cohort,
        beta_access_level: betaAccess.access_level,
        razorpay_order: order.raw,
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', purchaseId)
    .eq('status', 'pending');
  if (updateErr) throw new Error(`credit_purchase_order_attach_failed:${updateErr.message}`);
  await recordMonetizationOperationalEvent({
    eventName: 'monetization.razorpay_order_created',
    severity: 'INFO',
    organizationId: input.organizationId,
    provider: PROVIDER,
    providerOrderId: order.id,
    purchaseId,
    fulfillmentStatus: 'pending',
    betaCohort: betaAccess.beta_cohort,
    betaAccessLevel: betaAccess.access_level,
    monetizationBetaEnabled: betaAccess.monetization_beta_enabled,
    metadata: { package_id: input.packageId, credits, amount, currency, amount_subunits: amountSubunits },
  });

  return {
    purchaseId,
    organizationId: input.organizationId,
    packageId: input.packageId,
    credits,
    amount,
    amountSubunits,
    currency,
    providerOrderId: order.id,
    keyId: getKeyId(),
  };
}

async function markProviderEvent(input: {
  eventId: string;
  status: 'processed' | 'duplicate' | 'failed';
  error?: string;
}): Promise<void> {
  await ownedDbTable('payment_provider_events')
    .update({
      processing_status: input.status,
      processed_at: new Date().toISOString(),
      error_message: input.error ?? null,
    })
    .eq('id', input.eventId);
}

async function findPurchaseForPayment(payment: RazorpayPaymentEntity): Promise<any | null> {
  const orderId = payment.order_id;
  if (!orderId) return null;
  const { data } = await ownedDbTable('credit_purchases')
    .select('id, organization_id, credits, amount_paid, currency, status, fulfillment_status, provider_order_id, amount_subunits, provider_mode')
    .eq('provider', PROVIDER)
    .eq('provider_mode', PROVIDER_MODE)
    .eq('provider_order_id', orderId)
    .maybeSingle();
  return data ?? null;
}

function eventIdForPayload(payload: RazorpayWebhookPayload, payment: RazorpayPaymentEntity | null): string {
  if (payload.id) return payload.id;
  if (payload.event && payment?.id) return `${payload.event}:${payment.id}`;
  throw new Error('razorpay_event_missing_id');
}

function isProcessedDuplicate(event: { duplicate: boolean; processingStatus?: string | null }): boolean {
  return event.duplicate && event.processingStatus === 'processed';
}

function isWebhookTooOld(payload: RazorpayWebhookPayload): boolean {
  const maxAgeSeconds = Number(process.env.RAZORPAY_WEBHOOK_MAX_EVENT_AGE_SECONDS ?? 0);
  if (!Number.isFinite(maxAgeSeconds) || maxAgeSeconds <= 0) return false;
  if (!payload.created_at || !Number.isFinite(payload.created_at)) return false;
  const eventMs = payload.created_at * 1000;
  return Date.now() - eventMs > maxAgeSeconds * 1000;
}

async function recordRejectedWebhook(input: {
  rawBody: string;
  reason: string;
  signatureValid: boolean;
  eventType?: string;
}): Promise<void> {
  const hash = crypto.createHash('sha256').update(input.rawBody).digest('hex');
  const event = await recordPaymentProviderEvent({
    provider: PROVIDER,
    providerEventId: `rejected:${input.reason}:${hash}`,
    eventType: input.eventType ?? `rejected.${input.reason}`,
    payload: {
      rejected: true,
      reason: input.reason,
      raw_body_sha256: hash,
      provider_mode: PROVIDER_MODE,
    },
  });
  if (event.id) {
    await ownedDbTable('payment_provider_events')
      .update({
        provider_mode: PROVIDER_MODE,
        signature_valid: input.signatureValid,
        signature_algorithm: 'hmac-sha256',
        processing_status: 'failed',
        processed_at: new Date().toISOString(),
        error_message: input.reason,
      })
      .eq('id', event.id);
  }
  await recordMonetizationOperationalEvent({
    eventName: `monetization.webhook_rejected.${input.reason}`,
    severity: input.signatureValid ? 'WARN' : 'ERROR',
    provider: PROVIDER,
    providerEventId: `rejected:${input.reason}:${hash}`,
    alertKey: `webhook_rejected_${input.reason}`,
    metadata: {
      reason: input.reason,
      signature_valid: input.signatureValid,
      raw_body_sha256: hash,
      event_type: input.eventType ?? null,
    },
  });
}

export async function handleRazorpayStagingWebhook(input: {
  rawBody: string;
  signature: string | null;
}): Promise<RazorpayWebhookOutcome> {
  requireStagingEnabled();
  assertMonetizationOperationAllowed('webhook_process');
  if (!input.signature || !verifyRazorpayWebhookSignature(input.rawBody, input.signature)) {
    await recordRejectedWebhook({
      rawBody: input.rawBody,
      reason: 'invalid_signature',
      signatureValid: false,
    }).catch(() => undefined);
    return { status: 'failed', reason: 'invalid_signature' };
  }

  let payload: RazorpayWebhookPayload;
  try {
    payload = JSON.parse(input.rawBody) as RazorpayWebhookPayload;
  } catch {
    await recordRejectedWebhook({
      rawBody: input.rawBody,
      reason: 'invalid_json',
      signatureValid: true,
    }).catch(() => undefined);
    return { status: 'failed', reason: 'invalid_json' };
  }

  const eventType = payload.event ?? 'unknown';
  if (isWebhookTooOld(payload)) {
    await recordRejectedWebhook({
      rawBody: input.rawBody,
      reason: 'stale_event',
      signatureValid: true,
      eventType,
    }).catch(() => undefined);
    return { status: 'failed', reason: 'stale_event' };
  }
  const payment = payload.payload?.payment?.entity ?? null;
  const providerEventId = eventIdForPayload(payload, payment);
  const paymentId = payment?.id ?? null;
  const orderId = payment?.order_id ?? null;
  const purchase = payment ? await findPurchaseForPayment(payment) : null;
  const betaTag = await getOrganizationBetaTag(purchase?.organization_id ?? null);

  const event = await recordPaymentProviderEvent({
    provider: PROVIDER,
    providerEventId,
    eventType,
    purchaseId: purchase?.id ?? null,
    organizationId: purchase?.organization_id ?? null,
    payload: payload as Record<string, unknown>,
  });

  if (isProcessedDuplicate(event)) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.webhook_duplicate_processed_noop',
      severity: 'WARN',
      organizationId: purchase?.organization_id ?? null,
      provider: PROVIDER,
      providerEventId,
      providerOrderId: orderId,
      paymentId,
      purchaseId: purchase?.id ?? null,
      fulfillmentStatus: purchase?.fulfillment_status ?? null,
      alertKey: 'webhook_duplicate_processed',
      betaCohort: betaTag.beta_cohort,
      betaAccessLevel: betaTag.beta_access_level,
      monetizationBetaEnabled: betaTag.monetization_beta_enabled,
      metadata: { event_type: eventType },
    });
    return { status: 'duplicate', eventId: providerEventId };
  }

  await recordMonetizationOperationalEvent({
    eventName: event.duplicate ? 'monetization.webhook_duplicate_retrying' : 'monetization.webhook_ingested',
    severity: event.duplicate ? 'WARN' : 'INFO',
    organizationId: purchase?.organization_id ?? null,
    provider: PROVIDER,
    providerEventId,
    providerOrderId: orderId,
    paymentId,
    purchaseId: purchase?.id ?? null,
    fulfillmentStatus: purchase?.fulfillment_status ?? null,
    alertKey: event.duplicate ? 'webhook_duplicate_retry' : null,
    betaCohort: betaTag.beta_cohort,
    betaAccessLevel: betaTag.beta_access_level,
    monetizationBetaEnabled: betaTag.monetization_beta_enabled,
    metadata: { event_type: eventType, previous_processing_status: event.processingStatus ?? null },
  });

  await ownedDbTable('payment_provider_events')
    .update({
      provider_mode: PROVIDER_MODE,
      signature_valid: true,
      signature_algorithm: 'hmac-sha256',
      provider_order_id: orderId,
      provider_payment_id: paymentId,
      beta_cohort: betaTag.beta_cohort,
      beta_access_level: betaTag.beta_access_level,
      monetization_beta_enabled: betaTag.monetization_beta_enabled,
    })
    .eq('id', event.id);

  if (eventType !== 'payment.captured') {
    if (event.id) await markProviderEvent({ eventId: event.id, status: 'processed' });
    return { status: 'ignored', reason: `event_not_fulfillable:${eventType}`, eventId: providerEventId };
  }

  if (!payment || !paymentId || !orderId) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.webhook_missing_payment_entity',
      severity: 'ERROR',
      provider: PROVIDER,
      providerEventId,
      alertKey: 'webhook_missing_payment_entity',
      metadata: { event_type: eventType },
    });
    if (event.id) await markProviderEvent({ eventId: event.id, status: 'failed', error: 'missing_payment_entity' });
    return { status: 'failed', reason: 'missing_payment_entity', eventId: providerEventId };
  }
  if (!purchase) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.webhook_purchase_not_found',
      severity: 'ERROR',
      provider: PROVIDER,
      providerEventId,
      providerOrderId: orderId,
      paymentId,
      alertKey: 'webhook_purchase_not_found',
      metadata: { event_type: eventType },
    });
    if (event.id) await markProviderEvent({ eventId: event.id, status: 'failed', error: 'purchase_not_found_for_order' });
    return { status: 'failed', reason: 'purchase_not_found_for_order', eventId: providerEventId };
  }

  const expectedAmount = Number(purchase.amount_subunits ?? toSubunits(Number(purchase.amount_paid), String(purchase.currency)));
  if (Number(payment.amount) !== expectedAmount || String(payment.currency).toUpperCase() !== String(purchase.currency).toUpperCase()) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.payment_amount_currency_mismatch',
      severity: 'CRITICAL',
      organizationId: purchase.organization_id,
      provider: PROVIDER,
      providerEventId,
      providerOrderId: orderId,
      paymentId,
      purchaseId: purchase.id,
      fulfillmentStatus: purchase.fulfillment_status,
      alertKey: 'payment_amount_currency_mismatch',
      betaCohort: betaTag.beta_cohort,
      betaAccessLevel: betaTag.beta_access_level,
      monetizationBetaEnabled: betaTag.monetization_beta_enabled,
      metadata: {
        expected_amount_subunits: expectedAmount,
        actual_amount_subunits: payment.amount ?? null,
        expected_currency: purchase.currency,
        actual_currency: payment.currency ?? null,
      },
    });
    if (event.id) await markProviderEvent({ eventId: event.id, status: 'failed', error: 'amount_or_currency_mismatch' });
    await failPurchase(String(purchase.id), paymentId);
    return { status: 'failed', reason: 'amount_or_currency_mismatch', eventId: providerEventId, purchaseId: String(purchase.id) };
  }

  assertMonetizationOperationAllowed('fulfillment');
  await recordMonetizationOperationalEvent({
    eventName: 'monetization.fulfillment_attempt_started',
    severity: 'INFO',
    organizationId: purchase.organization_id,
    provider: PROVIDER,
    providerEventId,
    providerOrderId: orderId,
    paymentId,
    purchaseId: purchase.id,
    fulfillmentStatus: purchase.fulfillment_status,
    betaCohort: betaTag.beta_cohort,
    betaAccessLevel: betaTag.beta_access_level,
    monetizationBetaEnabled: betaTag.monetization_beta_enabled,
  });
  const result = await completePurchase(String(purchase.id), paymentId);
  if (!result.success) {
    const failure = result as Extract<typeof result, { success: false }>;
    const reason = failure.reason === 'already_failed' ? 'purchase_already_failed' : failure.detail ?? failure.reason;
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.fulfillment_attempt_failed',
      severity: 'ERROR',
      organizationId: purchase.organization_id,
      provider: PROVIDER,
      providerEventId,
      providerOrderId: orderId,
      paymentId,
      purchaseId: purchase.id,
      fulfillmentStatus: purchase.fulfillment_status,
      alertKey: 'fulfillment_failed',
      betaCohort: betaTag.beta_cohort,
      betaAccessLevel: betaTag.beta_access_level,
      monetizationBetaEnabled: betaTag.monetization_beta_enabled,
      metadata: { reason, source: 'webhook' },
    });
    if (event.id) await markProviderEvent({ eventId: event.id, status: 'failed', error: reason });
    return { status: 'failed', reason, eventId: providerEventId, purchaseId: String(purchase.id) };
  }

  await ownedDbTable('credit_purchases')
    .update({
      provider_event_id: providerEventId,
      provider_payment_id: paymentId,
      beta_cohort: betaTag.beta_cohort,
      beta_access_level: betaTag.beta_access_level,
      monetization_beta_enabled: betaTag.monetization_beta_enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', result.purchaseId);

  if (event.id) await markProviderEvent({ eventId: event.id, status: 'processed' });
  await recordMonetizationOperationalEvent({
    eventName: 'monetization.fulfillment_completed',
    severity: 'INFO',
    organizationId: purchase.organization_id,
    provider: PROVIDER,
    providerEventId,
    providerOrderId: orderId,
    paymentId,
    purchaseId: result.purchaseId,
    fulfillmentStatus: 'completed',
    betaCohort: betaTag.beta_cohort,
    betaAccessLevel: betaTag.beta_access_level,
    monetizationBetaEnabled: betaTag.monetization_beta_enabled,
    metadata: { credits_granted: result.creditsGranted, source: 'webhook' },
  });
  return {
    status: 'processed',
    purchaseId: result.purchaseId,
    paymentId,
    creditsGranted: result.creditsGranted,
    duplicateEvent: false,
  };
}

export async function verifyAndFulfillRazorpayStagingPayment(input: {
    orderId: string;
  paymentId: string;
  signature: string;
  expectedOrganizationId?: string | null;
  requestedBy?: string | null;
}): Promise<RazorpayPaymentVerificationOutcome> {
  requireStagingEnabled();
  if (!verifyRazorpayPaymentSignature(input)) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.payment_verify_signature_failed',
      severity: 'ERROR',
      provider: PROVIDER,
      providerOrderId: input.orderId,
      paymentId: input.paymentId,
      alertKey: 'payment_verify_signature_failed',
    });
    return { status: 'failed', reason: 'invalid_payment_signature', paymentId: input.paymentId };
  }

  const payment = await fetchRazorpayPayment(input.paymentId);
  if (payment.order_id !== input.orderId || payment.id !== input.paymentId) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.payment_verify_order_mismatch',
      severity: 'ERROR',
      provider: PROVIDER,
      providerOrderId: input.orderId,
      paymentId: input.paymentId,
      alertKey: 'payment_verify_order_mismatch',
      metadata: { fetched_order_id: payment.order_id ?? null, fetched_payment_id: payment.id ?? null },
    });
    return { status: 'failed', reason: 'payment_order_mismatch', paymentId: input.paymentId };
  }
  if (payment.status !== 'captured') {
    return { status: 'failed', reason: `payment_not_captured:${payment.status ?? 'unknown'}`, paymentId: input.paymentId };
  }

  const purchase = await findPurchaseForPayment(payment);
  if (!purchase) return { status: 'failed', reason: 'purchase_not_found_for_order', paymentId: input.paymentId };
  const betaAccess = await assertMonetizationBetaAccess({
    organizationId: String(purchase.organization_id),
    userId: input.requestedBy ?? null,
    surface: 'payment_verify',
  });
  if (input.expectedOrganizationId && String(purchase.organization_id) !== input.expectedOrganizationId) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.payment_verify_org_mismatch',
      severity: 'CRITICAL',
      organizationId: purchase.organization_id,
      provider: PROVIDER,
      providerOrderId: input.orderId,
      paymentId: input.paymentId,
      purchaseId: purchase.id,
      alertKey: 'payment_verify_org_mismatch',
      betaCohort: betaAccess.beta_cohort,
      betaAccessLevel: betaAccess.access_level,
      monetizationBetaEnabled: betaAccess.monetization_beta_enabled,
      metadata: { expected_organization_id: input.expectedOrganizationId },
    });
    return { status: 'failed', reason: 'organization_mismatch', purchaseId: String(purchase.id), paymentId: input.paymentId };
  }

  const providerEventId = `checkout:${input.paymentId}`;
  const event = await recordPaymentProviderEvent({
    provider: PROVIDER,
    providerEventId,
    eventType: 'checkout.payment.verified',
    purchaseId: purchase.id,
    organizationId: purchase.organization_id,
    payload: {
      provider: PROVIDER,
      provider_mode: PROVIDER_MODE,
      order_id: input.orderId,
      payment_id: input.paymentId,
      payment,
      beta_cohort: betaAccess.beta_cohort,
      beta_access_level: betaAccess.access_level,
    },
  });

  if (!event.duplicate && event.id) {
    await ownedDbTable('payment_provider_events')
      .update({
        provider_mode: PROVIDER_MODE,
        signature_valid: true,
        signature_algorithm: 'hmac-sha256',
        provider_order_id: input.orderId,
        provider_payment_id: input.paymentId,
        beta_cohort: betaAccess.beta_cohort,
        beta_access_level: betaAccess.access_level,
        monetization_beta_enabled: betaAccess.monetization_beta_enabled,
      })
      .eq('id', event.id);
  }

  const expectedAmount = Number(purchase.amount_subunits ?? toSubunits(Number(purchase.amount_paid), String(purchase.currency)));
  if (Number(payment.amount) !== expectedAmount || String(payment.currency).toUpperCase() !== String(purchase.currency).toUpperCase()) {
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.payment_amount_currency_mismatch',
      severity: 'CRITICAL',
      organizationId: purchase.organization_id,
      provider: PROVIDER,
      providerEventId,
      providerOrderId: input.orderId,
      paymentId: input.paymentId,
      purchaseId: purchase.id,
      fulfillmentStatus: purchase.fulfillment_status,
      alertKey: 'payment_amount_currency_mismatch',
      betaCohort: betaAccess.beta_cohort,
      betaAccessLevel: betaAccess.access_level,
      monetizationBetaEnabled: betaAccess.monetization_beta_enabled,
      metadata: {
        expected_amount_subunits: expectedAmount,
        actual_amount_subunits: payment.amount ?? null,
        expected_currency: purchase.currency,
        actual_currency: payment.currency ?? null,
      },
    });
    if (event.id) await markProviderEvent({ eventId: event.id, status: 'failed', error: 'amount_or_currency_mismatch' });
    await failPurchase(String(purchase.id), input.paymentId);
    return { status: 'failed', reason: 'amount_or_currency_mismatch', purchaseId: String(purchase.id), paymentId: input.paymentId };
  }

  assertMonetizationOperationAllowed('fulfillment');
  await recordMonetizationOperationalEvent({
    eventName: 'monetization.fulfillment_attempt_started',
    severity: event.duplicate ? 'WARN' : 'INFO',
    organizationId: purchase.organization_id,
    provider: PROVIDER,
    providerEventId,
    providerOrderId: input.orderId,
    paymentId: input.paymentId,
    purchaseId: purchase.id,
    fulfillmentStatus: purchase.fulfillment_status,
    alertKey: event.duplicate ? 'duplicate_verify_fulfillment_attempt' : null,
    betaCohort: betaAccess.beta_cohort,
    betaAccessLevel: betaAccess.access_level,
    monetizationBetaEnabled: betaAccess.monetization_beta_enabled,
    metadata: { source: 'verify_endpoint', duplicate_event: event.duplicate },
  });
  const result = await completePurchase(String(purchase.id), input.paymentId);
  if (!result.success) {
    const failure = result as Extract<typeof result, { success: false }>;
    const reason = failure.reason === 'already_failed' ? 'purchase_already_failed' : failure.detail ?? failure.reason;
    await recordMonetizationOperationalEvent({
      eventName: 'monetization.fulfillment_attempt_failed',
      severity: 'ERROR',
      organizationId: purchase.organization_id,
      provider: PROVIDER,
      providerEventId,
      providerOrderId: input.orderId,
      paymentId: input.paymentId,
      purchaseId: purchase.id,
      fulfillmentStatus: purchase.fulfillment_status,
      alertKey: 'fulfillment_failed',
      betaCohort: betaAccess.beta_cohort,
      betaAccessLevel: betaAccess.access_level,
      monetizationBetaEnabled: betaAccess.monetization_beta_enabled,
      metadata: { reason, source: 'verify_endpoint' },
    });
    if (event.id) await markProviderEvent({ eventId: event.id, status: 'failed', error: reason });
    return { status: 'failed', reason, purchaseId: String(purchase.id), paymentId: input.paymentId };
  }

  await ownedDbTable('credit_purchases')
    .update({
      provider_event_id: providerEventId,
      provider_payment_id: input.paymentId,
      beta_cohort: betaAccess.beta_cohort,
      beta_access_level: betaAccess.access_level,
      monetization_beta_enabled: betaAccess.monetization_beta_enabled,
      updated_at: new Date().toISOString(),
    })
    .eq('id', result.purchaseId);

  if (!event.duplicate && event.id) await markProviderEvent({ eventId: event.id, status: 'processed' });
  await recordMonetizationOperationalEvent({
    eventName: 'monetization.fulfillment_completed',
    severity: event.duplicate ? 'WARN' : 'INFO',
    organizationId: purchase.organization_id,
    provider: PROVIDER,
    providerEventId,
    providerOrderId: input.orderId,
    paymentId: input.paymentId,
    purchaseId: result.purchaseId,
    fulfillmentStatus: 'completed',
    alertKey: event.duplicate ? 'duplicate_verify_fulfillment_idempotent' : null,
    betaCohort: betaAccess.beta_cohort,
    betaAccessLevel: betaAccess.access_level,
    monetizationBetaEnabled: betaAccess.monetization_beta_enabled,
    metadata: { credits_granted: result.creditsGranted, source: 'verify_endpoint', duplicate_event: event.duplicate },
  });
  return {
    status: 'processed',
    purchaseId: result.purchaseId,
    paymentId: input.paymentId,
    creditsGranted: result.creditsGranted,
    duplicateEvent: event.duplicate,
  };
}

export async function replayRazorpayStagingProviderEvent(input: {
  providerEventRowId: string;
  dryRun?: boolean;
}): Promise<RazorpayReplayOutcome> {
  requireStagingEnabled();
  const betaMode = getMonetizationBetaRuntimeMode();
  if (!input.dryRun && betaMode.externalBetaEnabled && betaMode.betaReplayPaused) {
    throw new Error('monetization_beta_replay_paused');
  }
  if (!input.dryRun) assertMonetizationOperationAllowed('replay');

  const { data: row, error } = await ownedDbTable('payment_provider_events')
    .select('id, provider, provider_event_id, event_type, purchase_id, organization_id, payload, processing_status, provider_order_id, provider_payment_id')
    .eq('id', input.providerEventRowId)
    .maybeSingle();
  if (error || !row) return { status: 'failed', reason: 'provider_event_not_found', eventId: input.providerEventRowId };
  const eventRow = row as any;
  if (eventRow.provider !== PROVIDER) return { status: 'failed', reason: 'provider_event_not_razorpay', eventId: eventRow.provider_event_id };
  if (eventRow.processing_status === 'processed') {
    return { status: 'duplicate', eventId: eventRow.provider_event_id };
  }
  const payload = eventRow.payload as RazorpayWebhookPayload;
  const payment = payload?.payload?.payment?.entity ?? null;
  if (!payload || payload.event !== 'payment.captured' || !payment) {
    return {
      status: input.dryRun ? 'dry_run' : 'ignored',
      eventId: eventRow.provider_event_id,
      ...(input.dryRun
        ? { wouldProcess: false, reason: 'event_not_replay_fulfillable', purchaseId: eventRow.purchase_id ?? null }
        : { reason: 'event_not_replay_fulfillable' }),
    } as RazorpayReplayOutcome;
  }
  if (input.dryRun) {
    return {
      status: 'dry_run',
      eventId: eventRow.provider_event_id,
      wouldProcess: true,
      purchaseId: eventRow.purchase_id ?? null,
    };
  }

  const rawBody = JSON.stringify(payload);
  await recordMonetizationOperationalEvent({
    eventName: 'monetization.provider_event_replay_started',
    severity: 'WARN',
    organizationId: eventRow.organization_id ?? null,
    provider: PROVIDER,
    providerEventId: eventRow.provider_event_id,
    providerOrderId: eventRow.provider_order_id ?? payment.order_id ?? null,
    paymentId: eventRow.provider_payment_id ?? payment.id ?? null,
    purchaseId: eventRow.purchase_id ?? null,
    fulfillmentStatus: eventRow.processing_status ?? null,
    alertKey: 'provider_event_replay',
    metadata: { provider_event_row_id: input.providerEventRowId },
  });
  return handleRazorpayStagingWebhook({
    rawBody,
    signature: crypto.createHmac('sha256', getWebhookSecret()).update(rawBody).digest('hex'),
  });
}
