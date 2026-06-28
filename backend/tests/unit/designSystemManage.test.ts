import { toggleMemberSet, memberOp, buildManageGalleryHref } from '../../../lib/creator-templates/designSystemManage';

describe('Design System management glue (CREATOR-030)', () => {
  it('toggleMemberSet adds an absent id and removes a present one (immutably)', () => {
    const base = new Set(['a', 'b']);
    const added = toggleMemberSet(base, 'c');
    expect([...added].sort()).toEqual(['a', 'b', 'c']);
    expect([...base].sort()).toEqual(['a', 'b']); // original untouched
    const removed = toggleMemberSet(base, 'a');
    expect([...removed].sort()).toEqual(['b']);
  });

  it('memberOp maps membership → collection PATCH op', () => {
    expect(memberOp(true)).toBe('remove');
    expect(memberOp(false)).toBe('add');
  });

  it('buildManageGalleryHref opens the canonical gallery in campaign mode, scoped to the family', () => {
    const link = buildManageGalleryHref({ family: 'carousel', collectionId: 'col1', campaignId: 'camp1', returnTo: '/campaign-planner?tab=design' });
    expect(link.pathname).toBe('/command-center/creator-content/carousel/templates');
    expect(link.query).toEqual({ collection_id: 'col1', campaign_id: 'camp1', return_to: '/campaign-planner?tab=design' });
  });

  it('family filtering: each supported family maps to its own gallery route', () => {
    expect(buildManageGalleryHref({ family: 'image', collectionId: 'c' }).pathname).toBe('/command-center/creator-content/image/templates');
    expect(buildManageGalleryHref({ family: 'infographic', collectionId: 'c' }).pathname).toBe('/command-center/creator-content/infographic/templates');
  });

  it('campaign mode requires only collection_id (campaign_id / return_to optional)', () => {
    const link = buildManageGalleryHref({ family: 'image', collectionId: 'c' });
    expect(link.query).toEqual({ collection_id: 'c' });
  });
});
