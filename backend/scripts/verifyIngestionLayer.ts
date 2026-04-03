import dotenv from 'dotenv';
import { validateIngestionOutput } from '../services/ingestionScheduler';

dotenv.config({ path: `${process.cwd()}/.env.local` });
dotenv.config();

async function main() {
  const companyId = process.argv[2];
  if (!companyId) {
    throw new Error('Usage: ts-node backend/scripts/verifyIngestionLayer.ts <company-id>');
  }

  const validation = await validateIngestionOutput(companyId);
  const ready =
    validation.pages > 0 &&
    validation.sessions > 0 &&
    validation.keywords > 0 &&
    validation.leads > 0 &&
    validation.campaigns > 0;

  console.log(
    JSON.stringify(
      {
        companyId,
        validation,
        status: ready ? 'PASS' : 'NOT READY',
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[verifyIngestionLayer] failed', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
