/**
 * J1 H3-4 / H3-5a - read at most N bytes of an HTTP response body.
 *
 * `await resp.arrayBuffer()` buffers the WHOLE body. A storage server that
 * ignores a Range header answers 200 with the full object, which for an
 * attacker-written object of unknown size can exhaust memory. These helpers
 * read through the body stream and stop (cancelling the stream) at the limit.
 *
 *   mode 'truncate': return the first `limit` bytes (a head read).
 *   mode 'fail':     return { ok:false, reason:'too_large' } as soon as more
 *                    than `limit` bytes arrive (a capped full read).
 */
export type BoundedRead = { ok: true; bytes: Buffer } | { ok: false; reason: 'too_large' | 'read_failed' };

type BodyLike = {
  body?: { getReader?: () => { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(reason?: unknown): Promise<void> } } | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  headers?: { get(name: string): string | null } | null;
};

export async function readBodyBounded(resp: BodyLike, limit: number, mode: 'truncate' | 'fail'): Promise<BoundedRead> {
  if (!Number.isFinite(limit) || limit < 0) return { ok: false, reason: 'read_failed' };
  // A declared Content-Length over the cap is refused before any byte is read.
  const declared = Number(resp.headers?.get?.('content-length') ?? NaN);
  if (mode === 'fail' && Number.isFinite(declared) && declared > limit) return { ok: false, reason: 'too_large' };

  const reader = resp.body?.getReader?.();
  if (!reader) {
    // No stream interface: only safe when the length is declared and within the cap.
    if (!resp.arrayBuffer || !Number.isFinite(declared) || (mode === 'fail' && declared > limit)) {
      return { ok: false, reason: 'read_failed' };
    }
    try {
      const all = Buffer.from(await resp.arrayBuffer());
      if (mode === 'fail' && all.length > limit) return { ok: false, reason: 'too_large' };
      return { ok: true, bytes: all.subarray(0, limit) };
    } catch {
      return { ok: false, reason: 'read_failed' };
    }
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;
      const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
      if (total + chunk.length > limit) {
        await reader.cancel('byte limit reached').catch(() => undefined);
        if (mode === 'fail') return { ok: false, reason: 'too_large' };
        chunks.push(chunk.subarray(0, limit - total));
        total = limit;
        break;
      }
      chunks.push(chunk);
      total += chunk.length;
      if (mode === 'truncate' && total === limit) {
        await reader.cancel('byte limit reached').catch(() => undefined);
        break;
      }
    }
  } catch {
    return { ok: false, reason: 'read_failed' };
  }
  return { ok: true, bytes: Buffer.concat(chunks, total) };
}

/**
 * GET `url` with `Range: bytes=0-<limit>` (one byte beyond the cap, so an
 * over-cap object is detected) and read at most `limit` bytes of the body
 * whatever status/Range handling the server applies. mode as readBodyBounded.
 */
export async function fetchBounded(
  url: string,
  limit: number,
  mode: 'truncate' | 'fail',
  fetchImpl: (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<BodyLike & { status: number }> = fetch as never,
  timeoutMs = 30_000,
): Promise<BoundedRead> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const last = mode === 'truncate' ? Math.max(0, limit - 1) : limit;
    const resp = await fetchImpl(url, { headers: { range: `bytes=0-${last}` }, signal: controller.signal });
    if (resp.status !== 200 && resp.status !== 206) return { ok: false, reason: 'read_failed' };
    return await readBodyBounded(resp, limit, mode);
  } catch {
    return { ok: false, reason: 'read_failed' };
  } finally {
    clearTimeout(timer);
  }
}
