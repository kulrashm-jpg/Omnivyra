import type { ContentRendererProps } from '../../content/render/renderer';
import { ContentRenderer } from '../../content/render/renderer';

export type { ContentRendererProps };
export { ContentRenderer };

export function BlockRenderer(props: ContentRendererProps) {
  if (process.env.NODE_ENV !== 'production') {
    console.warn('DEPRECATED: Use content/render/renderer.tsx');
  }
  return <ContentRenderer {...props} />;
}
