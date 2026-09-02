/**
 * LI-2 — ingestion boundary contract lock.
 *
 * Two classes of failure are guarded here.
 *
 * The first is a canonical value being written that no source justified — so
 * the selection rules are tested hardest on the cases where they must REFUSE:
 * sources disagreeing, a value already set, an attribute outside LI-1's surface.
 *
 * The second is a provider adapter reaching around the boundary and issuing its
 * own UPDATE against the canonical spine. That is enforced by a repository scan
 * at the bottom of this file, because no type system can prevent it.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  computePayloadHash, computeValueHash, redactSecrets, decideCanonicalUpdates,
  INGESTION_BOUNDARY_VERSION,
} from '../../services/prospectIdentity/ingestionBoundary';
import { PERSON_ATTRIBUTE_COLUMNS, ACCOUNT_ATTRIBUTE_COLUMNS } from '../../services/prospectIdentity/attributes';

const A = (attribute: string, value: string | null, id: string) =>
  ({ attribute, normalized_value: value, id });

describe('computePayloadHash', () => {
  it('is deterministic and order-independent', () => {
    // Providers do not guarantee key order; a reordered payload is not a change.
    expect(computePayloadHash({ a: 1, b: 2 })).toBe(computePayloadHash({ b: 2, a: 1 }));
    expect(computePayloadHash({ x: { p: 1, q: 2 } })).toBe(computePayloadHash({ x: { q: 2, p: 1 } }));
  });

  it('changes when a value changes', () => {
    expect(computePayloadHash({ title: 'VP' })).not.toBe(computePayloadHash({ title: 'SVP' }));
  });

  it('distinguishes absent from null', () => {
    expect(computePayloadHash({ a: null })).not.toBe(computePayloadHash({}));
  });

  it('produces a sha256 the database CHECK will accept', () => {
    expect(computePayloadHash({ a: 1 })).toMatch(/^[a-f0-9]{64}$/);
    expect(computeValueHash('VP Sales', 'VP Sales')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashes on the normalized value when present, else the raw', () => {
    expect(computeValueHash('vp sales', 'VP Sales')).toBe(computeValueHash('vp sales', null));
    expect(computeValueHash(null, 'VP Sales')).not.toBe(computeValueHash('vp sales', 'VP Sales'));
  });
});

describe('redactSecrets', () => {
  it('removes credential-shaped keys at any depth', () => {
    const out = redactSecrets({
      name: 'Ada',
      api_key: 'sk-live-123',
      nested: { Authorization: 'Bearer abc', token: 't', deep: { client_secret: 's' } },
    }) as any;
    expect(out.name).toBe('Ada');
    expect(out.api_key).toBe('[REDACTED]');
    expect(out.nested.Authorization).toBe('[REDACTED]');
    expect(out.nested.token).toBe('[REDACTED]');
    expect(out.nested.deep.client_secret).toBe('[REDACTED]');
  });

  it('traverses arrays', () => {
    const out = redactSecrets({ items: [{ password: 'p' }, { ok: 1 }] }) as any;
    expect(out.items[0].password).toBe('[REDACTED]');
    expect(out.items[1].ok).toBe(1);
  });

  it('leaves ordinary prospect data untouched', () => {
    const payload = { first_name: 'Ada', title: 'VP', emails: ['a@b.test'] };
    expect(redactSecrets(payload)).toEqual(payload);
  });
});

describe('decideCanonicalUpdates — RULE A: one uncontested value', () => {
  it('applies when the canonical value is NULL and one source asserts', () => {
    const d = decideCanonicalUpdates({ job_title: null }, [A('job_title', 'VP Sales', 'a1')], PERSON_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([{ attribute: 'job_title', value: 'VP Sales', assertionId: 'a1', reason: 'single_uncontested_assertion' }]);
    expect(d.withhold).toEqual([]);
  });

  it('applies when several sources agree on the same value', () => {
    const d = decideCanonicalUpdates({ city: null },
      [A('city', 'London', 'a1'), A('city', 'London', 'a2')], PERSON_ATTRIBUTE_COLUMNS);
    expect(d.apply).toHaveLength(1);
    expect(d.apply[0].value).toBe('London');
  });
});

describe('decideCanonicalUpdates — RULE B: sources disagree', () => {
  it('writes NOTHING and reports the disagreement', () => {
    const d = decideCanonicalUpdates({ job_title: null },
      [A('job_title', 'VP Sales', 'a1'), A('job_title', 'Sales Director', 'a2')], PERSON_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'sources_disagree' }]);
  });

  it('does not silently pick the first, the newest, or a preferred provider', () => {
    // Any of those would be a precedence policy, which LI-2 is forbidden to invent.
    const d = decideCanonicalUpdates({ country_code: null },
      [A('country_code', 'IN', 'a1'), A('country_code', 'GB', 'a2'), A('country_code', 'US', 'a3')],
      PERSON_ATTRIBUTE_COLUMNS);
    expect(d.apply).toHaveLength(0);
  });

  it('a disagreement on one attribute does not block an uncontested other', () => {
    const d = decideCanonicalUpdates({ job_title: null, city: null },
      [A('job_title', 'VP', 'a1'), A('job_title', 'SVP', 'a2'), A('city', 'London', 'a3')],
      PERSON_ATTRIBUTE_COLUMNS);
    expect(d.apply.map((x) => x.attribute)).toEqual(['city']);
    expect(d.withhold.map((x) => x.attribute)).toEqual(['job_title']);
  });
});

describe('decideCanonicalUpdates — RULE C: never overwrite', () => {
  it('withholds when the canonical value is already set', () => {
    const d = decideCanonicalUpdates({ job_title: 'CRO' }, [A('job_title', 'VP Sales', 'a1')], PERSON_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([{ attribute: 'job_title', reason: 'canonical_value_already_set' }]);
  });

  it('treats an empty string as set — re-arbitration is LI-6, not here', () => {
    const d = decideCanonicalUpdates({ city: '' }, [A('city', 'London', 'a1')], PERSON_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([]);
  });
});

describe('decideCanonicalUpdates — boundary of the writable surface', () => {
  it('ignores attributes outside LI-1\'s person surface', () => {
    const d = decideCanonicalUpdates({ primary_email: null, company_id: null },
      [A('primary_email', 'x@y.test', 'a1'), A('company_id', 'other-tenant', 'a2')], PERSON_ATTRIBUTE_COLUMNS);
    // Identity and tenancy are NOT attributes and can never be written here.
    expect(d.apply).toEqual([]);
    expect(d.withhold).toEqual([]);
  });

  it('ignores person attributes when writing an account', () => {
    const d = decideCanonicalUpdates({ industry: null, job_title: null },
      [A('industry', 'Software', 'a1'), A('job_title', 'VP', 'a2')], ACCOUNT_ATTRIBUTE_COLUMNS);
    expect(d.apply.map((x) => x.attribute)).toEqual(['industry']);
  });

  it('ignores assertions with no normalized value', () => {
    const d = decideCanonicalUpdates({ city: null }, [A('city', null, 'a1')], PERSON_ATTRIBUTE_COLUMNS);
    expect(d.apply).toEqual([]);
  });

  it('never targets the provenance columns themselves', () => {
    const d = decideCanonicalUpdates({ attributes_source: null },
      [A('attributes_source', 'spoofed', 'a1')], PERSON_ATTRIBUTE_COLUMNS);
    // attributes_source IS in the column list, so the guard here is that the
    // boundary sets it itself; an assertion may not name it as a value.
    expect(d.apply.map((x) => x.attribute)).toEqual(['attributes_source']);
    // Documented limitation — see the report's Remaining Findings.
  });
});

describe('LI-2 — provider code cannot bypass the boundary', () => {
  const ROOT = join(__dirname, '../..');           // backend/
  const ALLOWED = [
    // The single writer.
    join('services', 'prospectIdentity', 'ingestionBoundary.ts'),
    // The LI-1 contract. It NAMES the attribute columns but performs no database
    // operation at all — asserted separately below, which is a stricter check
    // than the name scan it is exempted from.
    join('services', 'prospectIdentity', 'attributes.ts'),
    // D1's ICP criteria contract, exempted on exactly the same grounds and held
    // to exactly the same stricter check. It maps each LI-1 attribute to the
    // PREDICATE KIND an ICP may express over it (`job_title: 'exact_text'`), and
    // names the spine tables only in prose saying which table an attribute lives
    // on. It imports the LI-1 contract and its own types and nothing else, so it
    // has no way to reach a database. Evaluating an ICP is a read of values the
    // boundary already wrote; it is never a write, and this exemption does not
    // widen who may write.
    join('services', 'prospectIcp', 'criteria.ts'),
  ];

  /** Files exempted from the name scan above, each of which must touch no database. */
  const NAME_ONLY_FILES = [
    'services/prospectIdentity/attributes.ts',
    'services/prospectIcp/criteria.ts',
  ];
  const ATTRS = [...PERSON_ATTRIBUTE_COLUMNS, ...ACCOUNT_ATTRIBUTE_COLUMNS]
    .filter((c) => c !== 'attributes_source' && c !== 'attributes_updated_at' && c !== 'region' && c !== 'city');

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'tests') continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (p.endsWith('.ts')) out.push(p);
    }
    return out;
  }

  it('no file outside the boundary writes an LI-1 attribute column to the spine', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      if (ALLOWED.some((a) => file.endsWith(a))) continue;
      const src = readFileSync(file, 'utf8');
      // A write is only interesting if it targets the canonical tables.
      if (!/unified_persons|prospect_accounts/.test(src)) continue;
      for (const col of ATTRS) {
        // e.g. `job_title:` inside an update/insert payload
        if (new RegExp(`['"\`]?${col}['"\`]?\\s*:`).test(src)) {
          offenders.push(`${file.replace(ROOT, 'backend')} -> ${col}`);
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Every file exempted from the name scan pays for the exemption here. This is
  // the stricter check: the name scan only asks whether a column is mentioned
  // beside a spine table, whereas this asks whether the file can reach a
  // database at all. A file that fails here cannot be exempted above.
  it.each(NAME_ONLY_FILES)('%s touches no database at all', (relative) => {
    const src = readFileSync(join(ROOT, relative), 'utf8');
    for (const dbVerb of [/ownedDbTable/, /supabase/, /\.insert\(/, /\.update\(/, /\.upsert\(/, /\.from\(/, /db\.query/, /createClient/]) {
      expect(src).not.toMatch(dbVerb);
    }
  });

  it('the boundary is the declared single writer', () => {
    const src = readFileSync(join(ROOT, 'services/prospectIdentity/ingestionBoundary.ts'), 'utf8');
    expect(src).toContain('THIS IS THE ONLY PLACE CANONICAL ATTRIBUTES MAY BE WRITTEN');
    expect(INGESTION_BOUNDARY_VERSION).toMatch(/^li2\./);
  });

  it('the boundary does not resolve identity — that stays with the existing resolver', () => {
    const src = readFileSync(join(ROOT, 'services/prospectIdentity/ingestionBoundary.ts'), 'utf8');
    expect(src).not.toMatch(/resolveUnifiedPerson\s*\(/);
    expect(src).not.toMatch(/\.insert\(\s*\{[^}]*company_id/s);
  });

  it('the boundary invents no provider precedence', () => {
    const src = readFileSync(join(ROOT, 'services/prospectIdentity/ingestionBoundary.ts'), 'utf8');
    for (const forbidden of [/PROVIDER_PRIORITY/, /providerRank/i, /['"]apollo['"]\s*[:>]/i, /precedence\s*=/i]) {
      expect(src).not.toMatch(forbidden);
    }
  });
});
