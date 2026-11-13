/**
 * Structural guard for pages/api/response/rules.ts (05, 2026-11-13). On the S2 branch this route goes through the
 * tenant seam, which makes the organization predicate impossible to forget. The main-native fast-track uses raw
 * `supabase.from(...)` with an explicit `.eq('organization_id', organizationId)` per call site - correct today, but a
 * future fifth read would have nothing stopping it. This scan pins it: EVERY response_rules / response_templates
 * statement in the file carries the authorized-org predicate (or, for the insert, stamps organization_id).
 */
import fs from 'fs';
import path from 'path';

const FILE = path.resolve(__dirname, '../../../pages/api/response/rules.ts');

/** Each `.from('<table>')` statement: from the call to the end of its chain (the next `;`). */
function statements(src: string): Array<{ table: string; text: string; line: number }> {
  const out: Array<{ table: string; text: string; line: number }> = [];
  const re = /\.from\(\s*['"](response_rules|response_templates)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf(';', m.index);
    out.push({ table: m[1], text: src.slice(m.index, end === -1 ? undefined : end), line: src.slice(0, m.index).split('\n').length });
  }
  return out;
}
const scoped = (text: string) =>
  /\.eq\(\s*['"]organization_id['"]\s*,\s*organizationId\s*\)/.test(text) || /\.insert\(\{[\s\S]*?organization_id:\s*organizationId\b/.test(text);

describe('response/rules: every rules/templates statement is bound to the authorized organization', () => {
  const src = fs.readFileSync(FILE, 'utf8');
  const stmts = statements(src);

  it('POSITIVE CONTROL: the scan sees exactly the four statements (rules list, template names, ownership read, insert)', () => {
    expect(stmts.map((s) => s.table)).toEqual(['response_rules', 'response_templates', 'response_templates', 'response_rules']);
  });

  it('each one carries the organization predicate (a new unscoped read fails here)', () => {
    const unscoped = stmts.filter((s) => !scoped(s.text)).map((s) => `${s.table} at rules.ts:${s.line}`);
    expect(unscoped).toEqual([]);
  });

  it('NEGATIVE CONTROL: the predicate check rejects an unscoped statement of the same shape', () => {
    expect(scoped(".from('response_templates').select('id, template_name').in('id', ids)")).toBe(false);
    expect(scoped(".from('response_rules').insert({ platform, intent_type, template_id })")).toBe(false);
  });
});
