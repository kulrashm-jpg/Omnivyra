/**
 * MEDIA-H3 — `/_next/image` must not fetch Supabase Storage objects at all.
 *
 * The optimizer decodes whatever bytes an allowed URL serves and ignores the
 * stored Content-Type (next 16 image-optimizer: detectContentType falls back to
 * `sharp().metadata()` for unknown bytes). Any `remotePatterns` entry for the
 * project's storage host therefore exposes libvips to stored tenant bytes. No
 * `next/image` consumer renders a stored object, so the entry is removed. This
 * supersedes patch D (hostname narrowing), which kept the project's own public
 * bucket reachable.
 *
 * The source guard is adapted from patch D v2 (gate23): every next/image
 * consumer must use a root-relative literal `src`, so removing the entry cannot
 * break an app image and a future remote consumer fails here first.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CONFIG_PATH = path.join(ROOT, 'next.config.js');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { matchRemotePattern } = require('next/dist/shared/lib/match-remote-pattern');

type RemotePattern = { protocol?: string; hostname: string; port?: string; pathname?: string };

function loadImagesConfigWith(publicUrl: string | undefined): { remotePatterns: RemotePattern[]; domains?: string[] } {
  const saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
  try {
    if (publicUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = publicUrl;
    let cfg: any;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cfg = require(CONFIG_PATH);
    });
    return cfg.images;
  } finally {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
  }
}

const STORAGE_URLS = [
  'https://klkiseupptzbecbxwrky.supabase.co/storage/v1/object/public/media-uploads/c/a/video/x.mp4',
  'https://klkiseupptzbecbxwrky.supabase.co/storage/v1/object/public/media-images/logo.png',
  'https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/media-uploads/x.tiff',
  'https://klkiseupptzbecbxwrky.supabase.co/storage/v1/object/sign/media-quarantine/x.mp4?token=t',
  'https://klkiseupptzbecbxwrky.supabase.co/storage/v1/render/image/public/media-uploads/x.png',
  'https://pooler.example.net/storage/v1/object/public/media-uploads/x.mp4',
];

describe('MEDIA-H3: no Supabase Storage host in images config', () => {
  it.each([
    ['prod URL', 'https://klkiseupptzbecbxwrky.supabase.co'],
    ['other project URL', 'https://abcdefghijklmnopqrst.supabase.co'],
    ['unset', undefined],
    ['loopback', 'http://127.0.0.1:54321'],
  ])('NEXT_PUBLIC_SUPABASE_URL %s → no pattern matches any storage URL', (_n, url) => {
    const images = loadImagesConfigWith(url);
    const patterns = images.remotePatterns ?? [];
    for (const p of patterns) expect(p.hostname).not.toMatch(/supabase|\*/i);
    expect(images.domains ?? []).toEqual([]);
    for (const u of STORAGE_URLS) {
      expect({ u, allowed: patterns.some((p) => matchRemotePattern(p, new URL(u))) }).toEqual({ u, allowed: false });
    }
  });

  it('the unrelated images.unsplash.com entry is unchanged', () => {
    const { remotePatterns } = loadImagesConfigWith(undefined);
    expect(remotePatterns).toEqual([{ protocol: 'https', hostname: 'images.unsplash.com', pathname: '/**' }]);
    expect(remotePatterns.some((p) => matchRemotePattern(p, new URL('https://images.unsplash.com/photo-1?w=500')))).toBe(true);
  });

  it('no next/image consumer renders a remote URL (so removing the entry cannot break app images)', () => {
    const exts = new Set(['.ts', '.tsx', '.js', '.jsx']);
    const skip = new Set(['node_modules', '.next', '.git', 'backend', 'scripts', 'supabase', 'public']);
    const consumers: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (exts.has(path.extname(e.name))) {
          const src = fs.readFileSync(full, 'utf8');
          if (/from\s+['"]next\/(legacy\/)?image['"]|require\(\s*['"]next\/(legacy\/)?image['"]\s*\)/.test(src)) {
            consumers.push(full);
          }
        }
      }
    };
    for (const top of ['components', 'pages', 'app', 'src', 'lib', 'hooks']) {
      const dir = path.join(ROOT, top);
      if (fs.existsSync(dir)) walk(dir);
    }
    expect(consumers.length).toBeGreaterThan(0);
    for (const file of consumers) {
      const src = fs.readFileSync(file, 'utf8');
      expect(src).not.toMatch(/getImageProps/);
      const tags = src.match(/<Image\b[^>]*>/g) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      for (const tag of tags) {
        const m = tag.match(/\bsrc=(\{[^}]*\}|"[^"]*"|'[^']*')/);
        expect({ file: path.relative(ROOT, file), tag, src: m?.[1] })
          .toEqual({ file: path.relative(ROOT, file), tag, src: expect.stringMatching(/^["']\/[^/]/) });
      }
    }
  });
});

export {};
