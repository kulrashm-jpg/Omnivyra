/**
 * What one vendor call consumes in the VENDOR's own billing unit, per subject.
 * Declared per vendor so the price (mode B), the attempt ledger's
 * provider_cost_units and the tenant's usage page all agree on one number.
 * Apollo: 1 credit per person match, 1 credit per organization enrich.
 * Pure: no imports, so any layer can read it.
 */
export const VENDOR_UNITS: Readonly<Record<string, { unit: string; perCall: Readonly<Record<'person' | 'account', number>> }>> = Object.freeze({
  apollo: { unit: 'credit', perCall: { person: 1, account: 1 } },
});

export function unitsForCall(providerId: string, subject: 'person' | 'account' | undefined): { unit: string; units: number } | null {
  const v = VENDOR_UNITS[providerId];
  if (!v || !subject) return null;
  return { unit: v.unit, units: v.perCall[subject] };
}
