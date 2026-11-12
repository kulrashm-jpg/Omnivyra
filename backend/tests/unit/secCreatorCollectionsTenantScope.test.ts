/**
 * SECURITY (2026-11-11): creator-template collections could REFERENCE another
 * tenant's user template (add / cover / reorder / evolution-replace / create
 * took template ids unchecked), and member resolution read user templates by id
 * ALONE - so company A could read company B's full template through A's own
 * collection. Now: an introduced id must be a platform (ownership 'system')
 * template or the collection company's own; resolution never returns another
 * tenant's template (also neutralising ids already stored); and a user template
 * registered at runtime in this process is NOT treated as "system".
 */
const CO_A = '00000000-0000-4000-8000-0000000000aa';
const CO_B = '00000000-0000-4000-8000-0000000000bb';
const SYS = 'sys-image-headline';

type Row = Record<string, unknown>;
let db: Record<string, Row[]> = {};

jest.mock('../../db/supabaseClient', () => ({
  supabase: {
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      let op: 'select' | 'update' | 'insert' = 'select';
      let payload: Row | null = null;
      const match = (r: Row) => eqs.every(([c, v]) => r[c] === v);
      const run = () => {
        const rows = db[table] ?? (db[table] = []);
        if (op === 'insert') { const row = { id: `${table}-${rows.length + 1}`, ...payload }; rows.push(row); return [row]; }
        const hits = rows.filter(match);
        if (op === 'update') hits.forEach((h) => Object.assign(h, payload));
        return hits;
      };
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.order = () => b;
      b.eq = (c: string, v: unknown) => { eqs.push([c, v]); return b; };
      b.update = (p: Row) => { op = 'update'; payload = p; return b; };
      b.insert = (p: Row) => { op = 'insert'; payload = p; return b; };
      b.maybeSingle = async () => { const r = run(); return { data: r[0] ? { ...r[0] } : null, error: null }; };
      b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve({ data: run().map((r) => ({ ...r })), error: null }).then(ok, ko);
      return b;
    },
  },
}));

import {
  addTemplateToCollection, editCollection, reorderCollection, replaceTemplateInCollection,
  createCollectionRecord, getCollectionDetail, ForeignTemplateReferenceError,
} from '../../services/creator/collectionService';
import { registerUserTemplate, unregisterUserTemplate, getTemplateById } from '../../../lib/creator-templates';

/** A stored user template: the real hydrate() needs a full template in its json. */
function userTemplateRow(id: string, company: string, name: string): Row {
  const base = JSON.parse(JSON.stringify(getTemplateById(SYS)));
  return { id, company_id: company, name, template_json: { ...base, id, name, ownership: 'user' }, ...{} };
}
function collectionRow(id: string, company: string, templateIds: string[]): Row {
  return {
    id, company_id: company, name: `coll-${id}`, category: 'x', description: '', brand_style: 'x', status: 'active', version: 1,
    owner_user_id: 'u', template_ids: templateIds,
    collection_json: {
      id, name: `coll-${id}`, category: 'x', description: '', brandStyle: 'x', status: 'active', version: 1, ownerUserId: 'u',
      ownership: 'user', templateIds, preview: { coverTemplateId: templateIds[0] ?? null, coverUrl: null }, metadata: {}, tags: [],
    },
  };
}

beforeEach(() => {
  db = {
    creator_user_templates: [userTemplateRow('ut-a', CO_A, 'A template'), userTemplateRow('ut-b', CO_B, 'B SECRET TEMPLATE')],
    creator_template_collections: [collectionRow('col-a', CO_A, [SYS])],
  };
});

const membersOf = (id: string) => ((db.creator_template_collections.find((c) => c.id === id)!.collection_json as Row).templateIds as string[]);

describe("company A cannot reference company B's template", () => {
  it.each([
    ['add', () => addTemplateToCollection('col-a', 'ut-b')],
    ['evolution replace', () => replaceTemplateInCollection('col-a', SYS, 'ut-b')],
  ])('%s with B\'s template id is REFUSED and nothing is stored', async (_l, run) => {
    await expect(run()).rejects.toBeInstanceOf(ForeignTemplateReferenceError);
    expect(membersOf('col-a')).toEqual([SYS]);
  });

  it("cover with B's template id is IGNORED (the library only accepts an existing member as cover)", async () => {
    await editCollection('col-a', { coverTemplateId: 'ut-b' } as never);
    const cj = db.creator_template_collections[0].collection_json as { preview: { coverTemplateId: string } };
    expect(cj.preview.coverTemplateId).toBe(SYS);
    expect(membersOf('col-a')).toEqual([SYS]);
  });

  it("create with B's template id is REFUSED and no collection is inserted", async () => {
    await expect(createCollectionRecord({ companyId: CO_A, ownerUserId: 'u', templateIds: ['ut-b'] } as never))
      .rejects.toBeInstanceOf(ForeignTemplateReferenceError);
    expect(db.creator_template_collections).toHaveLength(1);
  });

  it('reorder cannot smuggle a foreign id in', async () => {
    await expect(reorderCollection('col-a', [SYS, 'ut-b'])).resolves.not.toBeNull().catch(() => undefined);
    expect(membersOf('col-a')).not.toContain('ut-b');
  });
});

describe('resolution never returns another tenant\'s template', () => {
  it('an ALREADY-STORED foreign id resolves to nothing in the collection detail', async () => {
    db.creator_template_collections[0] = collectionRow('col-a', CO_A, [SYS, 'ut-b']);
    const detail = await getCollectionDetail('col-a');
    expect(detail).not.toBeNull();
    expect(JSON.stringify(detail!.templates)).not.toContain('B SECRET TEMPLATE');
    expect(detail!.templates.map((t) => t.id)).toEqual([SYS]);
  });

  it("a B template REGISTERED at runtime in this process is not treated as 'system'", async () => {
    const b = { ...getTemplateById(SYS)!, id: 'ut-b', name: 'B SECRET TEMPLATE', ownership: 'user' as const };
    registerUserTemplate(b as never);
    try {
      await expect(addTemplateToCollection('col-a', 'ut-b')).rejects.toBeInstanceOf(ForeignTemplateReferenceError);
      db.creator_template_collections[0] = collectionRow('col-a', CO_A, [SYS, 'ut-b']);
      const detail = await getCollectionDetail('col-a');
      expect(JSON.stringify(detail!.templates)).not.toContain('B SECRET TEMPLATE');
    } finally {
      unregisterUserTemplate('ut-b');
    }
  });
});

describe('same-tenant and platform templates still work', () => {
  it("A adds its OWN template and it resolves", async () => {
    const updated = await addTemplateToCollection('col-a', 'ut-a');
    expect(updated).not.toBeNull();
    expect(membersOf('col-a')).toEqual([SYS, 'ut-a']);
    const detail = await getCollectionDetail('col-a');
    expect(detail!.templates.map((t) => t.id)).toEqual([SYS, 'ut-a']);
  });
});
