/**
 * Public research — the questions put to AI search tools, and the reading of their answers.
 *
 * Questions: six a buyer would ask WITHOUT knowing the brand, written by a model from the company's
 * own site and profile (the brand name is rejected if it appears), plus two fixed brand-name
 * questions. If the model is unavailable, plain templates on the declared category are used and the
 * method says so.
 *
 * Reading: which brands each answer names (kept only when the name appears verbatim in the answer)
 * and, for brand-name questions, whether the answer describes this company or something else. The
 * judgement is the model's reading of the answer against the company's own description, so it is
 * labelled inferred.
 */
export type BuyerQuestion = { intent: 'category' | 'problem' | 'commercial' | 'use_case' | 'comparison' | 'branded'; query: string };

export type CompanyBrief = {
  brand: string;
  domain: string;
  /** The company's own words: homepage title, description, headline. */
  siteText: string;
  category: string | null;
  offering: string | null;
  buyers: string | null;
  market: string | null;
};

async function openaiJson(prompt: string, signal: AbortSignal): Promise<any | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.PUBLIC_RESEARCH_OPENAI_MODEL ?? 'gpt-4.1-mini', temperature: 0,
      response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) return null;
  const j: any = await res.json().catch(() => null);
  try { return JSON.parse(String(j?.choices?.[0]?.message?.content ?? '')); } catch { return null; }
}

const INTENTS = new Set(['category', 'problem', 'commercial', 'use_case', 'comparison']);

export function brandQuestions(brand: string): BuyerQuestion[] {
  return [{ intent: 'branded', query: `What is ${brand}?` }, { intent: 'comparison', query: `${brand} alternatives and competitors` }];
}

/** Template fallback: generic but honest, built only from declared fields. */
export function templateQuestions(c: CompanyBrief): BuyerQuestion[] {
  const cat = c.category ?? c.offering ?? 'marketing software';
  const who = c.buyers ?? 'small businesses';
  return [
    { intent: 'commercial', query: `What are the best ${cat} tools for ${who}?` },
    { intent: 'category', query: `What is ${/^[aeiou]/i.test(cat) ? 'an' : 'a'} ${cat} and which vendors offer one?` },
    { intent: 'problem', query: `How can ${who} choose the right ${cat}?` },
    { intent: 'use_case', query: `Which ${cat} tools offer a free trial or free plan?` },
    { intent: 'commercial', query: `Top ${cat} platforms compared` },
    { intent: 'comparison', query: `Best alternatives to the leading ${cat} tools` },
  ];
}

export async function buyerQuestions(c: CompanyBrief, timeoutMs = 45_000): Promise<{ questions: BuyerQuestion[]; method: string }> {
  const prompt = `You write the questions a potential buyer would type into an AI assistant BEFORE they know this company exists.
Company website text (its own words): """${c.siteText.slice(0, 2500)}"""
Declared category: ${c.category ?? 'unknown'}. Offering: ${c.offering ?? 'unknown'}. Buyers: ${c.buyers ?? 'unknown'}. Market: ${c.market ?? 'unknown'}.
Write exactly 6 distinct questions covering these intents: 2 "commercial" (best tools for a buyer), 1 "category", 1 "problem" (the buyer's pain, no product words), 1 "use_case", 1 "comparison" (between generic options, no brand names).
Rules: never mention "${c.brand}" or "${c.domain}" or any company name; plain English a non-specialist would type; under 120 characters each.
Return JSON: {"questions":[{"intent":"commercial|category|problem|use_case|comparison","query":"..."}]}`;
  const json = await openaiJson(prompt, AbortSignal.timeout(timeoutMs)).catch(() => null);
  const brandRe = new RegExp(c.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const got: BuyerQuestion[] = (Array.isArray(json?.questions) ? json.questions : [])
    .filter((q: any) => q && INTENTS.has(q.intent) && typeof q.query === 'string')
    .map((q: any) => ({ intent: q.intent, query: q.query.trim() }))
    .filter((q: BuyerQuestion) => q.query.length >= 12 && q.query.length <= 160 && !brandRe.test(q.query) && !q.query.includes(c.domain));
  const unique = [...new Map(got.map((q) => [q.query.toLowerCase(), q])).values()].slice(0, 6);
  if (unique.length >= 4) {
    return { questions: [...unique, ...brandQuestions(c.brand)], method: 'Six buyer questions written by a model from the company\'s own site and profile (brand name excluded), plus two brand-name questions.' };
  }
  return { questions: [...templateQuestions(c), ...brandQuestions(c.brand)], method: 'Template buyer questions on the declared category (the question-writing model was unavailable), plus two brand-name questions.' };
}

export type AnswerReading = { brands: string[]; accuracy: 'correct' | 'partly' | 'misidentified' | null; note: string | null };

/**
 * Read a batch of answers. Brands are kept only if they appear verbatim in the answer text, so the
 * model cannot add a name the tool did not say.
 */
export async function readAnswers(
  c: CompanyBrief,
  answers: Array<{ id: string; branded: boolean; text: string }>,
  timeoutMs = 60_000,
): Promise<Map<string, AnswerReading>> {
  const out = new Map<string, AnswerReading>();
  const mentioned = (t: string) => new RegExp(`\\b${c.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t);
  for (const a of answers) out.set(a.id, { brands: [], accuracy: a.branded ? (mentioned(a.text) ? null : 'misidentified') : null, note: null });
  if (!answers.length) return out;
  const prompt = `The company "${c.brand}" (${c.domain}) describes itself as: """${c.siteText.slice(0, 1200)}"""
For each AI answer below:
- "brands": every company or product name the answer recommends or names, exactly as written in the answer (do not add any name that is not in the text; exclude "${c.brand}").
- For answers marked branded=true only, "accuracy": "correct" if the answer describes this company, "partly" if it describes this company but also mixes in unrelated companies or wrong alternatives, "misidentified" if it describes something else (another company, a fictional character, a different product); "note": one short reason.
Return JSON: {"readings":[{"id":"...","brands":["..."],"accuracy":"correct|partly|misidentified|null","note":"..."}]}
Answers:
${answers.map((a) => `--- id=${a.id} branded=${a.branded}\n${a.text.slice(0, 2500)}`).join('\n')}`;
  const json = await openaiJson(prompt, AbortSignal.timeout(timeoutMs)).catch(() => null);
  for (const r of Array.isArray(json?.readings) ? json.readings : []) {
    const a = answers.find((x) => x.id === r?.id);
    if (!a) continue;
    const text = a.text.toLowerCase();
    const brands = [...new Set((Array.isArray(r.brands) ? r.brands : []).filter((b: unknown): b is string => typeof b === 'string' && b.trim().length > 1)
      .map((b: string) => b.trim()).filter((b: string) => text.includes(b.toLowerCase()) && b.toLowerCase() !== c.brand.toLowerCase()))].slice(0, 20) as string[];
    const accuracy = a.branded && ['correct', 'partly', 'misidentified'].includes(r.accuracy) ? r.accuracy : out.get(a.id)!.accuracy;
    out.set(a.id, { brands, accuracy, note: a.branded && typeof r.note === 'string' ? r.note.slice(0, 200) : null });
  }
  return out;
}
