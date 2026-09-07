export type ReportConcurrencyMetadata = {
  dedupe_key: string;
  reused_inflight: boolean;
  timeout_ms: number;
};

const inflightReports = new Map<string, Promise<unknown>>();

/**
 * The report liveness boundary. `timeoutMs` is unchanged and remains the single authoritative
 * deadline — there is exactly one timer here and no other timer was added anywhere.
 *
 * What changed: that timer used to only REJECT, which failed the report and left everything behind
 * it running (proven in capture 3878545e — `provider_and_snapshot` still executing AI and SERP work
 * after the 45s boundary). It now aborts a controller in the SAME callback that rejects, and hands
 * that signal to `run`, so the work behind the boundary can stop when the report it belongs to is
 * already lost.
 *
 * `run` may ignore the signal: it is passed as an argument, so existing zero-argument callbacks
 * remain assignable and behave exactly as before.
 *
 * The controller is also aborted in `finally`, on success as well as failure. Once the report has
 * settled, anything still in flight for it is by definition abandoned work; closing the scope is
 * what stops it from outliving the request.
 */
export async function runDedupedReport<T>(params: {
  key: string;
  timeoutMs: number;
  run: (signal: AbortSignal) => Promise<T>;
}): Promise<{ result: T; metadata: ReportConcurrencyMetadata }> {
  const existing = inflightReports.get(params.key) as Promise<T> | undefined;
  if (existing) {
    return {
      result: await existing,
      metadata: {
        dedupe_key: params.key,
        reused_inflight: true,
        timeout_ms: params.timeoutMs,
      },
    };
  }

  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = Promise.race([
    params.run(controller.signal),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`Report generation exceeded ${params.timeoutMs}ms concurrency boundary`));
      }, params.timeoutMs);
    }),
  ]);

  inflightReports.set(params.key, promise);
  try {
    return {
      result: await promise,
      metadata: {
        dedupe_key: params.key,
        reused_inflight: false,
        timeout_ms: params.timeoutMs,
      },
    };
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
    inflightReports.delete(params.key);
  }
}
