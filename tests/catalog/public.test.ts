import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseCatalogJson, recommendation, teachingAnalogue, validateCatalog } from '../../src/catalog/catalog';
import { parseCatalogCsv } from '../../src/catalog/import';
import { compilePublicSources } from '../../src/catalog/public-source';
import { equipmentRegistry } from '../../src/project/registry';

const prefix = new URL('../../docs/superpowers/specs/volmax-site-', import.meta.url).href;
const source = (key: string) => readFileSync(new URL(prefix + key + '-2026-11-26.csv'), 'utf8');
const file = parseCatalogJson(readFileSync(new URL('../../content/catalog/public-v1.json', import.meta.url), 'utf8'));
if (!file.ok) throw new Error(JSON.stringify(file.diagnostics));
const pack = file.value;
const byId = new Map(pack.offers.map((o) => [o.offerId, o]));

test('applies_all_224_review_rows_by_offer_id without treating scopes as recommendation', () => {
  const parsed = parseCatalogCsv(source('applicability'));
  if (!parsed.ok) throw new Error('CSV invalid');
  expect(pack.offers).toHaveLength(682);
  expect(pack.offers.filter((o) => o.review)).toHaveLength(224);
  const counts = { heating: 105, radiator: 51, service: 44, floor: 8, excluded: 9, hold: 7 };
  for (const [scope, count] of Object.entries(counts)) expect(pack.offers.filter((o) => o.review && o.scope === scope)).toHaveLength(count);
  expect(pack.offers.filter((o) => o.salesGate === 'verify_exact_profile_and_conditions')).toHaveLength(142);
  expect(pack.offers.filter((o) => o.salesGate === 'verify_clearance_and_profile')).toHaveLength(64);
  expect(pack.offers.filter((o) => o.salesGate === 'identify_product')).toHaveLength(2);
  for (const row of parsed.value) expect(byId.get(row.offer_id!)).toMatchObject({
    article: row.article, url: row.card_url, scope: row.review_status, salesGate: row.sales_gate, review: { role: row.engineering_role },
  });
  expect(pack.offers.some((offer) => offer.salesGate === 'confirmed')).toBe(false);
  expect(() => compilePublicSources(source('assortment'), source('applicability').replace('33783,,,', '33783,wrong,,'), source('kit-contents')))
    .toThrow('Unmatched review');
});
test('bundle_quantities_match_all_21_published_bills and conflicting category text stays flagged', () => {
  const parsed = parseCatalogCsv(source('kit-contents'));
  if (!parsed.ok) throw new Error('CSV invalid');
  expect(pack.kits).toHaveLength(21);
  expect(pack.kits.flatMap((kit) => kit.parts)).toHaveLength(95);
  const frozen = new Map(pack.kits.flatMap((kit) => kit.parts.map((part) =>
    [kit.offerId + ':' + part.offerId, [part.article, part.quantity, part.unit, part.url]])));
  for (const row of parsed.value) expect(frozen.get(row.kit_offer_id + ':' + row.component_offer_id))
    .toEqual([row.component_article, Number(row.quantity), row.unit, row.component_url]);
  const eco = pack.kits.find((kit) => kit.article === '17052-04eco')!;
  expect(eco.ambiguity).toContain('евроконусы');
  expect(eco.parts).toHaveLength(4);
  expect(eco.parts.find((part) => part.article === '29352')?.quantity).toBe(8);
  expect(eco.parts.some((part) => part.article === '39511')).toBe(false);
  const pro = pack.kits.find((kit) => kit.article === '17052-02pro')!;
  expect(pro.parts).toHaveLength(5);
  expect(pro.parts.find((part) => part.article === '39511')?.quantity).toBe(2);
  const broken = structuredClone(pack);
  const k = broken.kits[0]!;
  k.parts.push({ channel: k.channel, offerId: k.offerId, quantity: 1, unit: 'шт.', article: k.article,
    title: k.title, url: k.url, included: true });
  expect(validateCatalog(broken)).toMatchObject({ ok: false, diagnostics: [{ code: 'kit_cycle' }] });
});
test('g1494_and_g1495_do_not_share_rtl_profile and held and excluded records are never selected', () => {
  const air = byId.get('35494')!, water = byId.get('35495')!;
  expect(air.article).toBe('G1494');
  expect(water.article).toBe('G1495');
  expect(teachingAnalogue(air)).toEqual({ typeId: 'training-thermostat', basis: 'training' });
  expect(teachingAnalogue(water)).toBeNull();
  expect(water.review?.next).toContain('на обратке');
  const tryRtl = (key: string) => recommendation(pack, 'volmax:' + key, { context: 'floor',
    componentTypeId: 'training-rtl', lengthMm: 140, connectors: ['G1', 'G1'], requiredHeadPa: 2000, requiredFlowM3s: .00003 });
  expect(tryRtl(water.offerId).eligible).toBe(false);
  for (const o of pack.offers) {
    if (o.analogue) expect(equipmentRegistry.has(o.analogue), o.analogue).toBe(true);
    if (o.scope === 'hold' || o.scope === 'excluded' || !o.article) {
      expect(tryRtl(o.offerId).eligible).toBe(false);
    }
  }
  expect(byId.get('33783')).toMatchObject({ article: '', brand: '', scope: 'hold', allowedContexts: [] });
});
