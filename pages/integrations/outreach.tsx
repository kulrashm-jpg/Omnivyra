import React from 'react';
import Link from 'next/link';
import IntegrationHubNav from '../../components/integrations/IntegrationHubNav';

/**
 * PHASE 1 — Engagement & Outreach, a configuration HOME that currently has
 * nothing to configure, and says so.
 *
 * ─── WHY THIS PAGE EXISTS AT ALL IF IT CONFIGURES NOTHING ─────────────────
 * Because the alternative was a nav item labelled "Planned" that denied the
 * existence of a transport layer which does exist. The honest answer to "where
 * do I configure outreach?" is "here, and here is exactly how far it goes" —
 * which an operator can act on. A page that states a true blocker is a
 * destination; an empty one is not.
 *
 * ─── NOTHING IS ENABLED, AND NOTHING COULD BE FROM HERE ───────────────────
 * This file imports no transport, touches no registry and sends no request.
 * `transportRegistry` is unchanged: registration there is explicit and
 * caller-driven precisely so that no module import can make a channel sendable,
 * and nothing on this page attempts it.
 *
 * ─── THE DISTINCTION THIS PAGE IS BUILT ON ────────────────────────────────
 * Outreach CONFIGURATION is not transport EXECUTION. Email has a transport and
 * is routable; it is not operational, because the activation path registers it
 * with no provider and a feature flag keeps it disabled. Both halves are stated
 * rather than averaged into one misleading word.
 *
 * ─── EMAIL CONFIGURATION IS PHASE 5, NOT PHASE 1 ──────────────────────────
 * Owner decision O-4 froze the target as a tenant-owned sending domain and
 * sender identity: Company Admin → sending domain → DNS verification → SES
 * verification → verified sender identity. None of it is implemented, and this
 * page implements none of it. It names the gap so the gap is visible.
 *
 * WhatsApp is listed because it genuinely exists as its own product — and
 * listed as NOT an outreach transport, because it is deliberately absent from
 * the transport registry. Conflating the two would make the page claim a
 * delivery channel the dispatcher cannot use.
 */

type ChannelState = 'operational' | 'not_operational' | 'separate_product' | 'future';

interface ChannelRow {
  readonly name: string;
  readonly state: ChannelState;
  readonly transport: string;
  readonly note: string;
  readonly href?: string;
  readonly hrefLabel?: string;
}

const STATE_STYLE: Record<ChannelState, { label: string; className: string }> = {
  operational: { label: 'Operational', className: 'bg-emerald-100 text-emerald-800' },
  not_operational: { label: 'Not operational', className: 'bg-amber-100 text-amber-800' },
  separate_product: { label: 'Separate product', className: 'bg-indigo-100 text-indigo-800' },
  future: { label: 'Future', className: 'bg-gray-100 text-gray-600' },
};

const CHANNELS: readonly ChannelRow[] = Object.freeze([
  {
    name: 'Email',
    state: 'not_operational',
    transport: 'Transport exists',
    note: 'A transport is registered and routable, but no email provider is wired to it and the channel is switched off. Sender and sending-domain configuration is not implemented yet, so there is nothing to configure here today.',
  },
  {
    name: 'Internal',
    state: 'operational',
    transport: 'Transport exists',
    note: 'In-product delivery. It contacts nobody outside Omnivyra, which is why it needs no configuration.',
  },
  {
    name: 'WhatsApp',
    state: 'separate_product',
    transport: 'Not an outreach transport',
    note: 'WhatsApp broadcasts, templates and inbox exist as their own product with their own controls. It is deliberately not registered as an outreach delivery channel, so outreach cannot send through it.',
    href: '/whatsapp',
    hrefLabel: 'Open WhatsApp',
  },
  {
    name: 'SMS',
    state: 'future',
    transport: 'Not registered',
    note: 'No transport exists. The dispatcher does not know this channel.',
  },
  {
    name: 'Social',
    state: 'future',
    transport: 'Not registered',
    note: 'Social publishing and engagement exist as their own capability, but not as an outreach delivery channel.',
    href: '/social-platforms',
    hrefLabel: 'Social Platforms',
  },
  {
    name: 'Voice',
    state: 'future',
    transport: 'Not registered',
    note: 'No transport exists.',
  },
]);

export default function OutreachConfigurationPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-6">
          <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">Engagement &amp; Outreach</h1>
          <p className="mt-1 text-sm text-gray-500">
            How Omnivyra delivers outreach, and how far each channel currently goes.
          </p>
        </div>

        <IntegrationHubNav active="outreach" />

        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            <strong className="font-semibold">No outreach channel is operational, and nothing on
            this page enables one.</strong>{' '}
            A channel having a transport means the dispatcher can route to it — not that it can
            send. Each row below states both facts separately.
          </p>
          <p className="mt-2">
            Email sender and sending-domain configuration — domain verification, SPF, DKIM and DMARC
            — is the next piece of work on this surface and is not built yet.
          </p>
        </div>

        <ul className="space-y-2">
          {CHANNELS.map((channel) => {
            const style = STATE_STYLE[channel.state];
            return (
              <li
                key={channel.name}
                className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-gray-900">{channel.name}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${style.className}`}>
                      {style.label}
                    </span>
                    <span className="text-xs text-gray-400">{channel.transport}</span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500">{channel.note}</p>
                </div>
                {channel.href && (
                  <Link
                    href={channel.href}
                    className="shrink-0 text-sm font-medium text-indigo-700 hover:text-indigo-900"
                  >
                    {channel.hrefLabel ?? 'Open'}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
