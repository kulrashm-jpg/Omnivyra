/**
 * e9 / 05: isDefinitiveDbRefusal treats PGRST1xx as "nothing committed". PGRST116 (singular-response mismatch) is the
 * one PGRST1xx raised AFTER execution - safe only because PostgREST rolls back on it, and only reachable when the call
 * asks for a singular response. This pins that the two settle RPC calls never do (.single() / .maybeSingle()), so a
 * future edit that adds one fails here instead of silently widening the "definitive" set.
 */
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(path.join(process.cwd(), 'backend/repositories/creditExecutionRepository.ts'), 'utf8');

/** Each `supabase.rpc('<name>', ...)` call through the end of its statement (the next `;`). */
function rpcCalls(src: string): Array<{ name: string; text: string }> {
  const out: Array<{ name: string; text: string }> = [];
  const re = /\.rpc\(\s*'([a-z_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf(';', m.index);
    out.push({ name: m[1], text: src.slice(m.index, end === -1 ? undefined : end) });
  }
  return out;
}

it('positive control: the scanner finds BOTH settle RPC calls', () => {
  expect(rpcCalls(SRC).map((c) => c.name).sort()).toEqual(['apply_credit_partial_confirm', 'apply_credit_reservation']);
});

it('no settle RPC call requests a singular response (.single() / .maybeSingle())', () => {
  for (const c of rpcCalls(SRC)) expect({ name: c.name, singular: /\.(single|maybeSingle)\(/.test(c.text) }).toEqual({ name: c.name, singular: false });
});

it('the scanner WOULD catch it (mutation of a copy)', () => {
  const mutated = SRC.replace("rpc('apply_credit_partial_confirm', {", "rpc('apply_credit_partial_confirm', {").replace(/(rpc\('apply_credit_partial_confirm'[\s\S]*?\})\)/, '$1).single()');
  const hit = rpcCalls(mutated).find((c) => c.name === 'apply_credit_partial_confirm');
  expect(hit && /\.(single|maybeSingle)\(/.test(hit.text)).toBe(true);
});
