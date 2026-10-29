/**
 * Provider response shapes for citation-retention tests. Hand-written to each API's documented shape;
 * every domain is a reserved *.test domain. Nothing here ships or reaches a network.
 */

export const OPENAI_RESPONSES = {
  output: [
    { type: 'web_search_call', action: { query: 'best planners' } },
    {
      type: 'message',
      content: [{
        type: 'output_text',
        text: 'Rival and Other are popular planners.',
        annotations: [
          { type: 'url_citation', url: 'https://www.reviews.test/best-planners?utm_source=openai', title: 'Best planners 2026' },
          { type: 'url_citation', url: 'https://blog.rival.test/compare', title: 'Rival vs Other' },
        ],
      }],
    },
  ],
};

/** Perplexity: `citations` are cited; a search result not among them was only retrieved. */
export const PERPLEXITY_SPLIT = {
  choices: [{ message: { content: 'Rival leads [1]. See also [2].' } }],
  citations: ['https://reviews.test/best-planners', 'https://forum.test/t/planners'],
  search_results: [
    { url: 'https://reviews.test/best-planners', title: 'Best planners', date: '2026-10-01' },
    { url: 'https://forum.test/t/planners', title: 'Planner thread' },
    { url: 'https://notcited.test/page', title: 'Searched but not cited' },
  ],
};

/** Perplexity with search results only: the cited / retrieved split is unknown. */
export const PERPLEXITY_RESULTS_ONLY = {
  choices: [{ message: { content: 'Rival leads.' } }],
  search_results: [{ url: 'https://reviews.test/best-planners', title: 'Best planners' }],
};

/** Claude: text-block citations are cited; other search results were only retrieved. */
export const CLAUDE_SEARCH = {
  content: [
    { type: 'server_tool_use', name: 'web_search', input: { query: 'best planners' } },
    { type: 'web_search_tool_result', content: [
      { type: 'web_search_result', url: 'https://reviews.test/best-planners', title: 'Best planners', page_age: '2026-10-01' },
      { type: 'web_search_result', url: 'https://retrieved-only.test/x', title: 'Not cited' },
    ] },
    { type: 'text', text: 'Rival is the most cited planner.', citations: [{ type: 'web_search_result_location', url: 'https://reviews.test/best-planners', title: 'Best planners', cited_text: 'Rival' }] },
  ],
};

/** Gemini: redirect URIs with the source domain as the title; groundingSupports name the chunks used. */
export const GEMINI_GROUNDED = {
  candidates: [{
    content: { parts: [{ text: 'Rival is popular.' }] },
    groundingMetadata: {
      groundingChunks: [
        { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA', title: 'reviews.test' } },
        { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB', title: 'unused.test' } },
      ],
      groundingSupports: [{ segment: { startIndex: 0, endIndex: 17 }, groundingChunkIndices: [0] }],
    },
  }],
};

export const SERP_AI_MODE = {
  reconstructed_markdown: 'Rival is popular.',
  references: [{ link: 'https://reviews.test/best-planners', title: 'Best planners', snippet: 's', source: 'Reviews' }],
};

export const SERP_BING_COPILOT = {
  text_blocks: [{ snippet: 'Rival is popular.' }],
  references: [{ link: 'https://forum.test/t/planners', title: 'Planner thread', snippet: 's' }],
};
