-- Creator Render Ops Audit — additive immutable operator action log
--
-- PURE ADDITIVE. Every operator action taken in the render operations
-- console (governance change / provider control / queue retry-cancel)
-- writes ONE immutable audit row here. Reuses the existing
-- raise_ledger_immutable convention (append-only, evidential). No
-- financial truth, no lineage mutation, no scheduler change.

CREATE TABLE IF NOT EXISTS public.creator_render_ops_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor         text NOT NULL,                 -- operator identity (session-derived)
  action        text NOT NULL
    CHECK (action IN (
      'governance.set','provider.disable','provider.maintenance',
      'provider.priority','queue.retry','queue.cancel'
    )),
  target        text,                          -- org id / provider key / queue job id
  outcome       text NOT NULL DEFAULT 'applied'
    CHECK (outcome IN ('applied','rejected','noop')),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS creator_render_ops_audit_immutable_update ON public.creator_render_ops_audit;
CREATE TRIGGER creator_render_ops_audit_immutable_update
  BEFORE UPDATE ON public.creator_render_ops_audit
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

DROP TRIGGER IF EXISTS creator_render_ops_audit_immutable_delete ON public.creator_render_ops_audit;
CREATE TRIGGER creator_render_ops_audit_immutable_delete
  BEFORE DELETE ON public.creator_render_ops_audit
  FOR EACH ROW EXECUTE FUNCTION public.raise_ledger_immutable();

CREATE INDEX IF NOT EXISTS idx_croa_actor  ON public.creator_render_ops_audit(actor, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_croa_action ON public.creator_render_ops_audit(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_croa_target ON public.creator_render_ops_audit(target, created_at DESC);
