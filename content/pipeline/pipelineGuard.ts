import type { NextApiRequest } from 'next';
import { isContentType } from '../core/contentTypes';
import { validateContentOrThrow } from '../core/contentValidator';

export function isValidContentPipelineCall(req: Pick<NextApiRequest, 'method' | 'body'>): boolean {
  if (req.method !== 'POST') return false;
  const body = req.body || {};
  const type = body.content_type || body.contentType || 'blog';
  if (body.blocks || body.content_blocks || body.contentBlocks) {
    validateContentOrThrow({
      type,
      blocks: body.blocks || body.content_blocks || body.contentBlocks,
      state: body.state || body.status || 'draft',
    });
  }
  return isContentType(type);
}

export function assertValidContentPipelineCall(req: Pick<NextApiRequest, 'method' | 'body'>): void {
  if (!isValidContentPipelineCall(req)) {
    throw new Error('Unauthorized content pipeline usage');
  }
}
