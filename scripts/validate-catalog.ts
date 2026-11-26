import { readFileSync, writeFileSync } from 'node:fs';
import { compilePublicSources } from '../src/catalog/public-source.ts';
import { parseCatalogJson } from '../src/catalog/catalog.ts';

const file = process.argv[2] ?? 'content/catalog/public-v1.json';
const prefix = new URL('../docs/superpowers/specs/volmax-site-', import.meta.url).href;
const csv = (name: string) => new TextDecoder('utf-8', { fatal: true })
  .decode(readFileSync(new URL(prefix + name + '-2026-11-26.csv')));
const expected = compilePublicSources(csv('assortment'), csv('applicability'), csv('kit-contents'));
if (process.argv.includes('--generate')) {
  const lineArray = (rows: object[]) => '[\n' + rows.map((v) => '    ' + JSON.stringify(v)).join(',\n') + '\n  ]';
  const { version, releaseId, publishedOn, offers, products, kits } = expected;
  writeFileSync(file, '{\n  "version": ' + version + ',\n  "releaseId": ' + JSON.stringify(releaseId) +
    ',\n  "publishedOn": ' + JSON.stringify(publishedOn) + ',\n  "offers": ' + lineArray(offers) +
    ',\n  "products": ' + JSON.stringify(products) + ',\n  "kits": ' + lineArray(kits) + '\n}\n');
}
const result = parseCatalogJson(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(file)));
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
if (JSON.stringify(result.value) !== JSON.stringify(expected)) throw new Error('Public package differs from staged source tables.');
console.log('Validated', result.value.releaseId, result.value.offers.length, 'offers and', result.value.kits.length, 'kits.');
