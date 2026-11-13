/**
 * UI D6 (owner rules 1 + 3): the BOLT Text form shows the primary fields first (Topic,
 * Duration, Platforms, Start date, Generate) and folds everything else under "More
 * options". The fold is presentation only: it never touches form state, so the payload
 * the hook builds is unchanged; the defaults stay exactly as they were.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { insideWriteGate } from '../helpers/writeGateScan';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const V = read('components/BoltStrategyViewMain.tsx');
const H = read('hooks/useBoltStrategy.tsx');

describe('BOLT Text form fold (D6)', () => {
  it('parses', () => {
    const out = ts.transpileModule(V, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve }, fileName: 'v.tsx' });
    expect((out.diagnostics ?? []).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))).toEqual([]);
  });
  it('folded by default, with a toggle and a summary', () => {
    expect(V).toMatch(/const \[showMore, setShowMore\] = useState\(false\);/);
    expect(V).toContain('data-testid="bolt-more-options"');
    expect(V).toContain('Using defaults for goal, tone, focus, formats, ideas source, sharing and where to open after launch.');
  });
  it.each([
    ['Description', '{/* Description — optional', 'showDetails'],
    ['Goal', '{/* Goal — multi-select chips. */}', 'showDetails'],
    ['Tone', '{/* Tone — multi-select chips. */}', 'showDetails'],
    ['Audience', '{/* Audience — free-form textarea. */}', 'showDetails'],
    ['Strategic Focus', '>Strategic Focus</label>', 'showMore'],
    ['Offerings', '>Offerings / Products</', 'showMore'],
    ['Content Format', 'Content Format <span', 'showMore'],
    ['Intelligence Source', '>Intelligence Source</label>', 'showMore'],
    ['Content Sharing', '>Content Sharing</label>', 'showMore'],
    ['View In', '>View In</label>', 'showMore'],
  ])('%s is folded', (_name, marker, gate) => {
    expect(insideWriteGate(V, marker, gate)).toBe(true);
  });
  it.each([
    ['Topic', 'Campaign Topic <span'],
    ['Duration', '>Duration</label>'],
    ['Platforms', '<BoltPlatformPicker'],
    ['Start date', 'htmlFor="bolt-start-date"'],
    ['Generate', 'onClick={handleGenerate}'],
  ])('%s stays visible', (_name, marker) => {
    expect(insideWriteGate(V, marker, 'showMore')).toBe(false);
    expect(insideWriteGate(V, marker, 'showDetails')).toBe(false);
  });
  it('the brief section receives the fold from the page', () => {
    expect(V).toMatch(/showDetails=\{showMore\}/);
  });
  it('presentation only: the hook (payload owner) knows nothing about the fold, and the defaults are unchanged', () => {
    expect(H).not.toMatch(/showMore|showDetails/);
    expect(H).toMatch(/useState<ThemeSource>\('hybrid'\)/);
    expect(H).toMatch(/useState<SharingMode>\('ai'\)/);
    expect(H).toMatch(/useState<OutcomeView>\('week_plan'\)/);
    expect(H).toMatch(/const \[duration, setDuration\] = useState\(4\);/);
    expect(H).toMatch(/const canGenerate = topic\.trim\(\)\.length > 2;/);
  });
  it('responsive: the two columns stack below lg (the right column was a fixed 36%)', () => {
    expect(V).toContain('<div className="flex flex-col gap-5 lg:flex-row lg:items-start">');
    expect(V).toContain('<div className="w-full lg:w-[36%] lg:flex-shrink-0 flex flex-col gap-4">');
    expect(V).not.toMatch(/className="w-\[36%\] flex-shrink-0/);
  });
});
