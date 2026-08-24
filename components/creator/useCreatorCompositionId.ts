'use client';

/**
 * The identity of the Creator draft currently being composed.
 *
 * `composition_asset_references` identifies its owner by a TYPE plus an ID
 * rather than a foreign key, precisely because no canonical composition table
 * exists yet. Content Creator therefore needs a stable id for "the design I am
 * working on right now", and this is it.
 *
 * Two sources, in order:
 *
 *   1. A launch session token (`?session=…`), when Content Creator was opened
 *      from Writer's "Add Asset". That token already identifies this piece of
 *      work end-to-end, so reusing it keeps one draft to one composition rather
 *      than minting a second identity for the same thing.
 *
 *   2. Otherwise a token minted once per creator type and kept in
 *      sessionStorage — the same mechanism `CreatorAttachmentSession` and the
 *      template gallery's own selection already use.
 *
 * Only the IDENTIFIER lives client-side. The attachments themselves are
 * server-persisted and tenant-scoped, which is what lets the selection survive
 * a trip to the template gallery: the panel re-reads by this key rather than
 * carrying the asset around in component state.
 */

import React from 'react';
import { useRouter } from 'next/router';
import {
  creatorCompositionKey,
  mintCreatorCompositionId,
} from '../../lib/content/creatorCompositionAsset';

export function useCreatorCompositionId(creatorType: string | null | undefined): string | null {
  const router = useRouter();
  const [compositionId, setCompositionId] = React.useState<string | null>(null);

  const sessionToken = typeof router.query.session === 'string' && router.query.session.trim()
    ? router.query.session.trim()
    : null;

  React.useEffect(() => {
    if (!router.isReady || !creatorType) return;

    // A writer launch already has an identity for this work. Reuse it.
    if (sessionToken) { setCompositionId(sessionToken); return; }

    const key = creatorCompositionKey(creatorType);
    try {
      const existing = window.sessionStorage.getItem(key);
      if (existing && existing.trim()) { setCompositionId(existing.trim()); return; }
      const minted = mintCreatorCompositionId(
        creatorType,
        Date.now(),
        Math.random().toString(36).slice(2, 8),
      );
      window.sessionStorage.setItem(key, minted);
      setCompositionId(minted);
    } catch {
      // Private mode / storage disabled: the panel simply does not offer
      // uploads rather than minting an id that cannot survive navigation and
      // would strand references the user could never see again.
      setCompositionId(null);
    }
  }, [router.isReady, creatorType, sessionToken]);

  return compositionId;
}
