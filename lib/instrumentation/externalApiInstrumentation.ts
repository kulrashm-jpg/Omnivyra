/**
 * External API call instrumentation.
 *
 * This module only owns the service-detection table, counters, and snapshot
 * logic.  Fetch interception is handled exclusively by fetchInstrumentation.ts,
 * which calls recordExternalCall() here.  There is NO globalThis.fetch patch
 * in this file â€” the previous design caused double-counting when supabase and
 * external modules both wrapped fetch independently.
 */

// â”€â”€ Service detection table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SERVICE_PREFIXES: Array<{ prefix: string; name: string }> = [
  { prefix: 'https://api.openai.com',                  name: 'openai'      },
  { prefix: 'https://api.anthropic.com',               name: 'anthropic'   },
  { prefix: 'https://api.linkedin.com',                name: 'linkedin'    },
  { prefix: 'https://api.twitter.com',                 name: 'twitter'     },
  { prefix: 'https://api.x.com',                       name: 'twitter'     },
  { prefix: 'https://graph.facebook.com',              name: 'facebook'    },
  { prefix: 'https://graph.instagram.com',             name: 'instagram'   },
  { prefix: 'https://www.googleapis.com',              name: 'google'      },
  { prefix: 'https://hooks.slack.com',                 name: 'slack'       },
  { prefix: 'https://api.stripe.com',                  name: 'stripe'      },
  // Outbound transactional email goes through the Supabase Edge Function
  // `send-transactional-email`, which calls SES from inside Supabase's
  // infrastructure â€” those calls don't traverse this app's fetch and so
  // aren't instrumented here. The SES prefix is kept in case the Edge
  // Function is ever inlined back into the Next.js runtime.
  { prefix: 'https://email.amazonaws.com',             name: 'ses'         },
  { prefix: 'https://api.sendgrid.com',                name: 'sendgrid'    },
  { prefix: 'https://upstash.io',                      name: 'upstash'     },
];

/**
 * Exported so fetchInstrumentation.ts can use it as `serviceDetector`.
 * Returns null for unrecognised URLs â†’ those calls are not tracked.
 */
export function detectExternalService(url: string): string | null {
  for (const { prefix, name } of SERVICE_PREFIXES) {
    if (url.startsWith(prefix)) return name;
  }
  return null;
}

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface ServiceStats {
  calls:              number;
  errors:             number;
  latencies:          number[];
  estimatedTokensIn:  number;
  estimatedTokensOut: number;
}

const serviceMap = new Map<string, ServiceStats>();

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ExternalServiceMetrics {
  service:            string;
  calls:              number;
  errors:             number;
  errorRate:          number;
  avgLatencyMs:       number | null;
  estimatedTokensIn:  number;
  estimatedTokensOut: number;
}

export interface ExternalApiMetrics {
  totalExternalCalls: number;
  byService:          Record<string, ExternalServiceMetrics>;
  topServices:        ExternalServiceMetrics[];
}

// â”€â”€ Public recorder (called by fetchInstrumentation.ts) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function recordExternalCall(
  service: string,
  latencyMs: number,
  isError: boolean,
  tokensIn  = 0,
  tokensOut = 0,
): void {
  let s = serviceMap.get(service);
  if (!s) {
    s = { calls: 0, errors: 0, latencies: [], estimatedTokensIn: 0, estimatedTokensOut: 0 };
    serviceMap.set(service, s);
  }
  s.calls++;
  if (isError) s.errors++;
  s.latencies.push(latencyMs);
  if (s.latencies.length > 100) s.latencies.shift();
  s.estimatedTokensIn  += tokensIn;
  s.estimatedTokensOut += tokensOut;
}

// â”€â”€ Snapshot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function avgLatency(s: ServiceStats): number | null {
  if (s.latencies.length === 0) return null;
  return Math.round(s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length);
}

export function getExternalApiMetrics(): ExternalApiMetrics {
  let totalExternalCalls = 0;
  const byService: Record<string, ExternalServiceMetrics> = {};
  const serviceList: ExternalServiceMetrics[] = [];

  for (const [name, s] of serviceMap) {
    totalExternalCalls += s.calls;
    const row: ExternalServiceMetrics = {
      service:            name,
      calls:              s.calls,
      errors:             s.errors,
      errorRate:          s.calls === 0 ? 0 : s.errors / s.calls,
      avgLatencyMs:       avgLatency(s),
      estimatedTokensIn:  s.estimatedTokensIn,
      estimatedTokensOut: s.estimatedTokensOut,
    };
    byService[name] = row;
    serviceList.push(row);
  }

  return {
    totalExternalCalls,
    byService,
    topServices: serviceList.sort((a, b) => b.calls - a.calls).slice(0, 10),
  };
}

export function resetExternalApiMetrics(): void {
  serviceMap.clear();
}
