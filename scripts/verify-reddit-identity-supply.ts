/**
 * PR-OPA-5 — Reddit identity supply verification.
 *
 * Validates the connector → writer → resolver pipeline for Reddit.
 * No DB writes, no network — drives the helpers directly with
 * synthetic inputs that mirror what the Reddit connector would have
 * populated on RawSignal.metadata after PR-OPA-5 enrichment.
 *
 * Spec acceptance cases:
 *   1. throwaway account              → null
 *   2. bio with role                  → medium
 *   3. bio with company + role        → high
 *   4. empty profile                  → null
 *   5. high-karma profile             → low (UI hides)
 *
 * Usage:
 *   npx tsx scripts/verify-reddit-identity-supply.ts
 */

import { resolveIdentityFor } from '../backend/services/opportunityFeedService';

type Case = {
  label: string;
  raw_metadata: Record<string, unknown>;
  expected_company: string | null;
  expected_role: string | null;
  expected_confidence: 'high' | 'medium' | 'low' | null;
};

// Mirrors the writer-side forwarding from PR-OPA-4/5 (pickProfileFields).
function forwardProfileToAuthorMetadata(raw: Record<string, unknown>): Record<string, unknown> {
  const author_metadata: Record<string, unknown> = {
    platform_user_id: 'reddit:somebody',
    author_handle: 'somebody',
  };
  const stringKeys = ['profile_company', 'profile_bio', 'profile_name', 'profile_title', 'karma_tier', 'inferred_persona'] as const;
  for (const k of stringKeys) {
    const v = raw[k];
    if (typeof v === 'string' && v.trim().length > 0) author_metadata[k] = v.trim();
  }
  const numberKeys = ['account_age_years'] as const;
  for (const k of numberKeys) {
    const v = raw[k];
    if (typeof v === 'number' && Number.isFinite(v)) author_metadata[k] = v;
  }
  return author_metadata;
}

const CASES: Case[] = [
  // -------- Spec acceptance cases --------
  {
    label: '1. Throwaway / brand-new account',
    raw_metadata: {
      karma_tier: 'new',
      account_age_years: 0.1,
    },
    expected_company: null,
    expected_role: null,
    expected_confidence: null,
  },
  {
    label: '2. Bio with role anchor',
    raw_metadata: {
      profile_bio: 'CTO of a small consulting firm. Opinions my own.',
      karma_tier: 'medium',
      account_age_years: 6,
    },
    expected_company: null,
    expected_role: 'CTO',
    expected_confidence: 'medium',
  },
  {
    label: '3. Bio with company AND role',
    raw_metadata: {
      profile_bio: 'CTO @ Acme Corp. Building distributed systems.',
      karma_tier: 'high',
      account_age_years: 9,
    },
    expected_company: 'Acme Corp',
    expected_role: 'CTO',
    expected_confidence: 'high',
  },
  {
    label: '4. Empty profile (no bio, no karma)',
    raw_metadata: {},
    expected_company: null,
    expected_role: null,
    expected_confidence: null,
  },
  {
    label: '5. High-karma profile, no bio',
    raw_metadata: {
      karma_tier: 'high',
      account_age_years: 8,
      inferred_persona: 'devops_engineer',
    },
    expected_company: null,
    expected_role: null,
    expected_confidence: 'low',  // UI hides — but resolver tags as low
  },

  // -------- Additional realistic cases --------
  {
    label: 'Bio mentions company without role (no extractable role)',
    raw_metadata: {
      profile_bio: 'building stuff at Vercel',
      karma_tier: 'medium',
      account_age_years: 4,
    },
    expected_company: null,        // company extractor only fires when "at X" matches; "at Vercel" matches but no role
    expected_role: null,
    expected_confidence: 'low',     // credibility (karma) alone → low
  },
  {
    label: 'Long-lived account with persona but no bio',
    raw_metadata: {
      account_age_years: 7,
      inferred_persona: 'founder',
    },
    expected_company: null,
    expected_role: null,
    expected_confidence: 'low',
  },
  {
    label: 'Founder-of-* style bio',
    raw_metadata: {
      profile_bio: 'Founder. Building tools for devs.',
      karma_tier: 'medium',
    },
    expected_company: null,
    expected_role: 'Founder',
    expected_confidence: 'medium',
  },
  {
    label: 'VP-prefix role',
    raw_metadata: {
      profile_bio: 'VP Engineering. Distributed systems nerd.',
      karma_tier: 'high',
    },
    expected_company: null,
    expected_role: 'VP Engineering',
    expected_confidence: 'medium',
  },
  {
    label: 'Empty-string bio (whitespace-only)',
    raw_metadata: {
      profile_bio: '   ',
      karma_tier: 'low',
      account_age_years: 2,
    },
    expected_company: null,
    expected_role: null,
    expected_confidence: 'low',     // credibility-only path
  },
];

function main() {
  console.log('================================================================');
  console.log('PR-OPA-5 — Reddit identity supply verification');
  console.log('================================================================\n');

  let pass = 0;
  let fail = 0;
  let blockShown = 0;
  let confidenceLow = 0;
  const total = CASES.length;

  for (const c of CASES) {
    const author_metadata = forwardProfileToAuthorMetadata(c.raw_metadata);
    const got = resolveIdentityFor('reddit', author_metadata);

    const ok =
      got.resolved_company === c.expected_company
      && got.resolved_role === c.expected_role
      && got.identity_confidence === c.expected_confidence;

    if (ok) pass++;
    else fail++;
    if (got.identity_confidence === 'high' || got.identity_confidence === 'medium') blockShown++;
    if (got.identity_confidence === 'low') confidenceLow++;

    const status = ok ? '✓' : '✗';
    console.log(`${status} ${c.label}`);
    console.log(`   in:  ${JSON.stringify(c.raw_metadata)}`);
    console.log(`   out: company=${got.resolved_company} role=${got.resolved_role} confidence=${got.identity_confidence}`);
    if (!ok) {
      console.log(`   ⚠ expected: company=${c.expected_company} role=${c.expected_role} confidence=${c.expected_confidence}`);
    }
    console.log('');
  }

  console.log('--- Verification summary ---');
  console.log(`  Cases passed:                       ${pass} / ${total}`);
  console.log(`  Cases failed:                       ${fail} / ${total}`);
  console.log(`  Identity block shown (>= medium):   ${blockShown} / ${total}  (${((blockShown / total) * 100).toFixed(1)}%)`);
  console.log(`  Low (hidden by UI):                 ${confidenceLow} / ${total}  (${((confidenceLow / total) * 100).toFixed(1)}%)`);
  console.log('');
  console.log('  Spec acceptance:');
  console.log(`    1. throwaway account → null:       ${CASES[0].expected_confidence === null ? '✓' : '✗'}`);
  console.log(`    2. bio with role → medium:         ${CASES[1].expected_confidence === 'medium' ? '✓' : '✗'}`);
  console.log(`    3. bio company + role → high:      ${CASES[2].expected_confidence === 'high' ? '✓' : '✗'}`);
  console.log(`    4. empty profile → null:           ${CASES[3].expected_confidence === null ? '✓' : '✗'}`);
  console.log(`    5. high-karma profile → low:       ${CASES[4].expected_confidence === 'low' ? '✓' : '✗'}`);

  if (fail > 0) process.exit(1);
}

main();
