// Mock supabase so importing the service (which inits the client at module load) is safe;
// we only exercise the PURE selector here (no DB).
jest.mock('../../db/supabaseClient', () => ({ supabase: { from: () => ({}) } }));
import { listTemplatesForFamily } from '../../../lib/creator-templates';
import { selectTemplateFromPool, type CampaignTemplatePool } from '../../services/creator/campaignDesignSystemService';

const carousels = listTemplatesForFamily('carousel').slice(0, 3);
const pool: CampaignTemplatePool = { collectionId: 'c1', byFamily: new Map([['carousel', carousels]]) };
const ctx = { contentType: 'carousel', objective: 'awareness', platform: 'linkedin' };

describe('Campaign per-piece template selection (selectTemplateFromPool)', () => {
  it('picks one of the campaign templates for the asset family', () => {
    expect(carousels.length).toBeGreaterThan(0);
    const sel = selectTemplateFromPool(pool, 'carousel', ctx);
    expect(sel).not.toBeNull();
    expect(carousels.map((t) => t.id)).toContain(sel!.templateId);
    expect(sel!.template.assetFamily).toBe('carousel');
    expect(sel!.candidateCount).toBe(carousels.length);
    expect(sel!.source).toBe('recommended');
  });

  it('returns null when the family is not covered by the pool', () => {
    expect(selectTemplateFromPool(pool, 'image', ctx)).toBeNull();
  });

  it('is deterministic — same context yields the same pick', () => {
    const a = selectTemplateFromPool(pool, 'carousel', ctx);
    const b = selectTemplateFromPool(pool, 'carousel', ctx);
    expect(a!.templateId).toBe(b!.templateId);
  });

  it('an empty pool family yields null (caller falls back to today’s flow)', () => {
    const empty: CampaignTemplatePool = { collectionId: 'c1', byFamily: new Map([['carousel', []]]) };
    expect(selectTemplateFromPool(empty, 'carousel', ctx)).toBeNull();
  });
});
