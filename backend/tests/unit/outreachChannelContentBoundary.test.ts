/**
 * Static import boundary for lib/outreach/channelContent.
 *
 * The layer is pure content rules. It must not import an engine, a transport, a
 * provider, supabase / a database, an AI client, or anything under
 * leadOutreachExecution, communityAi*, whatsapp* or rpa*. This reads the source
 * files (no module loading) and fails on any forbidden specifier. It also
 * enforces an allow-list, and checks that the approved reuse modules themselves
 * import nothing, so the boundary holds transitively.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..', '..');
const LAYER = path.join(ROOT, 'lib', 'outreach', 'channelContent');

/** Reuse targets, as repo-relative paths without extension. */
const APPROVED_EXTERNAL = new Set([
  'backend/services/emailEngine/emailContentGenerator',
  'lib/content/platformAdaptationProfiles',
  'lib/content/promotionDraft',
]);

const FORBIDDEN: ReadonlyArray<[RegExp, string]> = [
  [/supabase/i, 'supabase'],
  [/(^|\/)db(\/|$)/i, 'database module'],
  [/^(pg|postgres|ioredis|redis|bullmq|axios|node-fetch|undici|http|https|net|fs|child_process)$/, 'I/O module'],
  [/openai|anthropic|aiGateway|aiResponseCache|\/ai\//i, 'AI client'],
  [/leadOutreachExecution/i, 'leadOutreachExecution'],
  [/communityAi/i, 'communityAi*'],
  [/whatsapp/i, 'whatsapp*'],
  [/(^|\/)rpa/i, 'rpa*'],
  [/engine/i, 'engine'],
  [/transport/i, 'transport'],
  [/provider/i, 'provider'],
];

const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
}

function importsOf(src: string): string[] {
  return Array.from(stripComments(src).matchAll(SPECIFIER), (m) => m[1]);
}

/** Violations for one file's source, given that file's absolute path. */
function violationsFor(file: string, src: string): string[] {
  const out: string[] = [];
  for (const spec of importsOf(src)) {
    const resolved = spec.startsWith('.')
      ? path.relative(ROOT, path.resolve(path.dirname(file), spec)).split(path.sep).join('/')
      : spec;
    const insideLayer = spec.startsWith('.') && path.resolve(path.dirname(file), spec).startsWith(LAYER);
    const approved = APPROVED_EXTERNAL.has(resolved);

    if (!approved) {
      for (const [re, label] of FORBIDDEN) {
        if (re.test(spec) || re.test(resolved)) out.push(`${spec} -> forbidden (${label})`);
      }
    }
    if (!insideLayer && !approved) out.push(`${spec} -> not in the allow-list`);
  }
  return out;
}

function layerFiles(): string[] {
  return fs.readdirSync(LAYER).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(LAYER, f));
}

describe('outreach channelContent import boundary', () => {
  const files = layerFiles();

  it('finds the layer files and their imports (the guard is not vacuous)', () => {
    expect(files.length).toBeGreaterThanOrEqual(7);
    const all = files.flatMap((f) => importsOf(fs.readFileSync(f, 'utf8')));
    expect(all).toEqual(expect.arrayContaining([
      '../../../backend/services/emailEngine/emailContentGenerator',
      '../../content/platformAdaptationProfiles',
    ]));
  });

  it.each(layerFiles().map((f) => [path.basename(f), f]))('%s imports nothing forbidden', (_name, file) => {
    expect(violationsFor(file, fs.readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('approved reuse modules import nothing (boundary holds transitively)', () => {
    for (const rel of APPROVED_EXTERNAL) {
      const src = fs.readFileSync(path.join(ROOT, `${rel}.ts`), 'utf8');
      expect({ rel, imports: importsOf(src) }).toEqual({ rel, imports: [] });
    }
  });

  it('the checker rejects each forbidden kind of import', () => {
    const file = path.join(LAYER, 'probe.ts');
    const probes = [
      "import { supabase } from '../../../backend/db/supabaseClient';",
      "import x from '../../../backend/services/leadOutreachExecution/dispatch';",
      "import x from '../../../backend/services/communityAiActionExecutor';",
      "import x from '../../../backend/services/whatsappTemplateService';",
      "import x from '../../../backend/services/rpaWorker';",
      "import OpenAI from 'openai';",
      "const t = require('../../../backend/services/leadOutreachExecution/internalTransport');",
      "export { y } from '../../../backend/services/emailEngine/emailSender';",
      "import p from '../../../lib/someProvider';",
      "const m = await import('../../../backend/services/aiGateway');",
    ];
    for (const probe of probes) {
      expect({ probe, rejected: violationsFor(file, probe).length > 0 }).toEqual({ probe, rejected: true });
    }
    expect(violationsFor(file, "import { a } from './types';")).toEqual([]);
  });
});
