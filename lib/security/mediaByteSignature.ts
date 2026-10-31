/**
 * SEC-SHARP-001 (R-C1) / MEDIA-H3 — "do these bytes positively look like the
 * declared NON-image type?" One definition, shared by every upload path that
 * stores tenant bytes:
 *   - POST /api/media/upload                         (patch C v3, moved here)
 *   - POST /api/activity-workspace/[id]/upload-media-direct
 *   - POST /api/activity-workspace/[id]/upload-media-finalize (quarantine)
 *
 * Unknown bytes are REFUSED. The lenient `compareSniffedToClientMime` accepts
 * an unrecognised sniff, which is how TIFF/PPM/random bytes declared as
 * `video/mp4` used to reach a public bucket and then libvips through
 * `/_next/image`.
 */
import { sniffMimeFromBytes } from '../../backend/services/mediaUploadValidationService';

/** Leading top-level atoms of legacy QuickTime files that carry no `ftyp` box. */
export const QUICKTIME_LEADING_ATOMS: ReadonlySet<string> = new Set(['moov', 'mdat', 'wide', 'free', 'skip', 'pnot']);

/**
 * True when the bytes positively look like the declared non-image type:
 * `application/pdf` needs the `%PDF-` header; `video/*` and `audio/*` need
 * the repo sniffer to report the same category (legacy QuickTime atoms are
 * accepted for a declared QuickTime type only). Anything else is refused.
 */
export function nonImageBytesMatchDeclaredType(bytes: Buffer, declaredMimeType: string): boolean {
  const claimed = declaredMimeType.trim().toLowerCase().split(';')[0].trim();
  if (claimed === 'application/pdf') {
    return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
  }
  const category = claimed.split('/')[0];
  if (category !== 'video' && category !== 'audio') return false;
  const sniffed = sniffMimeFromBytes(bytes.subarray(0, 32));
  if (sniffed) return sniffed.split('/')[0] === category;
  if (claimed === 'video/quicktime' || claimed === 'video/mov') {
    return bytes.length >= 8 && QUICKTIME_LEADING_ATOMS.has(bytes.subarray(4, 8).toString('latin1'));
  }
  return false;
}
