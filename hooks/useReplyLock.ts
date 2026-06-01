/**
 * useReplyLock — lightweight soft-lock for the reply composer (Batch 2).
 *
 * Acquires a non-binding lock on the thread while the composer is open so other
 * operators see "X is replying…". Heartbeats while open, releases on close /
 * thread switch / unmount. Never blocks: if another operator holds the lock the
 * caller can force-acquire (override). All failures are swallowed — the lock is
 * advisory and must never break replying.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { reqReplyLock, type ReplyLockState } from '@/features/engagement/data/engagement.api';

const HEARTBEAT_MS = 60 * 1000;

export function useReplyLock(params: {
  organizationId: string;
  threadId: string | null | undefined;
  active: boolean;
}) {
  const { organizationId, threadId, active } = params;
  const [lock, setLock] = useState<ReplyLockState | null>(null);
  const enabled = Boolean(active && organizationId && threadId);

  const override = useCallback(async () => {
    if (!organizationId || !threadId) return;
    const state = await reqReplyLock({ organizationId, threadId, action: 'acquire', force: true });
    setLock(state);
  }, [organizationId, threadId]);

  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !threadId) {
      setLock(null);
      return;
    }
    let cancelled = false;
    lastKeyRef.current = `${organizationId}:${threadId}`;

    void reqReplyLock({ organizationId, threadId, action: 'acquire' }).then((s) => {
      if (!cancelled) setLock(s);
    });

    const timer = setInterval(() => {
      void reqReplyLock({ organizationId, threadId, action: 'heartbeat' }).then((s) => {
        if (!cancelled && s) setLock(s);
      });
    }, HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      void reqReplyLock({ organizationId, threadId, action: 'release' });
    };
  }, [enabled, organizationId, threadId]);

  return { lock, override };
}
