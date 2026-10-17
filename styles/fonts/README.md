# Self-hosted web fonts (CB-12)

Loaded by `webFonts.ts` through `next/font/local`. They replace the build-time Google Fonts download (`next/font/google`), so the web build no longer depends on `fonts.googleapis.com` / `fonts.gstatic.com`.

These are **web** fonts, distinct from `assets/fonts/`: those are the TTFs the server-side renderers use (sharp/librsvg, PDF export). Do not merge the two directories.

## Provenance

| Family | Package (npm) | Version | Tarball integrity | Licence |
|---|---|---|---|---|
| Inter (variable, `wght` axis; Inter v4.001) | `@fontsource-variable/inter` | 5.3.0 | `sha512-OupL48va4JNofb97w6NYeF9S7W/kHNKM0Er8Dem5nqi4jeOLrVJDoE8tZEpnMJmtkvNbB1EIPPwHcdkF6b1oUA==` | SIL OFL 1.1 (`inter/OFL.txt`) |
| Poppins 600/700/800 (v4.004) | `@fontsource/poppins` | 5.3.0 | `sha512-cms1nM7U6SN8epIV1WMVOV8VsA645aSm3wHfzIQnkk188U341ThbJGSl2Sv54V29gnDbT2arMPfLzvVIIVCceQ==` | SIL OFL 1.1 (`poppins/OFL.txt`) |

- `OFL.txt` in each directory is the package's `LICENSE` file, unmodified. It contains the copyright notice and the full OFL 1.1 text.
- The `unicode-range` values in `webFonts.ts` are copied from the same packages' CSS (`wght.css`; `600.css`/`700.css`/`800.css`).
- The packages are **not** dependencies. Only these files were copied; `package.json` and the lock file are unchanged.

## Files (sha256)

```
ca157063339ac4ad418f214f3abfed119b0798ab4d377386ce5c9e5a7a435ebd  inter/inter-cyrillic-ext-wght-normal.woff2
71d5ee93cc1e9f1d520a3a8b66456de18c7879d8df09d57fcd2eaff75fef0075  inter/inter-cyrillic-wght-normal.woff2
6e9e020a25f9b56d418f2c085b1d3c09725a4da23fe693a5b463064606732190  inter/inter-greek-ext-wght-normal.woff2
1be3448e292fbf05ffe176fe1e43f135013d50b1e7d324ad1a558f623d3bb6f6  inter/inter-greek-wght-normal.woff2
34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956  inter/inter-latin-ext-wght-normal.woff2
3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62  inter/inter-latin-wght-normal.woff2
5c66f9e07e90c6d4ac4922cc68d60de26c17b1858e677fb5e603fce3952b3ff2  inter/inter-vietnamese-wght-normal.woff2
58dba357cb1e89bf36e83f19227293f35d5d7de91215d0fcf394e705634837b5  poppins/poppins-devanagari-600-normal.woff2
de10eb6f1f452594080f69e1e4925fc68f2d594b4837c70b6c8e6ac0e8384916  poppins/poppins-devanagari-700-normal.woff2
6c6bb57f25ccf0ee85539099e2df61e7c74be0aca55e658cb9a7ef0c54752828  poppins/poppins-devanagari-800-normal.woff2
f4e80d9dfd374d02989b87a27b5ed4cb78fbb177c27f1478e9a8b0afb7513149  poppins/poppins-latin-600-normal.woff2
9338e65fc077355c7a87ae0d64cc101e23b9bf8ad78ae65f0f319c857311b526  poppins/poppins-latin-700-normal.woff2
60bf0aba6526436f3930c58c12047687fbb6bff4dd180cce4613458ed3439ea2  poppins/poppins-latin-800-normal.woff2
bb1f2d582e7fba586ab70c91ef062d3becaf78b887654953863521b73665d171  poppins/poppins-latin-ext-600-normal.woff2
ccfd87f69ef00d811da3d06488cec4e79ec99d289cfbcbe4be42031cecae775a  poppins/poppins-latin-ext-700-normal.woff2
a72eccfa6cfa9c26b4004e98dbf8592ea0fb3704b2fc749e8bd60a996e2e5a7c  poppins/poppins-latin-ext-800-normal.woff2
3b0a5fca3d17942cde889069889dedbbbd075e9b599968c82a95f4d944e9b345  inter/OFL.txt
5c4a92c8f8ce0ab211f4c72889d82383c9644546115d9ba39a4f2d5b8f37014b  poppins/OFL.txt
```
