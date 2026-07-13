'use client';

/**
 * CaptchaWidget — provider-agnostic CAPTCHA widget (AUTH-001, Section 3).
 *
 * Renders nothing unless BOTH NEXT_PUBLIC_CAPTCHA_PROVIDER and
 * NEXT_PUBLIC_CAPTCHA_SITE_KEY are configured, so shipping this component is
 * a no-op until ops enables CAPTCHA (server enforcement is independently
 * gated on CAPTCHA_PROVIDER + CAPTCHA_SECRET_KEY in lib/auth/captcha.ts —
 * enable both sides together).
 *
 * Supported: Cloudflare Turnstile, hCaptcha, Google reCAPTCHA v2. All three
 * expose the same explicit-render contract (script + render(container,
 * {sitekey, callback})), which is what keeps this provider-agnostic.
 *
 * Usage:
 *   <CaptchaWidget onToken={setCaptchaToken} />
 *   …include captchaToken in the POST body; server verifies via
 *   verifyCaptchaToken().
 */

import { useEffect, useRef } from 'react';

type Props = { onToken: (token: string | null) => void };

const PROVIDER = (process.env.NEXT_PUBLIC_CAPTCHA_PROVIDER ?? '').trim().toLowerCase();
const SITE_KEY = (process.env.NEXT_PUBLIC_CAPTCHA_SITE_KEY ?? '').trim();

const SCRIPT_SRC: Record<string, string> = {
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit',
  hcaptcha:  'https://js.hcaptcha.com/1/api.js?render=explicit',
  recaptcha: 'https://www.google.com/recaptcha/api.js?render=explicit',
};

function providerApi(): any {
  const w = window as any;
  if (PROVIDER === 'turnstile') return w.turnstile;
  if (PROVIDER === 'hcaptcha')  return w.hcaptcha;
  if (PROVIDER === 'recaptcha') return w.grecaptcha;
  return null;
}

export function isCaptchaWidgetEnabled(): boolean {
  return !!SCRIPT_SRC[PROVIDER] && !!SITE_KEY;
}

export default function CaptchaWidget({ onToken }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderedRef  = useRef(false);

  useEffect(() => {
    if (!isCaptchaWidgetEnabled() || renderedRef.current) return;

    const renderWidget = () => {
      const api = providerApi();
      if (!api || !containerRef.current || renderedRef.current) return;
      renderedRef.current = true;
      try {
        api.render(containerRef.current, {
          sitekey: SITE_KEY,
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        });
      } catch {
        // Widget render failure must never break the form; the server side
        // fails open on provider outage.
        onToken(null);
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC[PROVIDER]}"]`);
    if (existing) {
      if (providerApi()) renderWidget();
      else existing.addEventListener('load', renderWidget, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_SRC[PROVIDER];
    script.async = true;
    script.defer = true;
    script.addEventListener('load', renderWidget, { once: true });
    document.head.appendChild(script);
  }, [onToken]);

  if (!isCaptchaWidgetEnabled()) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}
