export type ReportConcurrencyMetadata = {
  dedupe_key: string;
  reused_inflight: boolean;
  timeout_ms: number;
};

const inflightReports = new Map<string, Promise<unknown>>();

export async function runDedupedReport<T>(params: {
  key: string;
  timeoutMs: number;
  run: () => Promise<T>;
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

  let timer: ReturnType<typeof setTimeout> | null = null;
  const promise = Promise.race([
    params.run(),
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Report generation exceeded ${params.timeoutMs}ms concurrency boundary`)), params.timeoutMs);
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
    inflightReports.delete(params.key);
  }
}
