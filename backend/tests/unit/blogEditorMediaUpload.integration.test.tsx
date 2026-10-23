/**
 * @jest-environment jsdom
 */
import React from 'react';
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { BlogEditorForm } from '../../../components/blog/BlogEditorFormMain';

jest.mock('@dnd-kit/core', () => {
  const ReactModule = require('react');
  const passthrough = ({ children }: { children: React.ReactNode }) => ReactModule.createElement('div', null, children);
  return {
    DndContext: passthrough,
    DragOverlay: passthrough,
    KeyboardSensor: class KeyboardSensor {},
    PointerSensor: class PointerSensor {},
    closestCenter: jest.fn(),
    useSensor: jest.fn(),
    useSensors: jest.fn(),
  };
});

jest.mock('@dnd-kit/sortable', () => {
  const ReactModule = require('react');
  return {
    SortableContext: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('div', null, children),
    arrayMove: jest.fn(),
    sortableKeyboardCoordinates: jest.fn(),
    verticalListSortingStrategy: jest.fn(),
  };
});

jest.mock('../../../components/content/blocks', () => {
  const ReactModule = require('react');
  const Empty = () => null;
  return {
    BlockWrapper: ({ children }: { children: React.ReactNode }) => ReactModule.createElement('div', null, children),
    BlockPicker: Empty,
    ParagraphBlockEditor: Empty,
    HeadingBlockEditor: Empty,
    KeyInsightsBlockEditor: Empty,
    CalloutBlockEditor: Empty,
    QuoteBlockEditor: Empty,
    ImageBlockEditor: ({ assetActions }: { assetActions?: { onUpload?: () => void } }) =>
      ReactModule.createElement('button', { type: 'button', onClick: assetActions?.onUpload }, 'Upload blog image'),
    MediaBlockEditor: Empty,
    DividerBlockEditor: Empty,
    ListBlockEditor: Empty,
    ReferencesBlockEditor: Empty,
    InternalLinkBlockEditor: Empty,
    SummaryBlockEditor: Empty,
    ColumnsBlockEditor: Empty,
    CreatorAssetBlockEditor: Empty,
    ImageStockSearchPopover: Empty,
  };
});

jest.mock('../../../components/blog/BlogArticleLayout', () => ({
  BlogMasthead: () => null,
  BlogHeroImage: () => null,
  BlogArticleBody: () => null,
  estimateReadMins: () => 1,
}));

jest.mock('../../../components/CompanyContext', () => ({
  useCompanyContext: () => ({ selectedCompanyId: 'company-a' }),
}));

jest.mock('../../../lib/content/longformEmptyImagePolicy', () => ({
  getEmptyImagePolicy: () => 'empty',
}));

jest.mock('../../../lib/supabaseBrowser', () => ({
  getSupabaseBrowser: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-a' } } }) },
  }),
}));

describe('Blog Editor shared media upload integration', () => {
  it('sends the image and authenticated user without mislabeling the company as a campaign', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      json: async () => ({ data: { file_url: 'https://media.example/blog.png' } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const image = new File(['image'], 'blog.png', { type: 'image/png' });
    jest.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function click(this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { configurable: true, value: [image] });
      void this.onchange?.(new Event('change'));
    });

    render(
      <BlogEditorForm
        initial={{
          content_blocks: [{ id: 'image-1', type: 'image', url: '', alt: '' }],
        }}
        onSubmit={async () => undefined}
        onCancel={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Upload blog image' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = request.body as FormData;

    expect(url).toBe('/api/media/upload');
    expect(request.method).toBe('POST');
    expect(body.get('file')).toBe(image);
    expect(body.get('user_id')).toBe('user-a');
    expect(body.get('platform')).toBe('blog');
    expect(body.has('campaign_id')).toBe(false);
  });
});
