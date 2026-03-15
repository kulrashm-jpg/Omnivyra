import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = path.resolve(process.cwd(), '.env');

if (fs.existsSync(envLocalPath)) {
  dotenv.config({ path: envLocalPath });
} else if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

// Allow execution engine writes during tests (guard in executionPlannerPersistence)
process.env.ALLOW_EXECUTION_ENGINE_WRITE = '1';

// Execution engine: allow persistence writes when tests call service methods
process.env.ALLOW_EXECUTION_ENGINE_WRITE = '1';
