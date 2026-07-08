/**
 * @jest-environment jsdom
 */
import fs from 'fs';
import path from 'path';
import { generateCreatorAssetId, duplicateCreatorAssetId, versionedCreatorAssetId } from '../../../lib/content/creatorAssetIdFactory';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('Creator Asset ID Factory — single canonical minter', () => {
  it('generate() mints unique, kind-tagged ids', () => {
    const a = generateCreatorAssetId({ kind: 'image' });
    const b = generateCreatorAssetId({ kind: 'image' });
    expect(a).toMatch(/^casset_image_/);
    expect(a).not.toBe(b); // unique
    expect(generateCreatorAssetId()).toMatch(/^casset_asset_/); // default kind
  });

  it('duplicateOf() derives from the source; versionOf() reuses the same id', () => {
    expect(duplicateCreatorAssetId('casset_image_x')).toMatch(/^casset_image_x_copy_/);
    expect(versionedCreatorAssetId('casset_image_x')).toBe('casset_image_x'); // versions reuse the id
  });

  // ENFORCEMENT: no Creator Asset IDs may be minted outside the factory.
  it('no asset-id minting patterns exist outside the factory', () => {
    const scan = [
      'lib/content/creatorAssetLibrary.ts',
      'lib/content/creatorAttachmentSession.ts',
      'lib/content/writerAttachmentGraph.ts',
      'lib/content/writerSchedulingRefs.ts',
      'pages/command-center/creator-content/[type].tsx',
      'lib/creator-content/creatorTypeWorkflow.ts', // extracted [type].tsx domain model — same rule
    ];
    const forbidden = [
      /`casset_/,                       // canonical id literal — factory only
      /_copy_\$\{/,                     // duplicate id minting — factory only
      /-\$\{type\}-\$\{Date\.now/,      // legacy writeback pattern
      /creator-\$\{type\}-\$\{Date\.now/, // legacy save-as pattern
    ];
    for (const rel of scan) {
      const src = read(rel);
      for (const re of forbidden) {
        expect({ file: rel, matched: re.test(src) }).toEqual({ file: rel, matched: false });
      }
    }
    // the factory is the only place that owns these literals
    const factory = read('lib/content/creatorAssetIdFactory.ts');
    expect(factory).toMatch(/`casset_/);
    expect(factory).toMatch(/_copy_/);
    expect(factory).toMatch(/generateCreatorAssetId/);
  });
});
