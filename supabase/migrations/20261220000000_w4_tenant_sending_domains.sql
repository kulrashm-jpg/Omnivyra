-- W4 — tenant sending domains (Model A: Omnivyra-managed SES, tenant-owned domains).
--
-- DRAFT. Not applied anywhere. Applying it needs its own authorization (see
-- the PR #281 migration discipline: no deploy mechanism applies migrations).
--
-- WHAT IT HOLDS. One row per domain a tenant has asked to send from. The row
-- records the SES domain identity's state in `eu-north-1`, the three Easy DKIM
-- tokens the tenant publishes as CNAMEs, and the per-tenant configuration set
-- that routes that tenant's delivery, bounce and complaint events.
--
-- OWNERSHIP IS NOT STORED HERE. A sending domain must equal, or be a subdomain
-- of, a `company_domains.final_domain` that the SAME tenant has verified
-- (`verification_status` IN ('verified', 'admin_override')). `company_domains`
-- has no `UNIQUE (id, company_id)`, so a composite foreign key into it is not
-- possible without altering that table; ownership is therefore re-checked by the
-- application at registration AND at every sender validation, so a lapsed
-- website verification also stops sending.
--
-- ONE TENANT PER DOMAIN. An SES identity is global to the AWS account, so two
-- tenants can never both hold `acme.com`. The partial unique index below makes
-- that a database fact. A removed row frees the domain only once its SES
-- identity is no longer `delete_pending`.
--
-- SES IDENTITY LIFECYCLE (`ses_identity_state`). What Omnivyra knows about the
-- identity behind the row — never inferred from the row's existence:
--   none            no identity associated (create unconfirmed, or REFUSED)
--   created         SES confirmed a create made with the tenant's set
--   adopted         an existing identity reported EXACTLY the tenant's set
--   delete_pending  row removed; identity queued for deletion (retryable)
--   deleted         Omnivyra deleted it (terminal)
--   missing         observed ABSENT — not "we deleted it"
-- Transitions are enforced by `tenant_sending_domains_identity_guard` and must
-- stay identical to SES_IDENTITY_TRANSITIONS in sendingDomainRules.ts:
--   none           → created | adopted | missing
--   created        → delete_pending | missing
--   adopted        → delete_pending | missing
--   missing        → created | adopted
--   delete_pending → deleted | missing
--   deleted        → (terminal)
-- `deleted` requires `ses_delete_attempted_at`: a NotFound answer to a delete
-- counts as "deleted by us" only after this row recorded its own attempt.
-- NO ROW AUTHORIZES A DELETION BY ITSELF: a future DeleteEmailIdentity must
-- also reject reserved domains and re-read SES (DOMAIN identity, exact tenant
-- configuration set) — `deletionPreconditionFailure` in sendingDomainRules.ts.
--
-- COMPANY DELETION: ON DELETE RESTRICT. A CASCADE would drop the row and
-- silently orphan a live SES identity. Companies are soft-deleted in the
-- product (`soft_delete_company` → status 'inactive' + `deleted_at`), which
-- this does not affect, and hard tenant DELETE is already blocked by data
-- (ratified PI-ADR-005 J-1: "Tenant offboarding is a controlled workflow, not a
-- DELETE"). Person erasure deletes `unified_persons` only and is unaffected. A
-- tenant with sending domains must have them removed (identities `deleted` /
-- `missing`, rows deleted) before a hard delete can succeed.

CREATE TABLE IF NOT EXISTS public.tenant_sending_domains (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.companies (id) ON DELETE RESTRICT,
  domain                  text NOT NULL,
  status                  text NOT NULL DEFAULT 'pending',
  ses_region              text NOT NULL,
  configuration_set_name  text NOT NULL,
  dkim_tokens             text[] NOT NULL DEFAULT ARRAY[]::text[],
  -- SES `DkimAttributes.SigningHostedZone`: the zone the DKIM CNAMEs point at.
  dkim_signing_hosted_zone text,
  ses_identity_state      text NOT NULL DEFAULT 'none',
  ses_identity_state_changed_at timestamptz NOT NULL DEFAULT now(),
  ses_delete_attempted_at timestamptz,
  last_error_code         text,
  last_checked_at         timestamptz,
  -- Written ONLY by a successful SES read that confirmed verification; the
  -- sender-freshness check reads it. An error never renews it.
  verified_at             timestamptz,
  removed_at              timestamptz,
  created_by              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- Lower-case hostname, at least two labels, no wildcard, no trailing dot.
  -- Must stay identical to SENDING_DOMAIN_RE in sendingDomainRules.ts.
  CONSTRAINT tenant_sending_domains_domain_normalized
    CHECK (
      domain = lower(domain)
      AND length(domain) <= 253
      AND domain ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'
    ),
  CONSTRAINT tenant_sending_domains_status_valid
    CHECK (status IN ('pending', 'verified', 'failed', 'temporary_failure', 'removed')),
  -- `removed` and `removed_at` describe the same fact; neither may exist alone.
  CONSTRAINT tenant_sending_domains_removed_coherent
    CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CONSTRAINT tenant_sending_domains_verified_coherent
    CHECK (status <> 'verified' OR verified_at IS NOT NULL),
  -- Must stay identical to SES_IDENTITY_STATES in sendingDomainRules.ts.
  CONSTRAINT tenant_sending_domains_ses_identity_state_valid
    CHECK (ses_identity_state IN ('none', 'created', 'adopted', 'delete_pending', 'deleted', 'missing')),
  -- Only an identity Omnivyra holds can make a domain verified.
  CONSTRAINT tenant_sending_domains_verified_needs_identity
    CHECK (status <> 'verified' OR ses_identity_state IN ('created', 'adopted')),
  -- Deletion is only ever entered for a removed row.
  CONSTRAINT tenant_sending_domains_deletion_needs_removal
    CHECK (ses_identity_state NOT IN ('delete_pending', 'deleted') OR status = 'removed'),
  -- "Deleted by us" needs our own recorded attempt (see header).
  CONSTRAINT tenant_sending_domains_deleted_needs_attempt
    CHECK (ses_identity_state <> 'deleted' OR ses_delete_attempted_at IS NOT NULL),
  -- SES configuration-set naming rule.
  CONSTRAINT tenant_sending_domains_config_set_valid
    CHECK (configuration_set_name ~ '^[A-Za-z0-9_-]{1,64}$'),
  CONSTRAINT tenant_sending_domains_region_not_blank
    CHECK (length(btrim(ses_region)) > 0),
  -- Easy DKIM issues exactly three tokens; never more.
  CONSTRAINT tenant_sending_domains_dkim_tokens_max
    CHECK (coalesce(array_length(dkim_tokens, 1), 0) <= 3),
  CONSTRAINT tenant_sending_domains_hosted_zone_valid
    CHECK (dkim_signing_hosted_zone IS NULL
           OR dkim_signing_hosted_zone ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'),
  -- Lets a future table reference (id, organization_id) and be tenant-checked.
  CONSTRAINT tenant_sending_domains_id_tenant UNIQUE (id, organization_id)
);

-- One owner per domain, platform-wide, while the row is live OR its identity is
-- still queued for deletion (see header).
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_sending_domains_live_domain
  ON public.tenant_sending_domains (domain)
  WHERE removed_at IS NULL OR ses_identity_state = 'delete_pending';

CREATE INDEX IF NOT EXISTS idx_tenant_sending_domains_org_live
  ON public.tenant_sending_domains (organization_id)
  WHERE removed_at IS NULL;

-- A future cleanup worker selects work by state.
CREATE INDEX IF NOT EXISTS idx_tenant_sending_domains_delete_pending
  ON public.tenant_sending_domains (ses_identity_state)
  WHERE ses_identity_state = 'delete_pending';

ALTER TABLE public.tenant_sending_domains ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public'
                    AND tablename = 'tenant_sending_domains'
                    AND policyname = 'tenant_sending_domains_service_role') THEN
    CREATE POLICY tenant_sending_domains_service_role ON public.tenant_sending_domains
      FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
  END IF;
END
$$;

-- Lifecycle guard: new rows start at 'none'; an update may only take an allowed
-- transition (same-state writes are free). Stamps the change time.
CREATE OR REPLACE FUNCTION public.tenant_sending_domains_identity_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.ses_identity_state <> 'none' THEN
      RAISE EXCEPTION 'tenant_sending_domains: a new row must start with ses_identity_state none, not %', NEW.ses_identity_state
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.ses_identity_state IS NOT DISTINCT FROM OLD.ses_identity_state THEN
    RETURN NEW;
  END IF;
  IF (OLD.ses_identity_state, NEW.ses_identity_state) IN (
    ('none', 'created'), ('none', 'adopted'), ('none', 'missing'),
    ('created', 'delete_pending'), ('created', 'missing'),
    ('adopted', 'delete_pending'), ('adopted', 'missing'),
    ('missing', 'created'), ('missing', 'adopted'),
    ('delete_pending', 'deleted'), ('delete_pending', 'missing')
  ) THEN
    NEW.ses_identity_state_changed_at := now();
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'tenant_sending_domains: ses_identity_state % -> % is not an allowed transition',
    OLD.ses_identity_state, NEW.ses_identity_state
    USING ERRCODE = '23514';
END
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_sending_domains_identity_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tenant_sending_domains_identity_guard ON public.tenant_sending_domains;
CREATE TRIGGER tenant_sending_domains_identity_guard
  BEFORE INSERT OR UPDATE OF ses_identity_state ON public.tenant_sending_domains
  FOR EACH ROW EXECUTE FUNCTION public.tenant_sending_domains_identity_guard();

COMMENT ON TABLE public.tenant_sending_domains IS
  'W4 Model A: tenant-owned sending domains as SES domain identities. One owner per domain while live or delete_pending. Ownership is re-checked against the same tenant''s verified company_domains at registration and at every sender validation. ses_identity_state records what Omnivyra knows about the SES identity; no row alone authorizes deleting one.';
