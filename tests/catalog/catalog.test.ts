import { expect, test } from 'vitest';
import { validateCatalog, recommendation, createCatalogArchive, adjustProfile, offerKey } from '../../src/catalog/catalog';
import type { CatalogPackage } from '../../src/catalog/catalog';

const url = 'https://example.org/manufacturer/test.pdf';
function fixture(): CatalogPackage {
  return { version: 1, releaseId: 'fixture-1', publishedOn: '2026-11-26',
    offers: [{ channel: 'test-shop', offerId: '001', article: 'P130', brand: 'Test', title: 'Учебная проверка', url,
      scope: 'heating', salesGate: 'confirmed', clearance: false, productId: 'pump', analogue: 'training-circulator',
      allowedContexts: ['heating'] }],
    products: [{ id: 'pump', componentTypeId: 'training-circulator', modelId: 'P130',
      geometry: { lengthsMm: [130], connectors: ['G1', 'G1'] }, ratings: { headPa: 30000, flowM3s: .0004 },
      evidence: { basis: 'datasheet', source: url, verification: 'verified' } }],
    kits: [] };
}
const good = { context: 'heating' as const, componentTypeId: 'training-circulator', lengthMm: 130,
  connectors: ['G1', 'G1'], requiredHeadPa: 21000, requiredFlowM3s: .0003 };

test('duplicates_rejected_by_namespace', () => {
  const raw = fixture();
  raw.offers.push({ ...raw.offers[0]! });
  expect(validateCatalog(raw)).toMatchObject({ ok: false, diagnostics: [{ code: 'duplicate_offer' }] });
  raw.offers[1]!.channel = 'second-shop';
  expect(validateCatalog(raw).ok).toBe(true);
});

test('unverified_curve_cannot_be_datasheet', () => {
  const raw = fixture(), p = raw.products[0]!;
  p.evidence.verification = 'unverified';
  expect(validateCatalog(raw)).toMatchObject({ ok: false, diagnostics: [{ code: 'unverified_datasheet' }] });
});

test('archive_resolves_saved_snapshot independently of new profiles', () => {
  const archive = createCatalogArchive(fixture());
  const newer = fixture();
  newer.releaseId = 'fixture-2';
  newer.products[0]!.ratings.headPa = 33000;
  expect(archive.activate(newer).ok).toBe(true);
  expect(archive.resolve('fixture-1', 'pump')?.ratings.headPa).toBe(30000);
  expect(archive.resolve('fixture-2', 'pump')?.ratings.headPa).toBe(33000);
  newer.products[0]!.ratings.headPa = 0;
  expect(archive.resolve('fixture-2', 'pump')?.ratings.headPa).toBe(33000);
  expect(archive.active().releaseId).toBe('fixture-2');
});

test('same_pump_length_without_other_compatibility_is_not_enough', () => {
  const p = fixture(), k = offerKey('test-shop', '001');
  expect(recommendation(p, k, { ...good, connectors: ['G2', 'G2'] }).eligible).toBe(false);
  expect(recommendation(p, k, { ...good, requiredHeadPa: 50000 }).eligible).toBe(false);
  expect(recommendation(p, k, { ...good, requiredFlowM3s: .001 }).eligible).toBe(false);
});

test('confirmed_offer_with_compatible_profile_is_recommendable; evidence alone cannot promote', () => {
  const p = fixture(), o = p.offers[0]!, k = offerKey(o.channel, o.offerId);
  expect(recommendation(p, k, good)).toMatchObject({ eligible: true });
  const shifted = adjustProfile(p.products[0]!, { headPa: 1 });
  expect(shifted.evidence.basis).toBe('training');
  expect(p.products[0]!.ratings.headPa).toBe(30000);
  o.salesGate = 'verify_exact_profile_and_conditions'; expect(recommendation(p, k, good).eligible).toBe(false);
  o.salesGate = 'confirmed'; o.clearance = true; expect(recommendation(p, k, good).eligible).toBe(false);
  o.clearance = false; o.article = ''; expect(recommendation(p, k, good).eligible).toBe(false);
});
