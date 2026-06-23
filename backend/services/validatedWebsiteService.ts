/**
 * validatedWebsiteService.ts
 *
 * Single source for resolving the company website that was validated ONCE at
 * signup (by validateCompanyIdentity) and persisted on the signup intent.
 *
 * Both onboarding (display) and setup-company (persistence) consume THIS
 * function, so the website shown to the user and the website stored on the
 * company are guaranteed identical for a given user. No domain validation,
 * existence probe, canonical check, or forwarding check happens here — those
 * are settled at signup.
 */

import { supabase } from '../db/supabaseClient';
import { extractDomain, isFreeEmailDomain } from './companyMatchService';

/** Pure email→website derivation (no I/O): `https://www.<domain>` for work emails. */
export function deriveWebsiteFromEmail(email: string | null | undefined): string | null {
  const domain = extractDomain(email ?? '');
  if (!domain || isFreeEmailDomain(domain)) return null;
  return `https://www.${domain}`;
}

/** Read the website validated at signup from the user's most-recent signup intent. */
export async function fetchValidatedWebsiteFromIntent(email: string): Promise<string | null> {
  const { data } = await supabase
    .from('signup_intents')
    .select('intent_data')
    .eq('email', email.toLowerCase().trim())
    .order('expires_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const url = (data as { intent_data?: { validated_website_url?: unknown } } | null)
    ?.intent_data?.validated_website_url;
  return typeof url === 'string' && url.trim() ? url.trim() : null;
}

export type ValidatedWebsiteSource = 'validated_identity' | 'email_derived' | 'user_input';

/**
 * Resolve the canonical website by CONSUMING the signup-validated identity.
 * Precedence: signup intent → pure email-derived → user-entered. Never throws,
 * never probes; the intent-read failure path degrades to the derived value so
 * company creation is never blocked.
 */
export async function resolveValidatedWebsite(
  email: string | null | undefined,
  fallbacks: { emailDerived: string | null; userEntered: string },
  deps: { fetchIntentWebsite?: (email: string) => Promise<string | null> } = {},
): Promise<{ canonicalWebsite: string; source: ValidatedWebsiteSource }> {
  const fetchIntentWebsite = deps.fetchIntentWebsite ?? fetchValidatedWebsiteFromIntent;
  if (email) {
    const validated = await fetchIntentWebsite(email).catch(() => null);
    if (validated) return { canonicalWebsite: validated, source: 'validated_identity' };
  }
  if (fallbacks.emailDerived) return { canonicalWebsite: fallbacks.emailDerived, source: 'email_derived' };
  return { canonicalWebsite: fallbacks.userEntered.trim(), source: 'user_input' };
}
