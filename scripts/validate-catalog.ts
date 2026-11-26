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
if (process.argv.includes('--acceptance-matrix')) {
  const { releaseId, publishedOn, offers, products, kits } = result.value;
  if (products.length || offers.some((o) => o.salesGate === 'confirmed' || o.productId)) {
    throw new Error('The public acceptance matrix is only for the reference-only catalog.');
  }
  const kitById = new Map(kits.map((k) => [k.offerId, k]));
  const quoteCsv = (raw: string) => {
    const value = /^\s*[=+@-]/.test(raw) ? "'" + raw : raw;
    return /[",\n\r]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  };
  const emit = (cells: string[]) => console.log(cells.map(quoteCsv).join(','));
  emit(['release_id', 'snapshot_date', 'offer_id', 'article', 'source_url', 'application_decision', 'source_review_status',
    'training_analogue', 'published_kit_rows', 'sales_decision', 'why_withheld', 'accountable_role', 'owner_decision_date']);
  for (const card of offers) {
    const kit = kitById.get(card.offerId);
    const excluded = card.scope === 'excluded', holding = card.scope === 'hold';
    const reason = excluded ? 'outside_training_scope' : holding ? 'identity_or_application_unresolved' :
      kit?.ambiguity ? 'published_composition_needs_confirmation' : !card.article || !card.brand ? 'identity_incomplete' :
      card.clearance ? 'clearance_and_profile_not_confirmed' : 'no_approved_identity_and_datasheet_profile';
    emit([releaseId, publishedOn, card.offerId, card.article, card.url, card.scope, card.salesGate, card.analogue ?? '',
      String(kit?.parts.length ?? 0), excluded ? 'excluded' : 'not_eligible', reason, 'catalog_owner_not_assigned', '']);
  }
} else {
  console.log('Validated', result.value.releaseId, result.value.offers.length, 'offers and', result.value.kits.length, 'kits.');
}
