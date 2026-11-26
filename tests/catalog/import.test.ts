import { expect, test } from 'vitest';
import { normalizeOfferCsv, parseCatalogCsv } from '../../src/catalog/import';

test('CSV preserves missing SKU and parses BOM, escaped quotes and multiline source fields', () => {
  const parsed = parseCatalogCsv('\uFEFFchannel,offer_id,article,brand,name\r\nvolmax,007,,,"Узел, модель ""А""\r\nУчебная роль"\r\n');
  expect(parsed).toEqual({ ok: true, diagnostics: [], value: [
    { channel: 'volmax', offer_id: '007', article: '', brand: '', name: 'Узел, модель "А"\nУчебная роль' },
  ] });
});

test('csv_row_errors_visible_without_partial_activation', () => {
  const invalid = parseCatalogCsv('channel,offer_id\nvolmax,001\nvolmax,002,лишнее\n');
  expect(invalid).not.toHaveProperty('value');
  expect(invalid).toMatchObject({ ok: false, diagnostics: [{ code: 'csv_row_width', path: 'csv.3' }] });
  expect(parseCatalogCsv('offer_id,offer_id\n1,2')).toMatchObject({ ok: false, diagnostics: [{ code: 'csv_header' }] });
  expect(parseCatalogCsv('channel,offer_id\nvolmax,"3')).toMatchObject({ ok: false, diagnostics: [{ code: 'csv_quote' }] });
});

test('CSV update can describe a card but cannot self-approve a SKU', () => {
  const raw = 'channel,offer_id,article,brand,name,url,salesGate\nvolmax,001,,,Насос,https://example.com/1,confirmed';
  expect(normalizeOfferCsv(raw, 'fixture-csv', '2026-11-26')).toMatchObject({
    ok: true, value: { offers: [{ offerId: '001', article: '', brand: '', salesGate: 'no_review' }], products: [] },
  });
  expect(normalizeOfferCsv(raw + '\nvolmax,002,,,Без ссылки,,confirmed', 'fixture-csv', '2026-11-26'))
    .toMatchObject({ ok: false, diagnostics: [{ code: 'csv_offer_fields', path: 'csv.record.2' }] });
});
