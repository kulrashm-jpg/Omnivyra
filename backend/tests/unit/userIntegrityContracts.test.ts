import {
  UserState,
  assertValidTransition,
  InvalidUserLifecycleTransitionError,
} from '../../../lib/userLifecycle';
import { normalizeDomain } from '../../../lib/domainService';
import {
  calculateInviteExpiry,
  hashInviteToken,
  normalizeInviteEmail,
} from '../../../lib/inviteService';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('user integrity contracts', () => {
  describe('lifecycle transitions', () => {
    it('allows canonical lifecycle transitions', () => {
      expect(() => assertValidTransition(UserState.INVITED, UserState.PENDING)).not.toThrow();
      expect(() => assertValidTransition(UserState.PENDING, UserState.ACTIVE)).not.toThrow();
      expect(() => assertValidTransition(UserState.ACTIVE, UserState.SUSPENDED)).not.toThrow();
      expect(() => assertValidTransition(UserState.SUSPENDED, UserState.ACTIVE)).not.toThrow();
      expect(() => assertValidTransition(UserState.ACTIVE, UserState.DELETED)).not.toThrow();
      expect(() => assertValidTransition(UserState.DELETED, UserState.ACTIVE)).not.toThrow();
      expect(() => assertValidTransition(UserState.INVITED, UserState.DELETED)).not.toThrow();
    });

    it('rejects direct invited to active', () => {
      expect(() => assertValidTransition(UserState.INVITED, UserState.ACTIVE))
        .toThrow(InvalidUserLifecycleTransitionError);
    });

    it('rejects duplicate pending transitions from pending', () => {
      expect(() => assertValidTransition(UserState.PENDING, UserState.PENDING))
        .toThrow(InvalidUserLifecycleTransitionError);
      expect(() => assertValidTransition(UserState.PENDING, UserState.INVITED))
        .toThrow(InvalidUserLifecycleTransitionError);
    });
  });

  describe('invite contract', () => {
    it('normalizes invite emails deterministically', () => {
      expect(normalizeInviteEmail('  Owner@Example.COM ')).toBe('owner@example.com');
    });

    it('uses stable token hashing without exposing raw tokens', () => {
      expect(hashInviteToken('invite-token')).toBe(hashInviteToken('invite-token'));
      expect(hashInviteToken('invite-token')).not.toBe('invite-token');
    });

    it('extends expiry from the supplied clock', () => {
      expect(calculateInviteExpiry(new Date('2026-05-05T00:00:00.000Z')))
        .toBe('2026-05-12T00:00:00.000Z');
    });
  });

  describe('domain contract', () => {
    it('normalizes domains to the canonical unique key', () => {
      expect(normalizeDomain('https://www.Example.com/path')).toBe('example.com');
      expect(normalizeDomain('EXAMPLE.com')).toBe('example.com');
    });
  });

  describe('database enforcement migration', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260505020001_organization_semantics_and_lifecycle_db_guard.sql'),
      'utf8',
    );

    it('renames companies to organizations with compatibility containment', () => {
      expect(migration).toContain('ALTER TABLE public.companies RENAME TO organizations');
      expect(migration).toContain('CREATE VIEW public.companies');
    });

    it('uses organization_id for active invite uniqueness', () => {
      expect(migration).toContain('invitations_active_organization_email_unique');
      expect(migration).toContain('lower(email), organization_id');
    });

    it('enforces user_state enum and transition trigger', () => {
      expect(migration).toContain('CREATE TYPE public.user_state AS ENUM');
      expect(migration).toContain('validate_user_state_transition');
      expect(migration).toContain('trg_validate_user_state_transition');
    });

    it('asserts domain uniqueness before continuing', () => {
      expect(migration).toContain('HAVING count(*) > 1');
      expect(migration).toContain('duplicate company_domains.final_domain');
    });
  });

  describe('hardening migration', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20260505030001_invite_domain_membership_hardening.sql'),
      'utf8',
    );

    it('enforces invite status enum and accepted user linkage', () => {
      expect(migration).toContain('CREATE TYPE public.invite_status AS ENUM');
      expect(migration).toContain('accepted_user_id');
      expect(migration).toContain("status <> 'accepted'::public.invite_status OR accepted_user_id IS NOT NULL");
    });

    it('enforces one membership row per user and organization', () => {
      expect(migration).toContain('user_company_roles_user_organization_unique');
      expect(migration).toContain('ON public.user_company_roles(user_id, organization_id)');
    });

    it('blocks unverified domain bindings and serializes domain creation', () => {
      expect(migration).toContain("verification_status <> 'verified'");
      expect(migration).toContain('validate_verified_domain_binding');
      expect(migration).toContain('pg_advisory_xact_lock');
      expect(migration).toContain('FOR UPDATE');
    });

    it('deprecates users.company_id for new writes', () => {
      expect(migration).toContain('users_company_id_deprecated');
      expect(migration).toContain('CHECK (company_id IS NULL) NOT VALID');
    });
  });
});
