/**
 * PI-LDB — RFC 4180 parser tests.
 *
 * The cases here are the ones that break naive parsers, drawn from the shapes
 * real prospect exports actually take: Excel's BOM, European semicolons, a
 * postal address with a line break inside a quoted field, `5" nails` in a
 * product column, and a trailing row with no newline after it.
 */

import {
  parseDelimitedText,
  sniffDelimiter,
  columnSamples,
  type CsvDiagnostic,
} from '../../../lib/leadIngestion/csvParser';

const kinds = (ds: CsvDiagnostic[]): string[] => ds.map((d) => d.kind);

describe('PI-LDB CSV parser — the RFC 4180 essentials', () => {
  it('parses a plain file', () => {
    const r = parseDelimitedText('Name,Email\nAda Lovelace,ada@example.com\n');
    expect(r.headers).toEqual(['Name', 'Email']);
    expect(r.rows).toEqual([['Ada Lovelace', 'ada@example.com']]);
    expect(r.diagnostics).toEqual([]);
    expect(r.importable).toBe(true);
  });

  it('keeps a delimiter that is inside a quoted field', () => {
    const r = parseDelimitedText('Name,Company\n"Lovelace, Ada","Babbage, Ltd"\n');
    expect(r.rows).toEqual([['Lovelace, Ada', 'Babbage, Ltd']]);
  });

  it('unescapes a doubled double quote', () => {
    const r = parseDelimitedText('Name,Note\nAda,"she said ""yes"" twice"\n');
    expect(r.rows[0][1]).toBe('she said "yes" twice');
  });

  it('treats a line break inside a quoted field as DATA, not a new record', () => {
    // The single most common parser bug: a multi-line postal address becomes
    // three rubbish rows instead of one field.
    const r = parseDelimitedText('Name,Address\nAda,"12 Dover Street\nLondon\nW1S 4LL"\n');
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0][1]).toBe('12 Dover Street\nLondon\nW1S 4LL');
  });

  it('reads the final record when the file does not end in a newline', () => {
    const r = parseDelimitedText('Name,Email\nAda,ada@example.com');
    expect(r.rows).toEqual([['Ada', 'ada@example.com']]);
  });

  it('handles CRLF, LF and bare CR line endings alike', () => {
    for (const eol of ['\r\n', '\n', '\r']) {
      const r = parseDelimitedText(`Name,Email${eol}Ada,ada@example.com${eol}Grace,grace@example.com${eol}`);
      expect(r.headers).toEqual(['Name', 'Email']);
      expect(r.rows).toHaveLength(2);
      expect(r.rows[1]).toEqual(['Grace', 'grace@example.com']);
    }
  });

  it('does not emit a phantom row for trailing newlines', () => {
    const r = parseDelimitedText('Name,Email\nAda,ada@example.com\n\n\n');
    expect(r.rows).toHaveLength(1);
  });

  it('keeps a quote that appears mid-field as literal data', () => {
    // `5" nails` must not open a quoted field and swallow the rest of the file.
    const r = parseDelimitedText('Product,Qty\n5" nails,40\nscrews,12\n');
    expect(r.rows).toEqual([['5" nails', '40'], ['screws', '12']]);
  });

  it('preserves an empty field rather than dropping the column', () => {
    const r = parseDelimitedText('A,B,C\n1,,3\n');
    expect(r.rows[0]).toEqual(['1', '', '3']);
  });
});

describe('PI-LDB CSV parser — what real exports look like', () => {
  it('strips the UTF-8 BOM Excel writes, even before a QUOTED first heading', () => {
    // The unquoted case is NOT the test, although it was the first thing I
    // wrote: `String.prototype.trim()` treats U+FEFF as whitespace, so header
    // trimming already removes a bare BOM and that assertion passed with BOM
    // stripping deleted. It proved nothing.
    //
    // The quoted case is where the two genuinely differ. With the BOM still
    // present, the character before `"` means the field is no longer empty when
    // the parser reaches the quote, so the quote is treated as literal data and
    // the heading arrives as `"Email"` — quotes included, matching no synonym.
    const quoted = parseDelimitedText('﻿"Email","Full Name"\na@x.com,Ada\n');
    expect(quoted.headers).toEqual(['Email', 'Full Name']);

    const bare = parseDelimitedText('﻿Email,Name\na@x.com,Ada\n');
    expect(bare.headers).toEqual(['Email', 'Name']);
  });

  it('sniffs a semicolon file, which is what Excel writes across most of Europe', () => {
    const r = parseDelimitedText('Naam;E-mail;Functie\nAda;ada@example.com;Directeur\n');
    expect(r.delimiter).toBe(';');
    expect(r.headers).toEqual(['Naam', 'E-mail', 'Functie']);
    expect(r.rows[0]).toEqual(['Ada', 'ada@example.com', 'Directeur']);
  });

  it('sniffs tab and pipe separated files', () => {
    expect(parseDelimitedText('A\tB\n1\t2\n').delimiter).toBe('\t');
    expect(parseDelimitedText('A|B\n1|2\n').delimiter).toBe('|');
  });

  it('does not let commas inside a quoted heading beat the real delimiter', () => {
    // Sniffing must count OUTSIDE quotes, or this file is read as comma-
    // delimited and every row collapses into one field.
    //
    // The comma count inside the quotes has to EXCEED the real delimiter count
    // for this to discriminate. My first version used one comma against two
    // semicolons, where the semicolon wins either way — so it passed with the
    // quote-awareness removed and proved nothing. Three against two does
    // discriminate, and a quoted composite heading of this shape is exactly
    // what a hand-maintained European export looks like.
    const header = '"Surname, Forename, Salutation, Suffix";Email;Phone';
    expect(sniffDelimiter(header)).toBe(';');

    const r = parseDelimitedText(`${header}\n"Lovelace, Ada, Countess, OBE";ada@example.com;+442079460958\n`);
    expect(r.headers).toEqual(['Surname, Forename, Salutation, Suffix', 'Email', 'Phone']);
    expect(r.rows[0]).toEqual(['Lovelace, Ada, Countess, OBE', 'ada@example.com', '+442079460958']);
  });

  it('falls back to a comma when there is nothing to go on', () => {
    expect(sniffDelimiter('')).toBe(',');
    expect(sniffDelimiter('SingleColumn')).toBe(',');
  });
});

describe('PI-LDB CSV parser — malformed input is reported, never thrown', () => {
  it('pads a short row and reports it, keeping the record', () => {
    // A 5,000-row export with three bad rows must import 4,997 prospects.
    const r = parseDelimitedText('A,B,C\n1,2,3\n4,5\n6,7,8\n');
    expect(r.rows).toHaveLength(3);
    expect(r.rows[1]).toEqual(['4', '5', '']);
    expect(kinds(r.diagnostics)).toEqual(['short_row']);
    expect(r.diagnostics[0].row).toBe(2);
    expect(r.importable).toBe(true);
  });

  it('truncates a long row and says why', () => {
    const r = parseDelimitedText('A,B\n1,2,3,4\n');
    expect(r.rows[0]).toEqual(['1', '2']);
    expect(kinds(r.diagnostics)).toEqual(['long_row']);
    expect(r.diagnostics[0].message).toContain('unquoted ","');
    expect(r.importable).toBe(true);
  });

  it('BLOCKS a duplicate heading instead of guessing a suffix', () => {
    // A profile entry is keyed on the normalised heading, so two columns both
    // called Email cannot be given distinguishable destinations. Renaming one
    // to `Email_2` would invent a column the tenant never wrote and then ask
    // them to map it.
    const r = parseDelimitedText('Email,Name,email\na@x.com,Ada,b@x.com\n');
    expect(kinds(r.diagnostics)).toEqual(['duplicate_header']);
    expect(r.diagnostics[0].message).toContain('Columns 1 and 3');
    expect(r.importable).toBe(false);
  });

  it('BLOCKS a blank heading', () => {
    const r = parseDelimitedText('Email,,Name\na@x.com,x,Ada\n');
    expect(kinds(r.diagnostics)).toEqual(['empty_header']);
    expect(r.diagnostics[0].column).toBe(2);
    expect(r.importable).toBe(false);
  });

  it('BLOCKS an unterminated quote', () => {
    const r = parseDelimitedText('Name,Note\nAda,"never closed\nGrace,fine\n');
    expect(kinds(r.diagnostics)).toContain('unterminated_quote');
    expect(r.importable).toBe(false);
  });

  it('reports truncation at the row cap rather than hanging', () => {
    const body = Array.from({ length: 50 }, (_, i) => `n${i},e${i}@x.com`).join('\n');
    const r = parseDelimitedText(`Name,Email\n${body}\n`, { maxRows: 10 });
    expect(r.rows).toHaveLength(10);
    expect(kinds(r.diagnostics)).toContain('truncated');
  });

  it('reports an empty file as not importable, and does not throw', () => {
    expect(parseDelimitedText('').importable).toBe(false);
    expect(parseDelimitedText('   ').importable).toBe(false);
    // A header with no data rows: valid structure, nothing to import.
    const headerOnly = parseDelimitedText('Name,Email\n');
    expect(headerOnly.headers).toEqual(['Name', 'Email']);
    expect(headerOnly.rows).toEqual([]);
    expect(headerOnly.importable).toBe(false);
  });

  it('never throws on adversarial input', () => {
    const nasty = ['"', '""', ',,,', '\n\n\n', '"a""', 'a,"b\nc', '﻿', '\r\r\n\n', '"",""'];
    for (const input of nasty) {
      expect(() => parseDelimitedText(input)).not.toThrow();
    }
  });
});

describe('PI-LDB CSV parser — samples for the mapping engine', () => {
  it('takes the first NON-EMPTY values per column, not the first rows', () => {
    // A sparse column's evidence is in the rows that have a value. Five blanks
    // would make an optional column look type-incompatible with everything.
    const r = parseDelimitedText(
      'Name,Phone\nAda,\nGrace,\nAlan,+441234567890\nEdsger,+310612345678\n',
    );
    const samples = columnSamples(r);
    expect(samples.Name).toEqual(['Ada', 'Grace', 'Alan', 'Edsger']);
    expect(samples.Phone).toEqual(['+441234567890', '+310612345678']);
  });

  it('caps the sample count per column', () => {
    const body = Array.from({ length: 40 }, (_, i) => `v${i}`).join('\n');
    const r = parseDelimitedText(`Col\n${body}\n`);
    expect(columnSamples(r, 5).Col).toHaveLength(5);
  });

  it('returns an empty array for a column that is entirely blank', () => {
    const r = parseDelimitedText('A,B\n1,\n2,\n');
    expect(columnSamples(r).B).toEqual([]);
  });

  it('omits a blank heading rather than keying samples on an empty string', () => {
    const r = parseDelimitedText('A,,C\n1,2,3\n');
    expect(Object.keys(columnSamples(r))).toEqual(['A', 'C']);
  });
});

describe('PI-LDB CSV parser — the brief’s own worked example', () => {
  // The twenty-record acceptance file in §10A uses headings that are varied on
  // purpose. This proves the PARSER delivers them intact to the mapping engine;
  // what the engine then does with them is tested in leadMappingEngine.test.ts.
  const file = [
    'Full Name,Designation,E-mail,Phone Number,Organization,Annual Turnover,Descriptions,Website',
    '"Lovelace, Ada",Snr. Procurement Mgr,ada@babbage.example,+44 20 7946 0958,"Babbage & Co, Ltd",5000000,"Analytical engines, and\nmechanical computation",babbage.example',
    'Grace Hopper,VP Engineering,grace@univac.example,+1 202 555 0147,UNIVAC,12000000,Compilers,univac.example',
  ].join('\n');

  it('delivers varied headings verbatim', () => {
    const r = parseDelimitedText(file);
    expect(r.headers).toEqual([
      'Full Name', 'Designation', 'E-mail', 'Phone Number',
      'Organization', 'Annual Turnover', 'Descriptions', 'Website',
    ]);
    expect(r.rows).toHaveLength(2);
    expect(r.importable).toBe(true);
    expect(r.diagnostics).toEqual([]);
  });

  it('keeps the embedded comma, the embedded newline and the revenue figure intact', () => {
    const r = parseDelimitedText(file);
    expect(r.rows[0][0]).toBe('Lovelace, Ada');
    expect(r.rows[0][4]).toBe('Babbage & Co, Ltd');
    expect(r.rows[0][6]).toBe('Analytical engines, and\nmechanical computation');
    expect(r.rows[0][5]).toBe('5000000');
  });
});
