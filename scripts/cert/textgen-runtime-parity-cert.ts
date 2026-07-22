/**
 * WS-1c-2 (PMO-ADR-08) — #7 textGenerationOrchestrator runtime-delegation PARITY.
 *
 * Live-DB E2E companion to backend/tests/unit/textgenRuntimeParity.test.ts (the
 * hermetic proof). Extends the WRITER-CERT-006 precedent (runtime-parity-cert.ts):
 * runs a representative corpus through `runTextGeneration` TWICE per case —
 * TEXTGEN_RUNTIME_DELEGATION_ENABLED off (legacy inline) vs on (canonical
 * GenerationRuntime, persist:false + runOriginality:false) — against the LIVE cert
 * DB under the deterministic mock provider, and asserts the STRUCTURAL parity the
 * callers depend on:
 *   success · content_type · primary platform · templateUsed · variant platform ·
 *   variant content_type · governance metadata · (master/variant presence).
 *
 * NOTE ON MOCK TEXT: like CERT-006, betaMockTextProvider seeds off fnv1a(system+
 * user), so any prompt-item difference changes the mock TEXT without being a
 * semantic parity break. The hermetic unit test already proves the generation
 * ITEM is reconstructed identically; here free-text is reported as INFO, not a gate.
 *
 * IMPORTANT: #7 is persistence-free (no `content` row is written by either path),
 * so this harness needs NO content-table assertions — it compares the returned
 * envelope only.
 *
 * Run:
 *   DOTENV_CONFIG_PATH=.env.cert BETA_AI_MODE=1 CERT_ENV=1 \
 *     npx tsx -r dotenv/config -r tsconfig-paths/register scripts/cert/textgen-runtime-parity-cert.ts
 */
import { randomUUID } from 'crypto';
import {
  runTextGeneration,
  type TextGenerationInput,
} from '@/backend/services/content/textGenerationOrchestrator';

const FLAG = 'TEXTGEN_RUNTIME_DELEGATION_ENABLED';

type Mode = 'legacy' | 'delegated';
async function runMode(mode: Mode, input: TextGenerationInput) {
  if (mode === 'legacy') delete process.env[FLAG];
  else process.env[FLAG] = '1';
  const res = await runTextGeneration(input);
  return {
    success: res.success === true,
    content_type: res.contentType,
    templateUsed: res.templateUsed,
    primaryPlatform: res.primaryPlatform,
    hasMaster: !!res.masterContent?.content,
    masterHead: (res.masterContent?.content ?? '').replace(/\s+/g, ' ').slice(0, 50),
    hasVariant: !!res.platformVariant?.generated_content,
    variantPlatform: res.platformVariant?.platform ?? null,
    variantContentType: res.platformVariant?.content_type ?? null,
    governance: JSON.stringify(res.governance),
  };
}

const CORPUS: Array<{ name: string; in: Omit<TextGenerationInput, 'companyId'> }> = [
  { name: 'post + objective (linkedin)', in: { origin: 'thread-api', topic: 'shipping speed vs quality', contentType: 'post', targetPlatforms: ['linkedin'], objective: 'drive signups', audience: 'founders', tone: 'direct', cta: 'Start free' } },
  { name: 'post no-objective (x)', in: { origin: 'thread-api', topic: 'the cost of over-building', contentType: 'post', targetPlatforms: ['x'], audience: 'engineers', tone: 'punchy' } },
  { name: 'thread + objective (x)', in: { origin: 'thread-api', topic: 'why most roadmaps fail', contentType: 'thread', targetPlatforms: ['x'], objective: 'grow followers', audience: 'PMs', tone: 'direct' } },
  { name: 'thread no-tone + template (linkedin)', in: { origin: 'thread-api', topic: 'lessons from a failed launch', contentType: 'thread', targetPlatforms: ['linkedin'], objective: 'educate', templateName: 'story' } },
  { name: 'post + extra_instruction (linkedin)', in: { origin: 'thread-api', topic: 'positioning against incumbents', contentType: 'post', targetPlatforms: ['linkedin'], extraInstruction: 'Use a contrarian hook and one concrete number.' } },
];

// Structural parity contract — these MUST match between legacy and delegated.
const STRUCTURAL: [string, (a: Awaited<ReturnType<typeof runMode>>) => unknown][] = [
  ['success', (x) => x.success],
  ['content_type', (x) => x.content_type],
  ['templateUsed', (x) => x.templateUsed],
  ['primaryPlatform', (x) => x.primaryPlatform],
  ['hasMaster', (x) => x.hasMaster],
  ['hasVariant', (x) => x.hasVariant],
  ['variantPlatform', (x) => x.variantPlatform],
  ['variantContentType', (x) => x.variantContentType],
  ['governance', (x) => x.governance],
];

async function main() {
  console.log('WS-1c-2 #7 textGenerationOrchestrator runtime-delegation parity (live cert DB)\n');
  let pass = 0;
  let fail = 0;
  const infoDiffs: string[] = [];

  for (const c of CORPUS) {
    // Distinct company per mode keeps context/memory reads independent.
    const legacy = await runMode('legacy', { ...c.in, companyId: randomUUID() });
    const delegated = await runMode('delegated', { ...c.in, companyId: randomUUID() });

    console.log(`── ${c.name}`);
    for (const [label, sel] of STRUCTURAL) {
      const a = sel(legacy);
      const b = sel(delegated);
      if (JSON.stringify(a) === JSON.stringify(b)) {
        pass++;
      } else {
        fail++;
        console.log(`   FAIL  ${label}: legacy=${JSON.stringify(a)} delegated=${JSON.stringify(b)}`);
      }
    }
    if (legacy.masterHead !== delegated.masterHead) {
      infoDiffs.push(`${c.name}: master text differs (mock seed) L="${legacy.masterHead}" D="${delegated.masterHead}"`);
    }
    console.log(`   ok structural checks (variant=${legacy.variantPlatform}/${delegated.variantPlatform})`);
  }

  console.log('\nINFO (non-gating differences):');
  infoDiffs.forEach((d) => console.log('  • ' + d));
  console.log(`\n════ PARITY (structural): ${pass} pass / ${fail} fail ════`);
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => {
  console.error('HARNESS ERROR:', e?.stack || e);
  process.exit(2);
});
