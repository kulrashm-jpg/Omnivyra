/**
 * P2A — the NormalizedAccount contract carries the firmographic surface.
 *
 * A type-level change needs a test that would actually fail if the type were
 * wrong, so these assert on values shaped by the interface and on the migration
 * text itself. The most important assertion is the negative one: P2A must not
 * re-declare the attributes LI-1 already owns.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { NormalizedAccount } from '../../services/leadIngestion/contracts';
import { validateNormalizedRecord } from '../../services/leadIngestion/contracts';

const MIGRATION = readFileSync(
  join(__dirname, '../../../supabase/migrations/20261005000000_p2a_account_firmographics.sql'), 'utf8');
const ROLLBACK = readFileSync(
  join(__dirname, '../../../supabase/migrations/rollbacks/p2a_account_firmographics_rollback.sql'), 'utf8');
const CONTRACTS = readFileSync(
  join(__dirname, '../../services/leadIngestion/contracts.ts'), 'utf8');

const ORG = '00000000-0000-4000-8000-0000000000aa';

describe('P2A — NormalizedAccount carries the six new attributes', () => {
  it('accepts a fully-populated firmographic account', () => {
    const account: NormalizedAccount = {
      name: 'Acme',
      domain: 'acme.example',
      industry: 'SaaS',
      employeeCount: 250,
      employeeBand: '201-500',
      countryCode: 'GB',
      region: 'London',
      city: 'London',
      annualRevenue: 12_500_000,
      revenueBand: '$10M-$50M',
      foundedYear: 2015,
      technologies: ['postgres', 'nextjs'],
      fundingStage: 'Series B',
      lastFundingAt: '2026-01-01T00:00:00.000Z',
    };
    expect(account.annualRevenue).toBe(12_500_000);
    expect(account.technologies).toEqual(['postgres', 'nextjs']);
  });

  it('every new attribute is OPTIONAL — an account with none is still valid', () => {
    const account: NormalizedAccount = { name: 'Acme', domain: 'acme.example' };
    expect(account.annualRevenue).toBeUndefined();
    expect(account.fundingStage).toBeUndefined();
  });

  it('accepts a provider string for the numeric fields, as employeeCount already does', () => {
    const account: NormalizedAccount = { annualRevenue: '12500000', foundedYear: '2015' };
    expect(account.annualRevenue).toBe('12500000');
  });

  it('accepts explicit null — "the provider looked and had nothing" is expressible', () => {
    const account: NormalizedAccount = { annualRevenue: null, technologies: null, lastFundingAt: null };
    expect(account.annualRevenue).toBeNull();
  });

  it('does NOT re-declare the attributes LI-1 already owns', () => {
    const block = CONTRACTS.slice(
      CONTRACTS.indexOf('export interface NormalizedAccount'),
      CONTRACTS.indexOf('export interface NormalizedIngestionRecord'),
    );
    for (const field of ['industry', 'employeeCount', 'employeeBand', 'countryCode', 'region', 'city']) {
      const declarations = block.split('\n').filter((l) => new RegExp(`^\\s*${field}\\?:`).test(l));
      expect(declarations).toHaveLength(1);
    }
  });

  it('adding firmographics does not change what makes a record valid', () => {
    // An account record is still anchored by identity, never by firmographics.
    const withFirmographicsOnly = validateNormalizedRecord({
      organizationId: ORG, source: 'manual', entityType: 'account', externalId: 'A-1',
      account: { industry: 'SaaS', annualRevenue: 1 },
    });
    expect(withFirmographicsOnly).toMatch(/provider identifier, a domain or a website/);

    const anchored = validateNormalizedRecord({
      organizationId: ORG, source: 'manual', entityType: 'account', externalId: 'A-1',
      account: { domain: 'acme.example', annualRevenue: 1, technologies: ['x'] },
    });
    expect(anchored).toBeNull();
  });
});

describe('P2A — the migration is additive and scoped', () => {
  it('adds exactly the six missing columns', () => {
    for (const c of ['annual_revenue', 'revenue_band', 'founded_year', 'technologies', 'funding_stage', 'last_funding_at']) {
      expect(MIGRATION).toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${c}\\b`));
    }
  });

  it('does NOT re-add the columns LI-1 owns', () => {
    for (const c of ['industry', 'employee_count', 'employee_band', 'description']) {
      expect(MIGRATION).not.toMatch(new RegExp(`ADD COLUMN IF NOT EXISTS\\s+${c}\\b`));
    }
  });

  it('is additive only — no destructive verb', () => {
    const body = MIGRATION.replace(/--.*$/gm, '');
    for (const verb of ['DROP COLUMN', 'DROP TABLE', 'ALTER COLUMN', 'RENAME', 'TRUNCATE', 'DELETE FROM', 'UPDATE ']) {
      expect(body).not.toContain(verb);
    }
  });

  it('writes no data — a schema migration backfills nothing', () => {
    expect(MIGRATION.replace(/--.*$/gm, '')).not.toContain('INSERT INTO');
  });

  it('requires LI-1 first rather than assuming it', () => {
    expect(MIGRATION).toContain('apply LI-1 first');
  });

  it('imposes no speculative vocabulary on revenue_band or funding_stage', () => {
    expect(MIGRATION).not.toMatch(/revenue_band\s+IN\s*\(/i);
    expect(MIGRATION).not.toMatch(/funding_stage\s+IN\s*\(/i);
  });

  it('keeps every new index tenant-first', () => {
    const indexes = MIGRATION.match(/ON public\.prospect_accounts \([^)]*\)/g) ?? [];
    expect(indexes.length).toBeGreaterThan(0);
    for (const idx of indexes) expect(idx).toMatch(/\(organization_id/);
  });

  it('verifies its own result rather than trusting the DDL', () => {
    expect(MIGRATION).toContain('P2A verify:');
  });
});

describe('P2A — the rollback is honest about loss', () => {
  it('drops exactly what the forward migration added', () => {
    for (const c of ['annual_revenue', 'revenue_band', 'founded_year', 'technologies', 'funding_stage', 'last_funding_at']) {
      expect(ROLLBACK).toMatch(new RegExp(`DROP COLUMN IF EXISTS\\s+${c}\\b`));
    }
  });

  it('never drops an LI-1 column — that would undo a different migration', () => {
    for (const c of ['industry', 'employee_count', 'employee_band', 'country_code', 'region', 'city', 'description']) {
      expect(ROLLBACK).not.toMatch(new RegExp(`DROP COLUMN IF EXISTS\\s+${c}\\b`));
    }
  });

  it('REFUSES to run if the columns hold data, instead of silently destroying it', () => {
    expect(ROLLBACK).toContain('P2A rollback refused');
  });

  it('asserts LI-1 survived the rollback', () => {
    expect(ROLLBACK).toContain('rollback overreached');
  });
});
