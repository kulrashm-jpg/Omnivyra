/**
 * Generate Weekly Structure Service
 *
 * Re-exports the core logic from the API route so BOLT and other backend
 * consumers can call it directly instead of making internal HTTP requests.
 */

export {
  generateWeeklyStructure,
  type GenerateWeeklyStructureInput,
} from '../../pages/api/campaigns/generate-weekly-structure';
