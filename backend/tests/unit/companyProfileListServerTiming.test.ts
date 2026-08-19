/**
 * /api/company-profile?mode=list — Server-Timing attribution.
 *
 * The endpoint ranged 2,423ms → 20,939ms across six equivalent production
 * loads with no way to attribute the spread. These assert the route wires the
 * same helper already proven on /api/reports, that the stages cover the
 * sequential DB work, and that nothing about behaviour moved.
 *
 * Header emission itself is covered by serverTiming's own tests; these pin the
 * wiring at this call site.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.resolve(__dirname, '../../../pages/api/company-profile/index.ts'), 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const listBlock = () => {
  const start = CODE.indexOf("if (mode === 'list')");
  const end = CODE.indexOf('const access = await resolveCompanyAccess');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return CODE.slice(start, end);
};

describe('A — mode=list behaviour is unchanged', () => {
  const block = listBlock();

  it('response contract still carries every field', () => {
    ['userId: user.id', 'userName: resolvedUserName', 'activeCompanyId: resolvedActiveCompanyId',
     'companies: companyIds.map', 'rolesByCompany'].forEach((f) => expect(block).toContain(f));
  });

  it('the profile fallback is still conditional — no query when names are present', () => {
    expect(block).toContain('const idsNeedingFallbackName = companyIds.filter((id) => !companyById.get(id)?.name);');
    expect(block).toContain('if (idsNeedingFallbackName.length) {');
  });

  it('the fallback stays parallel — Promise.all was wrapped, not unrolled', () => {
    expect(block).toContain("timeStage(res, 'fallback', () => Promise.all(");
  });

  it('tenant filtering and membership logic are untouched', () => {
    expect(block).toContain('filterCompatibleCompanyRoleRows({');
    expect(block).toContain(".eq('status', 'active')");
  });
});

describe('B — instrumentation labels', () => {
  const block = listBlock();

  it.each(['auth', 'user', 'roles', 'companies', 'fallback'])('wraps the %s stage', (label) => {
    expect(block).toContain(`timeStage(res, '${label}',`);
  });

  it('emits total on the success exit and the roles-failure exit', () => {
    expect(block.match(/appendServerTiming\(res, 'total', Date\.now\(\) - listStart\);/g) || []).toHaveLength(2);
  });

  it('imports the shared helper rather than a new mechanism', () => {
    expect(CODE).toContain("import { appendServerTiming, timeStage } from '../../../lib/platform/serverTiming';");
  });

  it('each stage is wrapped exactly once', () => {
    ['auth', 'user', 'roles', 'companies', 'fallback'].forEach((label) => {
      expect(CODE.split(`timeStage(res, '${label}'`).length - 1).toBe(1);
    });
  });
});

describe('C — non-list paths unaffected', () => {
  it('no timing calls were added after the mode=list block', () => {
    const tail = CODE.slice(CODE.indexOf('const access = await resolveCompanyAccess'));
    expect(tail).not.toContain('timeStage(');
    expect(tail).not.toContain('appendServerTiming(');
  });

  it('the single-company GET path still resolves access before reading the profile', () => {
    expect(CODE).toContain('const access = await resolveCompanyAccess(req, res, companyId);');
    expect(CODE).toContain('if (!access) return;');
  });
});
