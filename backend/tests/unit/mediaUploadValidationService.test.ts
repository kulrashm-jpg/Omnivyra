import { validateMediaUpload, resolveExpectedCategory, sniffMimeFromBytes, compareSniffedToClientMime } from '../../services/mediaUploadValidationService';

describe('media upload validation service', () => {
  describe('resolveExpectedCategory', () => {
    test('maps content types to categories', () => {
      expect(resolveExpectedCategory('video')).toBe('video');
      expect(resolveExpectedCategory('reel')).toBe('video');
      expect(resolveExpectedCategory('short')).toBe('video');
      expect(resolveExpectedCategory('podcast')).toBe('audio');
      expect(resolveExpectedCategory('image')).toBe('image');
      expect(resolveExpectedCategory('infographic')).toBe('image');
      expect(resolveExpectedCategory('unknown')).toBeNull();
    });
  });

  test('rejects empty / missing media_url', async () => {
    const result = await validateMediaUpload({
      mediaUrl: '',
      contentType: 'reel',
      skipLiveness: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /required/i.test(e))).toBe(true);
    }
  });

  test('rejects non-http URLs', async () => {
    const result = await validateMediaUpload({
      mediaUrl: 'file:///etc/passwd',
      contentType: 'reel',
      skipLiveness: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /valid http/i.test(e))).toBe(true);
    }
  });

  test('rejects unknown content_type', async () => {
    const result = await validateMediaUpload({
      mediaUrl: 'https://example.com/file.mp4',
      contentType: 'mystery',
      skipLiveness: true,
      mimeType: 'video/mp4',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /Unsupported content_type/i.test(e))).toBe(true);
    }
  });

  test('rejects MIME mismatch (audio/mpeg for reel)', async () => {
    const result = await validateMediaUpload({
      mediaUrl: 'https://cdn.example.test/file.mp3',
      contentType: 'reel',
      mimeType: 'audio/mpeg',
      sizeBytes: 1024,
      skipLiveness: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /not compatible/i.test(e))).toBe(true);
    }
  });

  test('accepts a YouTube platform link for video without requiring a MIME match', async () => {
    const result = await validateMediaUpload({
      mediaUrl: 'https://youtu.be/abc123',
      contentType: 'video',
      skipLiveness: true,
    });
    expect(result.valid).toBe(true);
    expect(result.details.platform_link_host).toBe('youtu.be');
    expect(result.details.mime_compatible).toBe(true);
  });

  test('accepts direct video MIME with size in range', async () => {
    const result = await validateMediaUpload({
      mediaUrl: 'https://cdn.example.test/clip.mp4',
      contentType: 'reel',
      mimeType: 'video/mp4',
      sizeBytes: 5_000_000,
      skipLiveness: true,
    });
    expect(result.valid).toBe(true);
    expect(result.details.mime_compatible).toBe(true);
    expect(result.details.size_sanity_ok).toBe(true);
  });

  test('rejects oversized media', async () => {
    const result = await validateMediaUpload({
      mediaUrl: 'https://cdn.example.test/big.mp4',
      contentType: 'video',
      mimeType: 'video/mp4',
      sizeBytes: 5_000_000_000, // 5 GB > 2 GB cap
      skipLiveness: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /size/i.test(e) && /limit/i.test(e))).toBe(true);
    }
  });

  test('accepts podcast platform link for podcast content_type', async () => {
    const result = await validateMediaUpload({
      mediaUrl: 'https://open.spotify.com/episode/abc',
      contentType: 'podcast',
      skipLiveness: true,
    });
    expect(result.valid).toBe(true);
    expect(result.details.platform_link_host).toBe('open.spotify.com');
  });

  test('flags missing MIME when no platform host and skipLiveness disabled would be needed', async () => {
    const result = await validateMediaUpload({
      mediaUrl: 'https://cdn.example.test/unknown',
      contentType: 'video',
      skipLiveness: true,
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => /Could not detect media MIME/i.test(e))).toBe(true);
    }
  });

  describe('sniffMimeFromBytes', () => {
    test('PNG signature → image/png', () => {
      const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(sniffMimeFromBytes(buf)).toBe('image/png');
    });
    test('JPEG signature → image/jpeg', () => {
      expect(sniffMimeFromBytes(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    });
    test('MP4 ftyp box → video/mp4', () => {
      // 4 size bytes + "ftyp" + "mp42" brand
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
      expect(sniffMimeFromBytes(buf)).toBe('video/mp4');
    });
    test('QuickTime ftyp brand qt → video/quicktime', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20]);
      expect(sniffMimeFromBytes(buf)).toBe('video/quicktime');
    });
    test('M4A ftyp brand → audio/mp4', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
      expect(sniffMimeFromBytes(buf)).toBe('audio/mp4');
    });
    test('WAV RIFF/WAVE → audio/wav', () => {
      const buf = Buffer.concat([
        Buffer.from('RIFF', 'latin1'),
        Buffer.from([0x24, 0x00, 0x00, 0x00]),
        Buffer.from('WAVE', 'latin1'),
      ]);
      expect(sniffMimeFromBytes(buf)).toBe('audio/wav');
    });
    test('WEBP RIFF/WEBP → image/webp', () => {
      const buf = Buffer.concat([
        Buffer.from('RIFF', 'latin1'),
        Buffer.from([0x24, 0x00, 0x00, 0x00]),
        Buffer.from('WEBP', 'latin1'),
      ]);
      expect(sniffMimeFromBytes(buf)).toBe('image/webp');
    });
    test('OGG OggS → audio/ogg', () => {
      expect(sniffMimeFromBytes(Buffer.from('OggS', 'latin1'))).toBe('audio/ogg');
    });
    test('MP3 ID3 → audio/mpeg', () => {
      expect(sniffMimeFromBytes(Buffer.from([0x49, 0x44, 0x33, 0x04]))).toBe('audio/mpeg');
    });
    test('Unknown bytes → null', () => {
      expect(sniffMimeFromBytes(Buffer.from([0xab, 0xcd, 0xef, 0x01]))).toBeNull();
      expect(sniffMimeFromBytes(Buffer.alloc(0))).toBeNull();
    });
    test('FLAC fLaC → audio/flac', () => {
      expect(sniffMimeFromBytes(Buffer.from('fLaC', 'latin1'))).toBe('audio/flac');
    });
    test('AIFF FORM/AIFF → audio/aiff', () => {
      const buf = Buffer.concat([
        Buffer.from('FORM', 'latin1'),
        Buffer.from([0x00, 0x00, 0x00, 0x24]),
        Buffer.from('AIFF', 'latin1'),
      ]);
      expect(sniffMimeFromBytes(buf)).toBe('audio/aiff');
    });
    test('HEIC ftyp brand → image/heic', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
      expect(sniffMimeFromBytes(buf)).toBe('image/heic');
    });
    test('AVIF ftyp brand → image/avif', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
      expect(sniffMimeFromBytes(buf)).toBe('image/avif');
    });
    test('AV1 (av01 brand) ftyp → video/mp4 (CMAF MP4 container)', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x30, 0x31]);
      expect(sniffMimeFromBytes(buf)).toBe('video/mp4');
    });
    test('3GPP ftyp brand → video/3gpp', () => {
      const buf = Buffer.from([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x33, 0x67, 0x70, 0x34]);
      expect(sniffMimeFromBytes(buf)).toBe('video/3gpp');
    });
    test('AVI RIFF/AVI → video/x-msvideo', () => {
      const buf = Buffer.concat([
        Buffer.from('RIFF', 'latin1'),
        Buffer.from([0x24, 0x00, 0x00, 0x00]),
        Buffer.from('AVI ', 'latin1'),
      ]);
      expect(sniffMimeFromBytes(buf)).toBe('video/x-msvideo');
    });
    test('AAC ADTS frame sync → audio/aac', () => {
      // ADTS frame sync: FF F1 (MPEG-4) — bits: 0xFFF1xxxx
      expect(sniffMimeFromBytes(Buffer.from([0xff, 0xf1, 0x4c, 0x80]))).toBe('audio/aac');
    });
  });

  describe('compareSniffedToClientMime', () => {
    test('matching category → ok', () => {
      const result = compareSniffedToClientMime({ sniffed: 'video/mp4', claimed: 'video/quicktime' });
      expect(result.ok).toBe(true);
    });
    test('mismatched category → not ok with reason', () => {
      const result = compareSniffedToClientMime({ sniffed: 'image/png', claimed: 'video/mp4' });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toMatch(/Client claimed/);
        expect(result.sniffed).toBe('image/png');
        expect(result.claimed).toBe('video/mp4');
      }
    });
    test('no sniff (unsupported format) → ok (we don\'t reject what we can\'t sniff)', () => {
      const result = compareSniffedToClientMime({ sniffed: null, claimed: 'video/mp4' });
      expect(result.ok).toBe(true);
    });
  });
});
