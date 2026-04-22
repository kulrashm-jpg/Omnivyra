const CONVERSION_EVENT_MAP: Record<string, true> = {
  form_submit: true,
  generate_lead: true,
  purchase: true,
  signup: true,
};

export function isConversionEvent(eventName: string | null | undefined): boolean {
  const normalized = String(eventName ?? '').trim().toLowerCase();
  return Boolean(normalized && CONVERSION_EVENT_MAP[normalized]);
}

export function getConversionRegistry(): Record<string, true> {
  return { ...CONVERSION_EVENT_MAP };
}
