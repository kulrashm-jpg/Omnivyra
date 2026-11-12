// What a failed send means for a retry (CLASS-2 D3, e9 sweep).
//
// The email_jobs worker used to retry EVERY failure. But a failure after SES was called can be a
// lost answer to a message SES accepted - a retry then sends it TWICE. So the function says which:
//
//   not_sent  - nothing reached SES (configuration, rendering), or SES ANSWERED with a 4xx
//               (MessageRejected, Throttling, an unverified sender): it definitely did not send.
//               Safe to retry.
//   uncertain - SES was called and no 4xx answer came back (a timeout, a reset connection, a 5xx):
//               the message may have been sent. Never retried automatically; a person reviews it.
//
// Dependency-free and Deno-free, so it is unit-tested under Node/jest (see escape.ts).

export type SendFailureOutcome = "not_sent" | "uncertain";

export function classifySendFailure(err: unknown, providerCalled: boolean): SendFailureOutcome {
  if (!providerCalled) return "not_sent";
  const status = (err as { $metadata?: { httpStatusCode?: unknown } } | null)?.$metadata?.httpStatusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? "not_sent" : "uncertain";
}

/** Set immediately before the provider call, so a failure can be placed before or after it. */
export interface SendProgress {
  providerCalled: boolean;
}
