import {
  assertValidContentTransition,
  isValidated,
  validateContentOrThrow,
  type ContentState,
  type ValidatedContent,
} from './validateContent';
import { sanitizeBlocks } from '../engine/sanitizer';

export function markContentValidated(input: {
  type: unknown;
  blocks: unknown;
  state: ContentState;
}): ValidatedContent {
  const current = validateContentOrThrow(input);
  assertValidContentTransition(current.state, 'validated');
  return {
    ...current,
    state: 'validated',
    blocks: sanitizeBlocks(current.blocks),
  };
}

export function archiveContent(input: {
  type: unknown;
  blocks: unknown;
  state: ContentState;
}): ValidatedContent {
  const current = validateContentOrThrow(input);
  assertValidContentTransition(current.state, 'archived');
  return {
    ...current,
    state: 'archived',
    blocks: sanitizeBlocks(current.blocks),
  };
}

export function publishContent(input: {
  type: unknown;
  blocks: unknown;
  state: ContentState;
}): ValidatedContent {
  const current = validateContentOrThrow(input);
  if (!isValidated(current)) {
    throw new Error('Cannot publish unvalidated content');
  }
  assertValidContentTransition(current.state, 'published');

  return {
    ...current,
    state: 'published',
    blocks: sanitizeBlocks(current.blocks),
  };
}
