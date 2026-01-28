import OpenAI from 'openai';

export interface LlmJsonResponse<T> {
  data: T;
  raw: string;
  model: string;
}

const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY');
  }
  return new OpenAI({ apiKey });
}

export async function runDiagnosticPrompt<T>(
  systemPrompt: string,
  userPrompt: string
): Promise<LlmJsonResponse<T>> {
  const client = getClient();

  const response = await client.chat.completions.create({
    model: DEFAULT_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  });

  const raw = response.choices[0]?.message?.content?.trim() || '';
  if (!raw) {
    throw new Error('LLM returned empty response');
  }

  let parsed: T;
  try {
    parsed = JSON.parse(raw) as T;
  } catch (error) {
    throw new Error('LLM response is not valid JSON');
  }

  return {
    data: parsed,
    raw,
    model: response.model || DEFAULT_MODEL,
  };
}
