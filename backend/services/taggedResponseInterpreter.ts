/**
 * Tagged Response Interpreter
 * Parses template_structure tags and extracts blocks for LLM prompt.
 */

export const SUPPORTED_TAGS = [
  'greeting',
  'introduction',
  'personal_info',
  'acknowledgement',
  'answer',
  'clarification',
  'cta',
  'closing',
  'thank_user',
  'appreciate_comment',
  'invite_dm',
] as const;

export type TemplateTag = (typeof SUPPORTED_TAGS)[number];

export type ParsedBlock = {
  tag: TemplateTag;
  content: string;
};

/**
 * Parse template_structure and extract tagged blocks.
 */
export function parseTemplateStructure(structure: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const tagPattern = new RegExp(
    `<(${SUPPORTED_TAGS.join('|')})>([\\s\\S]*?)</\\1>`,
    'gi'
  );

  let match: RegExpExecArray | null;
  const seen = new Set<string>();

  while ((match = tagPattern.exec(structure)) !== null) {
    const tag = match[1].toLowerCase() as TemplateTag;
    const content = (match[2] ?? '').trim();
    const key = `${tag}:${content.slice(0, 50)}`;
    if (!seen.has(key)) {
      seen.add(key);
      blocks.push({ tag, content });
    }
  }

  return blocks;
}

/**
 * Convert parsed blocks to a prompt structure string.
 */
export function blocksToPromptStructure(blocks: ParsedBlock[]): string {
  return blocks
    .map((b) => `[${b.tag}]\n${b.content}`)
    .join('\n\n');
}

/**
 * Extract variable placeholders from template (e.g. {name}, {age}).
 */
export function extractVariables(template: string): string[] {
  const matches = template.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
  if (!matches) return [];
  return [...new Set(matches.map((m) => m.slice(1, -1)))];
}
