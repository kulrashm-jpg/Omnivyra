const clientBootAt = Date.now();
const inFlight = new Map<string, Promise<unknown>>();
const lastStartedAt = new Map<string, number>();

type SharedPollOptions = {
  startupDelayMs?: number;
  minIntervalMs?: number;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function runSharedPoll<T>(
  key: string,
  work: () => Promise<T>,
  options: SharedPollOptions = {},
): Promise<T | undefined> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const now = Date.now();
  const lastStarted = lastStartedAt.get(key) ?? 0;
  if (options.minIntervalMs && now - lastStarted < options.minIntervalMs) {
    return Promise.resolve(undefined);
  }

  const promise = (async () => {
    const bootAgeMs = Date.now() - clientBootAt;
    const startupWaitMs = Math.max(0, (options.startupDelayMs ?? 0) - bootAgeMs);
    if (startupWaitMs > 0) {
      await wait(startupWaitMs);
    }
    lastStartedAt.set(key, Date.now());
    return work();
  })().finally(() => {
    inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}
