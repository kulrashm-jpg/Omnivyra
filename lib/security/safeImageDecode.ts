/**
 * SEC-SHARP-001 — the one gate in front of sharp/libvips for UNTRUSTED image bytes.
 *
 * WHY
 * ---
 * sharp auto-detects the input format, so any bytes handed to `sharp(buffer)`
 * reach whichever libvips loader matches them: librsvg for SVG, libheif for
 * AVIF/HEIF, libtiff, and so on. Several tenant-controlled byte sources reach
 * sharp directly (the company logo fetched from the tenant's own website, a
 * user upload composed into a template slot, a user background image). Those
 * call sites used `failOn: 'none'`, the default 268 MP pixel limit, no
 * pipeline timeout and no check of what the bytes actually are.
 *
 * WHAT THIS DOES (in order, all before any pixel is decoded)
 * ---------------------------------------------------------
 *   1. Byte cap: empty or oversized input is rejected.
 *   2. Magic-byte allowlist: only PNG, JPEG, WebP and GIF. SVG, AVIF/HEIF,
 *      TIFF, ICO, PDF and unknown bytes never reach a libvips loader. The
 *      signatures come from the repo's existing upload sniffer
 *      (`sniffMimeFromBytes`), so there is one definition of "what an image is".
 *   3. Header read (`metadata()`) under the same options: the format libvips
 *      chose must equal the sniffed one, and width x height must fit the pixel
 *      limit. A header that cannot be parsed is rejected here.
 *   4. The returned pipeline keeps `failOn: 'error'`, an explicit
 *      `limitInputPixels`, only the first frame of an animation, and a
 *      `.timeout()` so a pathological decode cannot hold a worker indefinitely.
 *
 * SVG is deliberately NOT supported. No current tenant-input call site needs it:
 * logos come from og:image / apple-touch-icon (raster), and uploads are limited
 * to png/jpeg/gif/webp by mediaService. Code-built SVG templates (escaped text
 * only) do not go through this gate.
 *
 * ERROR TAXONOMY (v2, audit A6-19)
 * --------------------------------
 *   - `ImageRejectedError`: the INPUT is unacceptable (empty, too many bytes,
 *     format not allowed / mismatched, too many pixels, undecodable, decode
 *     timeout). It carries a stable `reason`, a user-safe `message` (never the
 *     libvips text) and a byte-free `detail` (byte length, sniffed type,
 *     dimensions). Callers degrade or surface it; `reportImageFailure` logs it
 *     at warn with the reason code.
 *   - `ImageSourceUnavailableError`: fetching the remote bytes failed (network,
 *     SSRF refusal, non-2xx). Not an image problem; logged at warn.
 *   - ANYTHING ELSE is an unexpected internal error (a programming error, a
 *     sharp parameter error, a missing import ...). It is NEVER relabelled as
 *     a rejection: the helper rethrows it unchanged, and `reportImageFailure`
 *     logs it at error with its stack. Call sites then follow their existing
 *     contract (rethrow, or fall open) — but never silently.
 *
 * Only errors whose shape and message identify them as libvips INPUT failures
 * are classified as `image_decode_failed` / `image_decode_timeout` /
 * `image_dimensions_exceeded`. A libvips message this module does not know is
 * treated as internal: the cost of a miss is an error-level log, not a bypass.
 *
 * RESOURCES: this module creates no temp files and performs no I/O besides
 * decoding the buffer it is given. Every sharp instance it creates is destroyed
 * on rejection, and `transformUntrustedImage` destroys it once the transform
 * settles. Importing it never loads libvips: renderer call sites pass their own
 * `sharp` (creatorAssetRendererContracts, which configures fonts first);
 * otherwise `sharp` is required lazily on first use.
 */
import type { Sharp, SharpOptions } from 'sharp';
import { sniffMimeFromBytes } from '../../backend/services/mediaUploadValidationService';

export type SafeImageFormat = 'png' | 'jpeg' | 'webp' | 'gif';

/**
 * The slice of the sharp constructor this module uses. Declared structurally so
 * it type-checks against both sharp 0.34 (`export =`) and 0.35 (ESM types with
 * a default export), which type `import('sharp')` differently.
 */
export type SharpFactory = (input: Buffer, options?: SharpOptions) => Sharp;

export const SAFE_IMAGE_FORMATS: readonly SafeImageFormat[] = ['png', 'jpeg', 'webp', 'gif'];

/** Default byte cap. Matches the safeFetch response cap (25 MiB). */
export const SAFE_IMAGE_DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Default pixel cap: 64 MP (e.g. 8000 x 8000), a quarter of sharp's built-in
 * 268 MP default. Still above a 48 MP phone photo.
 */
export const SAFE_IMAGE_DEFAULT_MAX_PIXELS = 64_000_000;

/** Default pipeline timeout in seconds. */
export const SAFE_IMAGE_DEFAULT_TIMEOUT_SECONDS = 15;

export type ImageRejectionReason =
  | 'image_empty'
  | 'image_too_large_bytes'
  | 'image_format_not_allowed'
  | 'image_format_mismatch'
  | 'image_dimensions_exceeded'
  | 'image_decode_failed'
  | 'image_decode_timeout';

/** Byte-free facts about a rejected input. Safe to log. */
export interface ImageRejectionDetail {
  byteLength: number;
  /** MIME sniffed from the magic bytes (any type the repo sniffer knows), or null. */
  sniffedType: string | null;
  /** Format libvips selected, when the header was read. */
  detectedFormat?: string | null;
  width?: number;
  height?: number;
  maxBytes?: number;
  maxInputPixels?: number;
  timeoutSeconds?: number;
}

const USER_MESSAGES: Record<ImageRejectionReason, string> = {
  image_empty: 'The image is empty.',
  image_too_large_bytes: 'The image file is too large.',
  image_format_not_allowed: 'The image must be a PNG, JPEG, WebP or GIF file.',
  image_format_mismatch: 'The image file is not a valid PNG, JPEG, WebP or GIF image.',
  image_dimensions_exceeded: 'The image dimensions are too large.',
  image_decode_failed: 'The image file is damaged or could not be read.',
  image_decode_timeout: 'The image took too long to process.',
};

/** The input image is unacceptable. `message` is user-safe. */
export class ImageRejectedError extends Error {
  readonly reason: ImageRejectionReason;
  readonly detail: ImageRejectionDetail;

  constructor(reason: ImageRejectionReason, detail: ImageRejectionDetail, options?: { cause?: unknown }) {
    super(USER_MESSAGES[reason]);
    this.name = 'ImageRejectedError';
    this.reason = reason;
    this.detail = detail;
    // Kept for debugging in-process only; reportImageFailure never logs it.
    if (options && 'cause' in options) {
      Object.defineProperty(this, 'cause', { value: options.cause, enumerable: false, configurable: true, writable: true });
    }
  }

  /** Stable machine code (alias of `reason`). */
  get code(): ImageRejectionReason {
    return this.reason;
  }

  /** User-safe text for an API response or UI. */
  get userMessage(): string {
    return this.message;
  }
}

export function isImageRejectedError(error: unknown): error is ImageRejectedError {
  return error instanceof ImageRejectedError;
}

/** Fetching the remote image bytes failed. Not an image-content problem. */
export class ImageSourceUnavailableError extends Error {
  constructor(cause: unknown) {
    super('The image could not be downloaded.');
    this.name = 'ImageSourceUnavailableError';
    Object.defineProperty(this, 'cause', { value: cause, enumerable: false, configurable: true, writable: true });
  }
}

/**
 * Await a remote-bytes fetch and mark its failure as a source failure, so the
 * caller's catch can tell it apart from a decode problem or an internal error.
 */
export async function fetchUntrustedImageBytes(fetcher: () => Promise<Buffer>): Promise<Buffer> {
  try {
    return await fetcher();
  } catch (error) {
    throw new ImageSourceUnavailableError(error);
  }
}

const MIME_TO_FORMAT: Record<string, SafeImageFormat> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const FORMAT_TO_MIME: Record<SafeImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

function sniffAnyType(bytes: Buffer | Uint8Array): string | null {
  if (!bytes || bytes.length < 4) return null;
  return sniffMimeFromBytes(bytes.subarray(0, 32)) ?? null;
}

/**
 * Format of `bytes` by magic number, restricted to the raster allowlist.
 * Returns null for anything else (SVG, AVIF/HEIF, TIFF, video, text, ...).
 */
export function sniffSafeImageFormat(bytes: Buffer | Uint8Array): SafeImageFormat | null {
  const sniffed = sniffAnyType(bytes);
  return sniffed ? MIME_TO_FORMAT[sniffed] ?? null : null;
}

/** The MIME type for an allowlisted format. */
export function mimeForSafeImageFormat(format: SafeImageFormat): string {
  return FORMAT_TO_MIME[format];
}

/** Sniffed MIME of an allowlisted raster image, or null. */
export function sniffSafeImageMime(bytes: Buffer | Uint8Array): string | null {
  const format = sniffSafeImageFormat(bytes);
  return format ? FORMAT_TO_MIME[format] : null;
}

export interface SafeImageDecodeOptions {
  maxBytes?: number;
  maxInputPixels?: number;
  timeoutSeconds?: number;
  allowedFormats?: readonly SafeImageFormat[];
  /**
   * The sharp module to use. Renderer call sites pass the instance exported by
   * creatorAssetRendererContracts so fontconfig is configured before libvips
   * loads; when omitted, sharp is required lazily.
   */
  sharp?: SharpFactory;
}

export interface CheckedImage {
  format: SafeImageFormat;
  width: number;
  height: number;
  bytes: number;
}

function resolveOptions(options: SafeImageDecodeOptions = {}) {
  return {
    maxBytes: options.maxBytes ?? SAFE_IMAGE_DEFAULT_MAX_BYTES,
    maxInputPixels: options.maxInputPixels ?? SAFE_IMAGE_DEFAULT_MAX_PIXELS,
    timeoutSeconds: options.timeoutSeconds ?? SAFE_IMAGE_DEFAULT_TIMEOUT_SECONDS,
    allowedFormats: options.allowedFormats ?? SAFE_IMAGE_FORMATS,
  };
}

/** Cheap, synchronous pre-decode checks: size and magic bytes. */
export function assertAllowedImageBytes(
  bytes: Buffer | Uint8Array,
  options: SafeImageDecodeOptions = {},
): SafeImageFormat {
  const { maxBytes, allowedFormats } = resolveOptions(options);
  const byteLength = bytes ? bytes.length : 0;
  if (!bytes || byteLength === 0) {
    throw new ImageRejectedError('image_empty', { byteLength: 0, sniffedType: null });
  }
  const sniffedType = sniffAnyType(bytes);
  if (byteLength > maxBytes) {
    throw new ImageRejectedError('image_too_large_bytes', { byteLength, sniffedType, maxBytes });
  }
  const format = sniffedType ? MIME_TO_FORMAT[sniffedType] ?? null : null;
  if (!format || !allowedFormats.includes(format)) {
    throw new ImageRejectedError('image_format_not_allowed', { byteLength, sniffedType });
  }
  return format;
}

// ── libvips input-failure classification ─────────────────────────────────────
// Observed messages (see safeImageDecode.test.ts):
//   sharp 0.34.5 / libvips 8.17:
//     "Input buffer contains unsupported image format"
//     "Input buffer has corrupt header: VipsJpeg: premature end of JPEG image"
//     "pngload_buffer: end of stream" / "pngload_buffer: IDAT stream error"
//     "Input image exceeds pixel limit"
//     "timeout: 28% complete\nVipsImage: killed for image ..."
//   sharp 0.35.5 / libvips 8.18 (spng loader, lower-case prefix):
//     "vipspng: libpng read error\nvips2png: unable to write to target target"
// sharp's own argument validation ("Expected positive integer ... for width")
// is deliberately NOT matched: that is a caller bug, not bad input.
const LIBVIPS_PIXEL_LIMIT = /exceeds pixel limit/i;
const LIBVIPS_TIMEOUT = /^timeout: \d+% complete/;
const LIBVIPS_INPUT_FAILURE =
  /^(Input (buffer|image|file) (has corrupt header|contains unsupported image format|is missing|is empty)|[a-z0-9]+load(_buffer|_source)?: |vips(jpeg|s?png|c?gif|webp|heif|tiff|foreign[a-z_]*): )/i;

type DecoderFailureKind = 'pixel_limit' | 'timeout' | 'decode';

/** Classify an error as a libvips INPUT failure, or null when it is anything else. */
function isErrorLike(error: unknown): error is Error {
  // Realm-independent: errors created by the sharp native addon are not
  // `instanceof Error` inside a jest/vm sandbox, but they are still Errors.
  return typeof error === 'object' && error !== null && Object.prototype.toString.call(error) === '[object Error]';
}

export function classifyDecoderError(error: unknown): DecoderFailureKind | null {
  // Programming errors (TypeError, ReferenceError, RangeError, custom classes)
  // are never input failures. sharp/libvips raises a plain `Error`.
  if (!isErrorLike(error)) return null;
  if (error.name !== 'Error' || (error as { constructor?: { name?: string } }).constructor?.name !== 'Error') return null;
  const message = typeof error.message === 'string' ? error.message : '';
  if (LIBVIPS_PIXEL_LIMIT.test(message)) return 'pixel_limit';
  if (LIBVIPS_TIMEOUT.test(message)) return 'timeout';
  if (LIBVIPS_INPUT_FAILURE.test(message)) return 'decode';
  return null;
}

function loadSharp(): SharpFactory {
  // Lazy: see the module header (font setup must run before libvips loads).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('sharp') as SharpFactory;
}

/** Release a sharp pipeline (a Duplex stream). Idempotent. */
function disposeImage(image: Sharp | null | undefined): void {
  const destroy = (image as unknown as { destroy?: () => void } | null | undefined)?.destroy;
  if (typeof destroy === 'function') destroy.call(image);
}

function rejectionFor(
  kind: DecoderFailureKind,
  base: ImageRejectionDetail,
  resolved: ReturnType<typeof resolveOptions>,
  cause: unknown,
): ImageRejectedError {
  if (kind === 'pixel_limit') {
    return new ImageRejectedError('image_dimensions_exceeded', { ...base, maxInputPixels: resolved.maxInputPixels }, { cause });
  }
  if (kind === 'timeout') {
    return new ImageRejectedError('image_decode_timeout', { ...base, timeoutSeconds: resolved.timeoutSeconds }, { cause });
  }
  return new ImageRejectedError('image_decode_failed', base, { cause });
}

/**
 * Validate untrusted bytes and return a sharp pipeline that is safe to chain
 * (`.resize()`, `.png()`, `.toBuffer()` ...). Throws `ImageRejectedError` for
 * bad input; any other error is rethrown unchanged. The caller owns the
 * returned pipeline (prefer `transformUntrustedImage`, which disposes it).
 */
export async function openUntrustedImage(
  input: Buffer | Uint8Array,
  options: SafeImageDecodeOptions = {},
): Promise<{ image: Sharp; info: CheckedImage }> {
  const resolved = resolveOptions(options);
  const format = assertAllowedImageBytes(input, options);
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const base: ImageRejectionDetail = { byteLength: bytes.length, sniffedType: FORMAT_TO_MIME[format] };

  const sharpOptions: SharpOptions = {
    failOn: 'error',
    limitInputPixels: resolved.maxInputPixels,
    // First frame only for animated GIF/WebP (sharp's default, stated explicitly).
    pages: 1,
  };
  const image = (options.sharp ?? loadSharp())(bytes, sharpOptions).timeout({ seconds: resolved.timeoutSeconds });

  let width = 0;
  let height = 0;
  let detected: string | undefined;
  try {
    const metadata = await image.metadata();
    width = metadata.width ?? 0;
    height = metadata.height ?? 0;
    detected = metadata.format;
  } catch (error) {
    disposeImage(image);
    const kind = classifyDecoderError(error);
    if (!kind) throw error; // internal: never relabelled
    throw rejectionFor(kind, base, resolved, error);
  }

  if (detected !== format) {
    disposeImage(image);
    throw new ImageRejectedError('image_format_mismatch', { ...base, detectedFormat: detected ?? null });
  }
  if (!width || !height || width * height > resolved.maxInputPixels) {
    disposeImage(image);
    throw new ImageRejectedError('image_dimensions_exceeded', {
      ...base, width, height, maxInputPixels: resolved.maxInputPixels,
    });
  }

  return { image, info: { format, width, height, bytes: bytes.length } };
}

/**
 * Run a sharp transform over untrusted bytes. Only libvips INPUT failures raised
 * by the transform (truncated data, corrupt stream, timeout) become
 * `ImageRejectedError`; every other error (a bug in the transform, a sharp
 * argument error) propagates unchanged. The pipeline is always disposed.
 */
export async function transformUntrustedImage(
  input: Buffer | Uint8Array,
  transform: (image: Sharp) => Promise<Buffer>,
  options: SafeImageDecodeOptions = {},
): Promise<Buffer> {
  const resolved = resolveOptions(options);
  const { image, info } = await openUntrustedImage(input, options);
  try {
    return await transform(image);
  } catch (error) {
    if (isImageRejectedError(error)) throw error;
    const kind = classifyDecoderError(error);
    if (!kind) throw error; // internal: never relabelled
    throw rejectionFor(kind, {
      byteLength: info.bytes, sniffedType: FORMAT_TO_MIME[info.format], width: info.width, height: info.height,
    }, resolved, error);
  } finally {
    disposeImage(image);
  }
}

// ── logging ──────────────────────────────────────────────────────────────────

export type ImageFailureClass = 'rejected' | 'source_unavailable' | 'internal';

export interface ImageFailureContext {
  /** Stable call-site id, e.g. 'creator.brand_mark'. */
  callSite: string;
  /** Tenant company id (an internal identifier, not PII). Optional. */
  companyId?: string | null;
}

function errorName(error: unknown): string {
  return isErrorLike(error) ? error.name : typeof error;
}

/**
 * Log an image-path failure at the right level and return its class. Never logs
 * image bytes, URLs or the raw input. Every catch around untrusted image work
 * must call this (or rethrow) — a silent fall-open is what hid the v1
 * missing-import ReferenceError.
 *
 *   rejected            → console.warn  [safe-image][rejected]            reason, byteLength, sniffedType, dims
 *   source_unavailable  → console.warn  [safe-image][source-unavailable]  cause name / HTTP status only
 *   internal            → console.error [safe-image][internal-error]      name, message, stack
 */
export function reportImageFailure(error: unknown, context: ImageFailureContext): ImageFailureClass {
  const companyId = context.companyId ?? null;
  if (isImageRejectedError(error)) {
    console.warn('[safe-image][rejected]', {
      callSite: context.callSite,
      reason: error.reason,
      ...error.detail,
      companyId,
    });
    return 'rejected';
  }
  if (error instanceof ImageSourceUnavailableError) {
    const cause = (error as { cause?: unknown }).cause;
    const status = isErrorLike(cause) ? /failed with (\d{3})\b/.exec(cause.message)?.[1] ?? null : null;
    console.warn('[safe-image][source-unavailable]', {
      callSite: context.callSite,
      causeName: errorName(cause),
      httpStatus: status ? Number(status) : null,
      companyId,
    });
    return 'source_unavailable';
  }
  console.error('[safe-image][internal-error]', {
    callSite: context.callSite,
    errorName: errorName(error),
    message: isErrorLike(error) ? String(error.message).slice(0, 500) : String(error).slice(0, 500),
    stack: isErrorLike(error) ? error.stack : undefined,
    companyId,
  });
  return 'internal';
}
