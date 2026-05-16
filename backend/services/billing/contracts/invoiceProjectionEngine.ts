/**
 * Invoice Projection Engine — Phase 3 F
 *
 * Combines:
 *   1. Enterprise contract context (resolveActiveContract)
 *   2. Period usage observed-to-date (credit_transactions CONFIRM rows)
 *   3. Period usage forecast (usageForecastingService)
 *   4. Per-action custom pricing from contract.custom_action_pricing
 *
 * Produces a forward-looking invoice projection that finance can preview
 * BEFORE the period closes. Distinct from `invoicePreparationService` which
 * writes a draft invoice row at period-end.
 *
 * Tax: still 0 until Stripe Tax / Avalara integration lands (Sprint 6+).
 */

import { resolveActiveContract, type ActiveContract } from './enterpriseContractResolver';
import { forecastUsage } from './usageForecastingService';
import { takeUsageSnapshot } from '../payments/usageAggregationService';
import { logger } from '../../logger';

export interface InvoiceProjectionLine {
  description:        string;
  actionKey:          string;
  observedCredits:    number;
  projectedCredits:   number;
  observedUsd:        number;
  projectedUsd:       number;
  appliedRateUsd:     number;
  isOverage:          boolean;
  isContractCovered:  boolean;
}

export interface InvoiceProjection {
  organizationId:        string;
  periodStart:           string;
  periodEnd:             string;
  currency:              string;
  contract:              { id: string; number: string; status: 'active' | 'none'; allotment: number } | null;
  observedSubtotalUsd:   number;
  projectedSubtotalUsd:  number;
  taxAmountUsd:          number;   // 0 until tax engine ships
  projectedTotalUsd:     number;
  lineItems:             InvoiceProjectionLine[];
  warnings:              string[];
}

export async function projectInvoice(args: {
  organizationId: string;
  periodStart:    string;
  periodEnd:      string;
}): Promise<InvoiceProjection> {
  const warnings: string[] = [];

  // 1. Pull observed usage via the snapshot service. This is idempotent —
  // if the period is already snapshotted, we use the existing rollup; else
  // it's computed (and persisted) on-the-fly.
  const snap = await takeUsageSnapshot({
    organizationId: args.organizationId,
    periodStart:    args.periodStart,
    periodEnd:      args.periodEnd,
  });
  if (!snap.ok) {
    warnings.push(`usage_snapshot_failed: ${snap.error ?? 'unknown'}`);
  }

  // 2. Forecast remaining usage in the period.
  const forecast = await forecastUsage({
    organizationId: args.organizationId,
    periodStart:    args.periodStart,
    periodEnd:      args.periodEnd,
  });
  if (!forecast) {
    warnings.push('forecast_unavailable');
  }

  // 3. Resolve active contract for overage rules + custom pricing.
  const contract = await resolveActiveContract(args.organizationId, args.periodStart.slice(0, 10));
  const allotment = contract?.totalCreditAllotment ?? 0;

  // 4. Build line items per action group, applying contract overrides.
  const lineItems: InvoiceProjectionLine[] = [];
  const observedByAction = snap.byAction ?? {};
  let observedSubtotalUsd = 0;
  let projectedSubtotalUsd = 0;

  // The forecast doesn't break down by action — assume the same distribution
  // as observed so far when projecting.
  let totalObservedCredits = 0;
  for (const v of Object.values(observedByAction)) totalObservedCredits += v.credits;

  for (const [actionKey, observed] of Object.entries(observedByAction)) {
    const share = totalObservedCredits > 0 ? observed.credits / totalObservedCredits : 0;
    const projectedCredits = forecast
      ? Math.round(observed.credits + share * (forecast.projectedCredits - forecast.observedCredits))
      : observed.credits;
    const projectedUsd = forecast
      ? observed.usd + share * (forecast.projectedUsd - forecast.observedUsd)
      : observed.usd;

    const overrideUsd = contract?.customActionPricing?.[actionKey];
    const appliedRateUsd = typeof overrideUsd === 'number' && Number.isFinite(overrideUsd)
      ? overrideUsd
      : (observed.credits > 0 ? observed.usd / observed.credits : 0);

    const observedAmount = observed.credits * appliedRateUsd;
    const projectedAmount = projectedCredits * appliedRateUsd;

    const isOverage = allotment > 0 && projectedCredits > Math.max(0, allotment);

    lineItems.push({
      description:       `Usage: ${actionKey}`,
      actionKey,
      observedCredits:   observed.credits,
      projectedCredits,
      observedUsd:       observedAmount,
      projectedUsd:      projectedAmount,
      appliedRateUsd,
      isOverage,
      isContractCovered: !!contract && !isOverage,
    });
    observedSubtotalUsd  += observedAmount;
    projectedSubtotalUsd += projectedAmount;
  }

  // 5. Overage adjustment line: if projection exceeds contract allotment
  // AND a separate overage rate is set, apply it to the overage portion.
  if (contract && contract.creditOverageRateUsd && allotment > 0) {
    const totalProjectedCredits = lineItems.reduce((a, l) => a + l.projectedCredits, 0);
    const overageCredits = Math.max(0, totalProjectedCredits - allotment);
    if (overageCredits > 0) {
      const overageUsd = overageCredits * contract.creditOverageRateUsd;
      // Subtract the in-allotment value already counted on the lines.
      const inAllotmentCredits = totalProjectedCredits - overageCredits;
      const inAllotmentShare = totalProjectedCredits > 0 ? inAllotmentCredits / totalProjectedCredits : 0;
      const inAllotmentValue = lineItems.reduce((a, l) => a + l.projectedUsd * inAllotmentShare, 0);
      projectedSubtotalUsd = inAllotmentValue + overageUsd;
      lineItems.push({
        description:       `Overage: ${overageCredits} credits above contract allotment (${allotment})`,
        actionKey:         '__overage__',
        observedCredits:   0,
        projectedCredits:  overageCredits,
        observedUsd:       0,
        projectedUsd:      overageUsd,
        appliedRateUsd:    contract.creditOverageRateUsd,
        isOverage:         true,
        isContractCovered: false,
      });
    }
  }

  const projection: InvoiceProjection = {
    organizationId:       args.organizationId,
    periodStart:          args.periodStart,
    periodEnd:            args.periodEnd,
    currency:             contract?.currency ?? 'USD',
    contract: contract
      ? { id: contract.id, number: contract.contractNumber, status: 'active', allotment }
      : { id: '', number: '', status: 'none', allotment: 0 },
    observedSubtotalUsd,
    projectedSubtotalUsd,
    taxAmountUsd:         0,
    projectedTotalUsd:    projectedSubtotalUsd,
    lineItems,
    warnings,
  };

  logger.info('invoice_projection_built', {
    org: args.organizationId,
    lines: lineItems.length,
    projected: projectedSubtotalUsd,
    contract: contract?.contractNumber ?? 'none',
  });

  return projection;
}
