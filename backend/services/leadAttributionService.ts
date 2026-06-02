import { ownedDbTable } from '../db/writeOwner';

export type AttributionPayload = {
  website_id?: string | null;
  visitor_session_id?: string | null;
  anonymous_id?: string | null;
  session_id?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_term?: string | null;
  referrer?: string | null;
  landing_page?: string | null;
  current_page?: string | null;
  // Creator-side identifiers, carried from the omn_* link params. Optional;
  // legacy/non-creator traffic leaves these null and every flow is unchanged.
  asset_id?: string | null;
  variant_id?: string | null;
  creator_strategy_id?: string | null;
  first_touch?: Record<string, unknown> | null;
  last_touch?: Record<string, unknown> | null;
  consent_state?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function extractAttributionPayload(body: Record<string, unknown>): AttributionPayload {
  const attribution =
    body.attribution && typeof body.attribution === 'object'
      ? body.attribution as Record<string, unknown>
      : {};
  const get = (key: string) =>
    body[key] != null ? String(body[key]) : attribution[key] != null ? String(attribution[key]) : null;
  // Accept either the omn_* link-param form (as it arrives on the URL/tracker)
  // or the canonical column name (asset_id / variant_id / creator_strategy_id).
  const getEither = (omnKey: string, canonicalKey: string) =>
    get(omnKey) ?? get(canonicalKey);

  return {
    website_id: get('website_id'),
    visitor_session_id: get('visitor_session_id'),
    anonymous_id: get('anonymous_id'),
    session_id: get('session_id'),
    utm_source: get('utm_source'),
    utm_medium: get('utm_medium'),
    utm_campaign: get('utm_campaign'),
    utm_content: get('utm_content'),
    utm_term: get('utm_term'),
    referrer: get('referrer'),
    landing_page: get('landing_page'),
    current_page: get('current_page'),
    asset_id: getEither('omn_asset_id', 'asset_id'),
    variant_id: getEither('omn_variant_id', 'variant_id'),
    creator_strategy_id: getEither('omn_strategy_id', 'creator_strategy_id'),
    first_touch: objectOrNull(attribution.first_touch),
    last_touch: objectOrNull(attribution.last_touch),
    consent_state: get('consent_state'),
    metadata: objectOrNull(attribution.metadata),
  };
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function buildTouchSnapshot(input: AttributionPayload): Record<string, unknown> {
  return {
    utm_source: input.utm_source ?? null,
    utm_medium: input.utm_medium ?? null,
    utm_campaign: input.utm_campaign ?? null,
    utm_content: input.utm_content ?? null,
    utm_term: input.utm_term ?? null,
    referrer: input.referrer ?? null,
    landing_page: input.landing_page ?? null,
    current_page: input.current_page ?? null,
    asset_id: input.asset_id ?? null,
    variant_id: input.variant_id ?? null,
    creator_strategy_id: input.creator_strategy_id ?? null,
    anonymous_id: input.anonymous_id ?? null,
    session_id: input.session_id ?? input.visitor_session_id ?? null,
  };
}

export async function ensureVisitorSession(input: {
  companyId?: string | null;
  websiteId?: string | null;
  unifiedPersonId?: string | null;
  attribution: AttributionPayload;
}): Promise<string | null> {
  if (input.attribution.visitor_session_id) return input.attribution.visitor_session_id;
  const anonymousId = input.attribution.anonymous_id || input.attribution.session_id;
  if (!anonymousId) return null;

  const lastTouch = input.attribution.last_touch ?? buildTouchSnapshot(input.attribution);
  const firstTouch = input.attribution.first_touch ?? lastTouch;

  const { data, error } = await ownedDbTable('visitor_sessions')
    .insert({
      company_id: input.companyId ?? null,
      website_id: input.websiteId ?? null,
      anonymous_id: anonymousId,
      unified_person_id: input.unifiedPersonId ?? null,
      first_landing_page: input.attribution.landing_page ?? input.attribution.current_page ?? null,
      last_current_page: input.attribution.current_page ?? null,
      first_referrer: input.attribution.referrer ?? null,
      last_referrer: input.attribution.referrer ?? null,
      utm_source: input.attribution.utm_source ?? null,
      utm_medium: input.attribution.utm_medium ?? null,
      utm_campaign: input.attribution.utm_campaign ?? null,
      utm_content: input.attribution.utm_content ?? null,
      utm_term: input.attribution.utm_term ?? null,
      first_touch: firstTouch,
      last_touch: lastTouch,
      consent_state: input.attribution.consent_state ?? null,
      metadata: input.attribution.metadata ?? {},
    })
    .select('id')
    .single();

  if (error) return null;
  return (data as { id: string }).id;
}

export async function recordLeadAttribution(input: {
  companyId: string;
  leadId: string;
  formId?: string | null;
  websiteId?: string | null;
  visitorSessionId?: string | null;
  source?: string | null;
  attribution: AttributionPayload;
}): Promise<void> {
  const touch = buildTouchSnapshot(input.attribution);
  try {
    await ownedDbTable('lead_attributions').insert({
      lead_id: input.leadId,
      company_id: input.companyId,
      website_id: input.websiteId ?? null,
      visitor_session_id: input.visitorSessionId ?? null,
      attribution_model: 'capture_snapshot',
      first_touch: input.attribution.first_touch ?? touch,
      last_touch: input.attribution.last_touch ?? touch,
      utm_source: input.attribution.utm_source ?? null,
      utm_medium: input.attribution.utm_medium ?? null,
      utm_campaign: input.attribution.utm_campaign ?? null,
      utm_content: input.attribution.utm_content ?? null,
      utm_term: input.attribution.utm_term ?? null,
      referrer: input.attribution.referrer ?? null,
      landing_page: input.attribution.landing_page ?? null,
      current_page: input.attribution.current_page ?? null,
      asset_id: input.attribution.asset_id ?? null,
      variant_id: input.attribution.variant_id ?? null,
      creator_strategy_id: input.attribution.creator_strategy_id ?? null,
      consent_state: input.attribution.consent_state ?? null,
    });
  } catch {
    // Attribution capture is best-effort and must not block lead creation.
  }

  try {
    await ownedDbTable('form_conversions').insert({
      company_id: input.companyId,
      website_id: input.websiteId ?? null,
      form_id: input.formId ?? null,
      lead_id: input.leadId,
      visitor_session_id: input.visitorSessionId ?? null,
      conversion_name: 'lead_form_submit',
      source: input.source ?? 'form',
      metadata: { attribution: touch },
    });
  } catch {
    // Conversion snapshots are best-effort until analytics ingestion is workerized.
  }
}
