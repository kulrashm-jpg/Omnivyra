/**
 * WS-3 Milestone-5B — default transport registration.
 *
 * The ONE place that decides which channels are dispatchable. A channel absent
 * from here has no transport, and the dispatcher skips it — which is how
 * WhatsApp, SMS, LinkedIn, voice, push and Slack remain undispatchable without
 * the dispatcher knowing they exist.
 *
 * Registration is explicit and caller-driven rather than an import side effect,
 * so a module import can never silently make a channel sendable.
 */

import { createEmailTransport, type EmailProviderPort } from './emailTransport';
import { internalTransport } from './internalTransport';
import { registerTransport } from './transport';

/**
 * Register the transports this milestone ships.
 *
 * Internal is always registered — it contacts nobody. Email is registered too,
 * but the email transport is itself flag-gated and returns `disabled` without
 * calling a provider unless `LEAD_OUTREACH_EMAIL_ENABLED=true`. Registration
 * therefore makes the channel *routable*, not *live*.
 */
export function registerDefaultTransports(options: { emailProvider?: EmailProviderPort } = {}): void {
  registerTransport(internalTransport);
  registerTransport(createEmailTransport(options.emailProvider));
}
