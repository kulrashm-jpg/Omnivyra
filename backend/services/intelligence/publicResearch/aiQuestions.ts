/**
 * Public research — the questions put to AI search tools, and the reading of their answers.
 *
 * Questions: five a buyer would ask WITHOUT knowing the brand, and one "definitional" question — a
 * description so close to what this company sells that the company itself is the expected answer —
 * written by a model from the company's own site and profile (the brand name is rejected if it
 * appears), plus two fixed brand-name questions. Visibility is read both ways: found for the category,
 * and recognised as itself. If the model is unavailable, plain templates on the declared category are
 * used and the method says so.
 *
 * Reading: which brands each answer names (kept only when the name appears verbatim in the answer)
 * and, for brand-name questions, whether the answer describes this company or something else. The
 * judgement is the model's reading of the answer against the company's own description, so it is
 * labelled inferred.
 */
import { jsonCompletion } from './llm';

export type BuyerQuestion = { intent: 'category' | 'problem' | 'commercial' | 'use_case' | 'comparison' | 'definitional' | 'branded'; query: string };

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

/** OpenAI first, Claude if OpenAI is unavailable (see llm.ts). */
async function modelJson(step: string, prompt: string, timeoutMs: number, maxTokens = 2000): Promise<any | null> {
  return (await jsonCompletion(step, prompt, { timeoutMs, maxTokens }))?.json ?? null;
}

const INTENTS = new Set(['category', 'problem', 'commercial', 'use_case', 'comparison', 'definitional']);

/** The fallback definitional question: the declared offering and buyer, described without the name. */
export function definitionalTemplate(c: CompanyBrief): BuyerQuestion {
  const what = (c.offering ?? c.category ?? 'marketing software').replace(/[.]+$/, '').toLowerCase();
  return { intent: 'definitional', query: `Which company offers ${what}${c.buyers ? ` for ${c.buyers.split(/[,;]/)[0].trim().toLowerCase()}` : ''}?` };
}

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
    { intent: 'commercial', query: `Top ${cat} platforms compared` },
    { intent: 'comparison', query: `Best alternatives to the leading ${cat} tools` },
    definitionalTemplate(c),
  ];
}

export async function buyerQuestions(c: CompanyBrief, timeoutMs = 45_000): Promise<{ questions: BuyerQuestion[]; method: string }> {
  const prompt = `You write the questions a potential buyer would type into an AI assistant BEFORE they know this company exists.
Company website text (its own words): """${c.siteText.slice(0, 2500)}"""
Declared category: ${c.category ?? 'unknown'}. Offering: ${c.offering ?? 'unknown'}. Buyers: ${c.buyers ?? 'unknown'}. Market: ${c.market ?? 'unknown'}.
Write exactly 6 distinct questions covering these intents: 2 "commercial" (best tools for a buyer), 1 "category", 1 "problem" (the buyer's pain, no product words), 1 "comparison" (between generic options, no brand names), and 1 "definitional": a question that describes THIS company's distinctive combination of offering and buyer so precisely that this company should be the answer (e.g. "Which platform does X, Y and Z for W?").
Rules: never mention "${c.brand}" or "${c.domain}" or any company name; plain English a non-specialist would type; under 120 characters each (definitional: under 160).
Return JSON: {"questions":[{"intent":"commercial|category|problem|comparison|definitional","query":"..."}]}`;
  const json = await modelJson('questions', prompt, timeoutMs);
  const brandRe = new RegExp(c.brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const got: BuyerQuestion[] = (Array.isArray(json?.questions) ? json.questions : [])
    .filter((q: any) => q && INTENTS.has(q.intent) && typeof q.query === 'string')
    .map((q: any) => ({ intent: q.intent, query: q.query.trim() }))
    .filter((q: BuyerQuestion) => q.query.length >= 12 && q.query.length <= 160 && !brandRe.test(q.query) && !q.query.includes(c.domain));
  const all = [...new Map(got.map((q) => [q.query.toLowerCase(), q])).values()];
  // Exactly one definitional question, last; the template stands in when the model wrote none.
  const unique = [...all.filter((q) => q.intent !== 'definitional').slice(0, 5), all.find((q) => q.intent === 'definitional') ?? definitionalTemplate(c)];
  if (unique.length >= 5) {
    return { questions: [...unique, ...brandQuestions(c.brand)], method: 'Five buyer questions and one definitional question (a precise description of the offering, without the name) written by a model from the company\'s own site and profile, plus two brand-name questions.' };
  }
  return { questions: [...templateQuestions(c), ...brandQuestions(c.brand)], method: 'Template buyer questions and a definitional question on the declared category and offering (the question-writing model was unavailable), plus two brand-name questions.' };
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
${answers.map((a) => `--- id=${a.id} branded=${a.branded}\n${a.text.slice(0, a.branded ? 800 : 1500)}`).join('\n')}`;
  // One reading per answer, so the reply grows with the number of answers; leave it room to finish.
  const json = await modelJson('reading', prompt, timeoutMs, Math.min(8000, 600 + answers.length * 250));
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
