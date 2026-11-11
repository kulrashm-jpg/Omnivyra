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
import { registerTransport, type TransportRequest } from './transport';
import { assertRenderedEmailApproved } from './approvalBinding';
import { emailContentHook, emailContentEvidenceHook } from '../emailEngine/emailSendPath';

/**
 * PI-041-A-E — the email composition. The registry is one process-global map, last
 * registration wins, so every application caller must choose `engine` (a test pins
 * this). `engine` renders the authored step and records it before the provider, and
 * fails closed for a task with no 040 handoff. `placeholder` derives text from the
 * task's action and exists only for the WS-3 certification harnesses, whose fixtures
 * have no handoff; unlike the parked original it stays the default so they run
 * unchanged.
 */
export type EmailComposition = 'engine' | 'placeholder';

/**
 * Register the transports this milestone ships.
 *
 * Internal is always registered — it contacts nobody. Email is registered too,
 * but the email transport is itself flag-gated and returns `disabled` without
 * calling a provider unless `LEAD_OUTREACH_EMAIL_ENABLED=true`. Registration
 * therefore makes the channel *routable*, not *live*.
 */
export function registerDefaultTransports(
  options: { email?: EmailComposition; emailProvider?: EmailProviderPort } = {},
): void {
  registerTransport(internalTransport);
  registerTransport(options.email === 'engine'
    ? createEmailTransport(options.emailProvider, {
      content: approvedContent(emailContentHook()),
      recordContent: emailContentEvidenceHook(),
    })
    : createEmailTransport(options.emailProvider));
}

/**
 * D-02 (S-03) — the engine render, then the approval binding recomputed over exactly those
 * strings and the address the transport is about to use. A mismatch throws, which the
 * transport reports as `content_unavailable` with no evidence row and no provider call.
 */
function approvedContent(render: ReturnType<typeof emailContentHook>) {
  return async (request: TransportRequest) => {
    const rendered = await render(request);
    await assertRenderedEmailApproved(request.task.companyId, request.task, rendered, request.recipient);
    return rendered;
  };
}
