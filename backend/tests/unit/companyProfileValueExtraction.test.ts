/**
 * CPG-007 — deterministic source-backed value extraction.
 *
 * FIXTURE TESTS. No network, no database, no LLM. Every document string is
 * hand-written test data and is never presented as retrieved evidence.
 *
 * Several fixtures are VERBATIM sentences observed in the CPG-006 live runs
 * (Cloudflare IR, getlatka, Economic Times). They are used here as parser
 * fixtures only — live extraction is reported separately.
 */

import {
  parseMoney, isRange, classifyTemporal, extractPeriod, isForwardLooking, splitSentences,
} from '../../services/companyProfile/grounding/extraction/valueTypes';
import {
  extractRevenue, extractCeo, extractFoundedYear, extractFunding,
  extractField, readJsonLdBlocks, SUPPORTED_EXTRACTION_FIELDS,
} from '../../services/companyProfile/grounding/extraction/documentExtractors';

const CO = 'Cloudflare';
const doc = (s: string) => `<html><body><p>${s}</p></body></html>`;

describe('CPG-007 (1) money parsing', () => {
  it('normalizes multipliers and currencies', () => {
    expect(parseMoney('revenue totaled $614.5 million')).toMatchObject({ amount: 614_500_000, currency: 'USD', multiplier: 'million' });
    expect(parseMoney('raised $1.2 billion')).toMatchObject({ amount: 1_200_000_000, multiplier: 'billion' });
    expect(parseMoney('revenue of ₹10 crore')).toMatchObject({ amount: 100_000_000, currency: 'INR', multiplier: 'crore' });
    expect(parseMoney('revenue of Rs 50 lakh')).toMatchObject({ amount: 5_000_000, currency: 'INR', multiplier: 'lakh' });
    expect(parseMoney('€250,000 in revenue')).toMatchObject({ amount: 250_000, currency: 'EUR', multiplier: 'none' });
  });

  it('flags approximation', () => {
    expect(parseMoney('revenue was approximately $600 million')!.approximate).toBe(true);
    expect(parseMoney('revenue was $600 million')!.approximate).toBe(false);
  });

  it('a bare number is NOT money', () => {
    expect(parseMoney('revenue grew 40 percent')).toBeNull();
    expect(parseMoney('revenue increased by 12')).toBeNull();
  });

  it('detects ranges', () => {
    expect(isRange('revenue of $10-15 million')).toBe(true);
    expect(isRange('revenue between $10 million and $15 million')).toBe(true);
    expect(isRange('revenue of $10 million')).toBe(false);
  });
});

describe('CPG-007 (2) temporal semantics — §6', () => {
  it('classifies the five types', () => {
    expect(classifyTemporal('FY2025 revenue was $10 million.')).toBe('HISTORICAL');
    expect(classifyTemporal('Revenue is $10 million currently.')).toBe('CURRENT');
    expect(classifyTemporal('Revenue is expected to reach $10 million.')).toBe('FORECAST');
    expect(classifyTemporal('The company targets $10 million in revenue.')).toBe('TARGET');
    expect(classifyTemporal('Revenue, discussed at length.')).toBe('UNKNOWN');
  });

  it('forward-looking language beats past-tense verbs', () => {
    expect(classifyTemporal('Revenue was expected to reach $1 billion.')).toBe('FORECAST');
  });

  it('extracts period only from the statement itself', () => {
    expect(extractPeriod('FY2025 revenue')).toMatchObject({ period: 'FY', year: 2025 });
    expect(extractPeriod('Fourth quarter revenue totaled $614.5 million in 2025.')).toMatchObject({ period: 'Q4', year: 2025 });
    expect(extractPeriod('revenue totaled $5 million')).toMatchObject({ period: null, year: null });
  });

  it('marks forecasts and targets forward-looking', () => {
    expect(isForwardLooking('FORECAST')).toBe(true);
    expect(isForwardLooking('TARGET')).toBe(true);
    expect(isForwardLooking('HISTORICAL')).toBe(false);
  });
});

describe('CPG-007 (3) revenue extraction — accept', () => {
  it('extracts a real fiscal-year statement exactly (live-observed, stockanalysis.com)', () => {
    const r = extractRevenue(doc('In the year 2025, Cloudflare had annual revenue of $2.17B with 29.85% growth.'), CO);
    expect(r.values).toHaveLength(1);
    expect(r.values[0]).toMatchObject({
      field: 'revenue', value: '2170000000', currency: 'USD',
      temporalType: 'HISTORICAL', period: 'FY', year: 2025, moneyKind: 'revenue', approximation: false,
    });
    expect(r.values[0].sourceStatement).toContain('$2.17B');
  });

  it('BEHAVIOUR CHANGE (CPG-007 live run): a QUARTERLY figure is refused as revenue', () => {
    // Previously accepted with period Q4. Live, a Q2 figure became Cloudflare's
    // effective revenue shown as "(2026)" — a quarter presented as a year.
    const r = extractRevenue(doc('Cloudflare fourth quarter revenue totaled $614.5 million, representing an increase of 27% year-over-year.'), CO);
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/quarterly/);
    // The decimal is still parsed exactly — the refusal is semantic, not a parse failure.
    expect(r.rejected[0].sourceStatement).toContain('$614.5 million');
  });

  it('extracts historical annual revenue with the year the statement gives', () => {
    const r = extractRevenue(doc('Cloudflare revenue in 2024 was $1.67 billion.'), CO);
    expect(r.values[0]).toMatchObject({ value: '1670000000', temporalType: 'HISTORICAL', year: 2024 });
  });

  it('accepts approximate revenue with approximation metadata', () => {
    const r = extractRevenue(doc('Cloudflare revenue was approximately $600 million.'), CO);
    expect(r.values[0]).toMatchObject({ approximation: true, value: '600000000' });
  });

  it('handles ₹ crore', () => {
    const r = extractRevenue(doc('Acme reported revenue of ₹7.8 crore in FY2024.'), 'Acme');
    expect(r.values[0]).toMatchObject({ value: '78000000', currency: 'INR', year: 2024 });
  });
});

describe('CPG-007 (4) revenue extraction — MUST reject (§8)', () => {
  const reject = (sentence: string, company = CO) => {
    const r = extractRevenue(doc(sentence), company);
    expect(r.values).toHaveLength(0);
    return r.rejected[0]?.reason ?? '';
  };

  it('rejects forecast and target', () => {
    expect(reject('Cloudflare revenue is expected to reach $1 billion.')).toMatch(/FORECAST/);
    expect(reject('Cloudflare targets $1 billion in revenue.')).toMatch(/TARGET/);
  });

  it('rejects valuation, funding, order book, GMV, bookings, market size', () => {
    expect(reject('Cloudflare revenue aside, the valuation reached $5 billion.')).toMatch(/valuation/);
    expect(reject('Cloudflare raised $150 million, revenue undisclosed.')).toMatch(/funding/);
    expect(reject('Cloudflare revenue trails its order book of $40 million.')).toMatch(/order_book/);
    expect(reject('Cloudflare GMV was $2 billion, revenue not disclosed.')).toMatch(/gmv/);
    expect(reject('Cloudflare bookings hit $300 million; revenue lags.')).toMatch(/bookings/);
    expect(reject('The revenue opportunity: market size of $50 billion for Cloudflare.')).toMatch(/market_size/);
  });

  it('keeps ARR distinct from revenue', () => {
    expect(reject('Cloudflare ARR reached $19.4 billion in annual recurring revenue.')).toMatch(/arr/);
  });

  it('rejects a RANGE — that belongs to revenue_range (§8/CPG-005)', () => {
    expect(reject('Cloudflare revenue of $10-15 million.')).toMatch(/RANGE/);
  });

  it('rejects revenue discussed without an amount', () => {
    expect(reject('Cloudflare revenue has grown rapidly.')).toMatch(/no currency-qualified amount/);
  });

  it('§13 — an acquisition price is never revenue', () => {
    expect(reject('Cloudflare acquired Company X for $500 million, boosting revenue.')).toMatch(/acquisition|another entity/);
  });

  it('§13 — rejects when the company is not named (ambiguous attribution)', () => {
    expect(reject('Revenue totaled $500 million last year.')).toMatch(/not named|ambiguous/);
  });

  it('never infers revenue from headcount or growth', () => {
    const r = extractRevenue(doc('Cloudflare has 3,700 employees and grew 27% year over year.'), CO);
    expect(r.values).toHaveLength(0);
  });
});

describe('CPG-007 (5) CEO extraction — §9', () => {
  it('accepts an explicit "Name, CEO of Company" statement', () => {
    const r = extractCeo(doc('Matthew Prince, CEO of Cloudflare, said the quarter was strong.'), CO);
    expect(r.values[0]).toMatchObject({ field: 'ceo', value: 'Matthew Prince', temporalType: 'CURRENT' });
  });

  it('accepts "the chief executive officer is X"', () => {
    const r = extractCeo(doc("Cloudflare's chief executive officer is Jane Doe."), CO);
    expect(r.values.map((v) => v.value)).toContain('Jane Doe');
  });

  it('accepts schema.org Person explicitly titled CEO', () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"Cloudflare","employee":{"@type":"Person","name":"Matthew Prince","jobTitle":"CEO"}}</script>`;
    const r = extractCeo(html, CO);
    expect(r.values[0]).toMatchObject({ value: 'Matthew Prince', method: 'json_ld' });
  });

  it('REJECTS a person name with no role', () => {
    const r = extractCeo(doc('Matthew Prince spoke at the Cloudflare conference yesterday.'), CO);
    expect(r.values).toHaveLength(0);
  });

  it('REJECTS founder-without-CEO', () => {
    const r = extractCeo(doc('Michelle Zatlyn is a founder of Cloudflare.'), CO);
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/without an explicit CEO role/);
  });

  it('REJECTS a bare leadership-team mention', () => {
    const r = extractCeo(doc('Meet the Cloudflare leadership team on this page.'), CO);
    expect(r.values).toHaveLength(0);
  });

  it('REJECTS a CEO of a DIFFERENT company', () => {
    const r = extractCeo(doc('Satya Nadella, CEO of Microsoft, commented on the deal.'), CO);
    expect(r.values).toHaveLength(0);
    expect(r.rejected.some((x) => /not named|ambiguous/.test(x.reason))).toBe(true);
  });
});

describe('CPG-007 (6) founded year — §10', () => {
  it('accepts an explicit founding statement', () => {
    const r = extractFoundedYear(doc('Cloudflare was founded in 2009 by three people.'), CO);
    expect(r.values[0]).toMatchObject({ field: 'founded_year', value: '2009', temporalType: 'HISTORICAL' });
  });

  it('accepts schema.org foundingDate', () => {
    const r = extractFoundedYear(`<script type="application/ld+json">{"@type":"Organization","name":"Cloudflare","foundingDate":"2009-07-01"}</script>`, CO);
    expect(r.values[0]).toMatchObject({ value: '2009', method: 'json_ld' });
  });

  it('REJECTS a copyright year', () => {
    const r = extractFoundedYear(doc('© 2009 Cloudflare — all rights reserved, founded on solid principles.'), CO);
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/copyright/);
  });

  it('REJECTS a publication date', () => {
    const r = extractFoundedYear(doc('Published in 2021, this Cloudflare article covers the founding story.'), CO);
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/publication/);
  });

  it('REJECTS founding language with no year attached', () => {
    const r = extractFoundedYear(doc('Cloudflare was founded by a small team in California.'), CO);
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/no explicit four-digit year/);
  });
});

describe('CPG-007 (7) funding — §11', () => {
  it('accepts an explicit funding event with round and amount', () => {
    const r = extractFunding(doc('Cloudflare raised $20 million in a Series B round in 2012.'), CO);
    expect(r.values[0]).toMatchObject({ field: 'funding', value: '20000000', currency: 'USD', temporalType: 'HISTORICAL', year: 2012 });
    expect(r.values[0].period).toMatch(/Series B/i);
  });

  it('REJECTS a valuation', () => {
    const r = extractFunding(doc('Cloudflare closed a round at a valuation of $2 billion.'), CO);
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/VALUATION/);
  });

  it('REJECTS revenue and order book', () => {
    expect(extractFunding(doc('Cloudflare raised its revenue to $5 million.'), CO).rejected[0].reason).toMatch(/REVENUE/);
    expect(extractFunding(doc('Cloudflare secured an order book of $40 million.'), CO).rejected[0].reason).toMatch(/ORDER BOOK/);
  });

  it('REJECTS a forecast funding statement', () => {
    const r = extractFunding(doc('Cloudflare expects to raise $50 million next year.'), CO);
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/FORECAST/);
  });
});

describe('CPG-007 (8) determinism and scope', () => {
  it('is byte-deterministic across repeated runs', () => {
    const html = doc('Cloudflare fourth quarter revenue totaled $614.5 million.');
    expect(JSON.stringify(extractRevenue(html, CO))).toBe(JSON.stringify(extractRevenue(html, CO)));
  });

  it('covers exactly the four declared fields, and says so for others', () => {
    expect(SUPPORTED_EXTRACTION_FIELDS).toEqual(['revenue', 'founded_year', 'ceo', 'funding']);
    const r = extractField('ideal_customer_profile', doc('anything'), CO);
    expect(r.values).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/no deterministic extractor/);
  });

  it('parses JSON-LD safely and ignores malformed blocks', () => {
    const html = `<script type="application/ld+json">{"@type":"Organization","name":"A"}</script>`
      + `<script type="application/ld+json">{ this is not json }</script>`;
    expect(readJsonLdBlocks(html)).toHaveLength(1);
  });

  it('splits sentences without an LLM', () => {
    expect(splitSentences('First sentence here. Second sentence follows!').length).toBe(2);
  });
});
