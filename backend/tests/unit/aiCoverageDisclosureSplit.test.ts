/**
 * The AI answer-engine coverage disclosure separates a configured provider that FAILED from
 * providers that were never configured. omnivyra.com (2026-10-24) listed all five under
 * "No result from" although chatgpt was configured and failed to load.
 */
import { renderReportDisclosures } from '../../services/intelligence/exportRendererSectionsB';

const cell = (provider: string, reason: string) =>
  ['branded', 'category', 'competitive', 'expertise'].map((query_class) => ({
    provider, query_class, state: 'unavailable', citation_rate: null, observed_count: 0, mean_prominence: null, reason_unavailable: reason,
  }));

const payload = {
  ai_surface_presence: {
    citation_matrix: {
      coverage: { measured_cells: 0, unavailable_cells: 20, total_cells: 20 },
      by_provider: ['chatgpt', 'gemini', 'claude', 'perplexity', 'copilot'].map((provider) => ({ provider, state: 'unavailable', citation_rate: null, mean_prominence: null })),
      by_query_class: [],
      cells: [
        ...cell('chatgpt', 'chatgpt adapter is configured but failed to load (./adapters/openaiAdapter): mod.OpenAIChatGPTAdapter is not a constructor'),
        ...cell('gemini', 'gemini adapter is not configured — set GEMINI_API_KEY in the environment'),
        ...cell('claude', 'claude adapter is not configured — set ANTHROPIC_API_KEY in the environment'),
        ...cell('perplexity', 'perplexity adapter is not configured — set PERPLEXITY_API_KEY in the environment'),
        ...cell('copilot', 'copilot adapter is not configured — set AZURE_COPILOT_API_KEY in the environment'),
      ],
    },
  },
};

it('names the failed provider separately from the unconfigured ones', () => {
  const html = renderReportDisclosures(payload as never);
  expect(html).toContain('0 of 20 provider × question-type checks returned data.');
  expect(html).toContain('Configured but failed: chatgpt.');
  expect(html).toContain('Not configured: gemini, claude, perplexity, copilot.');
  expect(html).not.toContain('No result from');
  expect(html).toContain('No AI visibility conclusion is drawn from this run.');
});
